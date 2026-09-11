import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseDictionary } from './dictionary-evaluation.ts';
import {
  evaluateContextRows,
  parseContextRows,
  type ContextRow,
  type ContextResult,
} from './dictionary-context-poc.ts';

type ModelOutput = {
  results?: Array<{ id?: unknown; target?: unknown; meaningCn?: unknown; status?: unknown; reason?: unknown }>;
  [key: string]: unknown;
};

type ComparisonCase = ContextRow & { id: number };

type ComparisonRow = ContextRow & {
  candidates: ContextResult['candidates'];
  variantA: Record<string, unknown>;
  variantB: Record<string, unknown>;
};

const DISCRIMINATORS = [
  ['studied', 0],
  ['self-driving', 0],
  ['running', 0],
  ['running', 1],
  ['make up', 0],
  ['make up', 1],
  ['take off', 0],
  ['take off', 1],
] as const;

const SYSTEM_PROMPT = `You are an expert English-language learning assistant with deep knowledge of CEFR proficiency levels.
Your job is to help a Chinese-speaking English learner understand target words in their actual subtitle sentence.

Rules:
1. The Chinese meaning must be natural, accurate, concise, and specific to the sentence.
2. Use the sentence as the primary evidence. Do not invent a meaning when the sentence or candidates are insufficient.
3. Return valid JSON only, with no markdown or explanation outside JSON.`;

function parseArgs(args: string[]): { csv: string; contexts: string; endpoint: string; allowProvider: boolean } {
  const values: Record<string, string> = {};
  let allowProvider = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--csv' || key === '--contexts' || key === '--endpoint') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
      values[key.slice(2)] = value;
    } else if (key === '--allow-provider') {
      allowProvider = true;
    } else {
      throw new Error(`Unknown option ${key}`);
    }
  }
  if (!values.csv || !values.contexts) throw new Error('Usage: node scripts/dictionary-ai-comparison.ts --csv <csv> --contexts <fixture> [--endpoint <url>] [--allow-provider]');
  return { csv: values.csv, contexts: values.contexts, endpoint: values.endpoint ?? 'https://echo-learn.uk/api/ai', allowProvider };
}

function chooseRows(rows: ContextRow[]): ComparisonCase[] {
  return DISCRIMINATORS.map(([target, occurrence], id) => {
    const matches = rows.filter((row) => row.target === target);
    const row = matches[occurrence];
    if (!row) throw new Error(`Missing discriminator row ${target}#${occurrence + 1}.`);
    return { ...row, id: id + 1 };
  });
}

function caseBlock(rows: ComparisonCase[]): string {
  return rows.map((row) => `id=${row.id}\ntarget=${row.target}\nsentence=${row.sentence}`).join('\n\n');
}

function candidateBlock(rows: Array<ContextResult & { id: number }>): string {
  return rows.map((row) => {
    const entries = row.candidates.map((candidate) => [
      `${candidate.source}:${candidate.entry}`,
      `definitions=${candidate.definitions.join(' / ') || '(none)'}`,
      `glosses=${candidate.glosses.map((gloss) => gloss.meaningCn).slice(0, 24).join(' / ') || '(none)'}`,
    ].join('; ')).join(' || ');
    return `id=${row.id}\ntarget=${row.target}\nsentence=${row.sentence}\nECDICT=${entries}`;
  }).join('\n\n');
}

function userPrompt(rows: ComparisonCase[], candidates?: Array<ContextResult & { id: number }>): string {
  const extra = candidates
    ? `\nECDICT candidate data follows. It is noisy lexical evidence, not ground truth. Do not assume Chinese gloss order aligns with English definitions. You may select, merge, correct, or abstain.\n\n${candidateBlock(candidates)}`
    : '';
  return `Return JSON exactly in this shape: {"results":[{"id":1,"target":"","meaningCn":"","status":"answer|abstain","reason":""}]}.
For each case, copy its id exactly and give one short learner-facing Chinese meaning for the target as used in that sentence.
If the context is not enough to justify a meaning, set meaningCn to an empty string and status to "abstain". Do not use any expected answers or outside answer key.${extra}

CASES:
${caseBlock(rows)}`;
}

async function callVariant(endpoint: string, rows: ComparisonCase[], candidates?: Array<ContextResult & { id: number }>): Promise<{ raw: string; parsed: ModelOutput }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(rows, candidates) },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 2048,
      stream: false,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`AI proxy HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
  const body = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: unknown } }> };
  const raw = typeof body.choices?.[0]?.message?.content === 'string' ? body.choices[0].message.content : '';
  if (!raw) throw new Error('AI proxy returned no model content.');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return { raw, parsed: JSON.parse(cleaned) as ModelOutput };
}

function indexResults(output: ModelOutput, expectedIds: number[], variant: string): Map<number, Record<string, unknown>> {
  if (!Array.isArray(output.results)) throw new Error(`${variant} response has no results array.`);
  const indexed = new Map<number, Record<string, unknown>>();
  for (const item of output.results) {
    const id = item && typeof item.id === 'number' && Number.isInteger(item.id) ? item.id : 0;
    if (!expectedIds.includes(id)) throw new Error(`${variant} response has invalid case id.`);
    if (indexed.has(id)) throw new Error(`${variant} response has duplicate case id ${id}.`);
    indexed.set(id, item as Record<string, unknown>);
  }
  if (indexed.size !== expectedIds.length || expectedIds.some((id) => !indexed.has(id))) {
    throw new Error(`${variant} response does not contain exactly one result for every case.`);
  }
  return indexed;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.allowProvider) throw new Error('Provider calls are disabled by default. Add --allow-provider only for an explicitly authorized comparison run.');
  const contextRows = chooseRows(parseContextRows(await readFile(resolve(options.contexts), 'utf8')));
  const dictionaryText = await readFile(resolve(options.csv), 'utf8');
  const ecdictRows = evaluateContextRows(contextRows, parseDictionary(dictionaryText)).map((row, index) => ({
    ...row,
    id: contextRows[index].id,
  }));

  console.log('Variant A: approximate current EchoLearn contextual-meaning semantics; request 1/2');
  const variantA = await callVariant(options.endpoint, contextRows);
  console.log('Variant B: same model/settings plus real ECDICT surface+lemma candidates; request 2/2');
  const variantB = await callVariant(options.endpoint, contextRows, ecdictRows);
  const expectedIds = contextRows.map((row) => row.id);
  const variantAById = indexResults(variantA.parsed, expectedIds, 'Variant A');
  const variantBById = indexResults(variantB.parsed, expectedIds, 'Variant B');
  const ecdictById = new Map(ecdictRows.map((row) => [row.id, row]));

  const rows: ComparisonRow[] = contextRows.map((row) => ({
    ...row,
    candidates: ecdictById.get(row.id)!.candidates,
    variantA: variantAById.get(row.id)!,
    variantB: variantBById.get(row.id)!,
  }));
  const report = {
    source: 'LOCAL/NON-PRODUCTION semantic comparison',
    model: 'deepseek-chat',
    endpoint: options.endpoint,
    requests: 2,
    baseline: 'approximate current EchoLearn prompt-equivalent batch selector; not the exact whole-transcript runtime schema',
    candidateSource: basename(resolve(options.csv)),
    warning: 'Expected values are human-audit notes only and were not sent to the model. No provider other than the AI proxy was used.',
    rows,
    rawModelOutputs: { variantA: variantA.raw, variantB: variantB.raw },
  };
  const outputPath = resolve(tmpdir(), `echolearn-dictionary-ai-comparison-${Date.now()}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const row of rows) {
    const a = String(row.variantA.meaningCn ?? '') || '(abstain)';
    const b = String(row.variantB.meaningCn ?? '') || '(abstain)';
    console.log(`${row.target}\tA=${a}\tB=${b}`);
  }
  console.log(`Report: ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
