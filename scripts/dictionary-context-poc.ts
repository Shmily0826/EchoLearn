import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { field, parseDictionary, type CsvRow } from './dictionary-evaluation.ts';
import { lemmatize } from '../src/utils/lemmatizer.ts';

export type ContextRow = { category: string; target: string; sentence: string; expected?: string };

export type CleanedGloss = { meaningCn: string; pos: string };

export type ContextResult = {
  category: string;
  target: string;
  sentence: string;
  expected?: string;
  lookupQuery: string;
  lemmaUsed: string;
  selectedMeaningCn: string;
  selectedSource: 'surface' | 'lemma' | 'none';
  selectedEntry: string;
  reason: string;
  candidates: Array<{
    source: 'surface' | 'lemma';
    entry: string;
    definitions: string[];
    glosses: CleanedGloss[];
  }>;
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'he',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'she', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was',
  'we', 'were', 'what', 'when', 'will', 'with', 'you', 'your',
]);
const POS_PREFIX = /^(?:n|v|vt|vi|adj|adv|a|s|prep|conj|pron)\.\s*/i;
const FORM_METADATA = /(?:[\p{L}0-9_-]+)?(?:的过去式和过去分词|的过去式|的过去分词|的现在分词|的第三人称单数)/gu;

export function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
}

export function contextLemma(value: string): string {
  return normalizeLookup(value).split(' ').map((part) => part.includes('-') ? part : lemmatize(part)).join(' ');
}

export function parseContextRows(text: string): ContextRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Context fixture must be a non-empty JSON array.');
  return parsed.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Context row ${index + 1} is not an object.`);
    const candidate = row as Record<string, unknown>;
    const category = typeof candidate.category === 'string' ? candidate.category.trim() : '';
    const target = typeof candidate.target === 'string' ? candidate.target.trim() : '';
    const sentence = typeof candidate.sentence === 'string' ? candidate.sentence.trim() : '';
    const expected = typeof candidate.expected === 'string' ? candidate.expected.trim() : undefined;
    if (!category || !target || !sentence) throw new Error(`Context row ${index + 1} needs category, target, and sentence.`);
    return { category, target, sentence, ...(expected ? { expected } : {}) };
  });
}

function cleanText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]\s*/g, '').replace(POS_PREFIX, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,;；，])/g, '$1')
    .trim();
}

export function cleanDefinitions(value: string): string[] {
  return value.replace(/\\n/g, '\n').split(/\r?\n/).map(cleanText).filter(Boolean);
}

export function cleanTranslations(value: string): string[] {
  return value
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .flatMap((line) => cleanText(line).replace(FORM_METADATA, '').split(/[,，;；]/))
    .map((part) => part.trim().replace(/^[:：]\s*/, ''))
    .filter((part) => part.length > 0 && part.length <= 24)
    .filter((part, index, all) => all.indexOf(part) === index);
}

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .map((token) => lemmatize(token)).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function entryGlosses(entry: CsvRow): { definitions: string[]; glosses: CleanedGloss[] } {
  const definitions = cleanDefinitions(field(entry, 'definition', 'gloss'));
  const pos = field(entry, 'pos');
  // ECDICT POS groups and metadata are not proven to align with definitions.
  const glosses = cleanTranslations(field(entry, 'translation', 'chinese', 'meaning')).map((meaningCn) => ({
    meaningCn,
    pos,
  }));
  return { definitions, glosses };
}

function buildIndex(rows: CsvRow[]): Map<string, CsvRow[]> {
  const index = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const word = normalizeLookup(field(row, 'word'));
    if (word) index.set(word, [...(index.get(word) ?? []), row]);
  }
  return index;
}

function scoreEntry(definitions: string[], sentence: string, target: string): { score: number; signals: string[] } {
  const targetTokens = new Set(tokens(target));
  const contextTokens = tokens(sentence).filter((token) => !targetTokens.has(token));
  const definitionTokens = new Set(tokens(definitions.join(' ')));
  const overlap = contextTokens.filter((token) => definitionTokens.has(token));
  return overlap.length
    ? { score: overlap.length * 4, signals: [`definition overlap: ${overlap.join(', ')}`] }
    : { score: 0, signals: [] };
}

export function evaluateContextRow(row: ContextRow, entriesByWord: Map<string, CsvRow[]>): ContextResult {
  const lookupQuery = normalizeLookup(row.target);
  const lemmaUsed = contextLemma(lookupQuery);
  const sources: Array<['surface' | 'lemma', string]> = [['surface', lookupQuery]];
  if (lemmaUsed !== lookupQuery) sources.push(['lemma', lemmaUsed]);
  const candidates = sources.flatMap(([source, query]) => (entriesByWord.get(query) ?? []).map((entry) => ({
    source,
    entry: field(entry, 'word'),
    ...entryGlosses(entry),
  })));
  const scored = candidates.map((candidate) => ({ candidate, ...scoreEntry(candidate.definitions, row.sentence, row.target) }));
  scored.sort((left, right) => right.score - left.score
    || (left.candidate.source === 'surface' ? -1 : 1) - (right.candidate.source === 'surface' ? -1 : 1));
  const selected = scored[0];
  const runnerUp = scored[1];
  const oneGloss = selected?.candidate.glosses.length === 1;
  const confident = Boolean(selected && selected.score > 0 && oneGloss && (!runnerUp || selected.score > runnerUp.score));
  const selectedMeaningCn = confident ? selected!.candidate.glosses[0].meaningCn : '';
  const reason = !selected
    ? 'no exact or lemma ECDICT entry'
    : !confident
      ? `abstained: insufficient semantic evidence, confidence margin, or unambiguous gloss; top score=${selected.score}`
      : `${selected.signals.join('; ')}; score=${selected.score}; margin=${selected.score - (runnerUp?.score ?? 0)}`;
  return {
    ...row,
    lookupQuery,
    lemmaUsed,
    selectedMeaningCn,
    selectedSource: confident ? selected!.candidate.source : 'none',
    selectedEntry: confident ? selected!.candidate.entry : '',
    reason,
    candidates: candidates.map((candidate) => ({
      source: candidate.source,
      entry: candidate.entry,
      definitions: candidate.definitions,
      glosses: candidate.glosses,
    })),
  };
}

export function evaluateContextRows(rows: ContextRow[], dictionaryRows: CsvRow[]): ContextResult[] {
  const entriesByWord = buildIndex(dictionaryRows);
  return rows.map((row) => evaluateContextRow(row, entriesByWord));
}

type CliOptions = { csv: string; contexts: string; output?: string; selfCheck: boolean };

function parseArguments(args: string[]): CliOptions {
  const options: Partial<CliOptions> = { selfCheck: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--self-check') { options.selfCheck = true; continue; }
    if (argument === '--csv' || argument === '--contexts' || argument === '--output') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2) as 'csv' | 'contexts' | 'output'] = value;
      continue;
    }
    throw new Error(`Unknown option ${argument}`);
  }
  if (!options.csv || !options.contexts) throw new Error('Usage: npm run dict:context -- --csv <local-ECDICT.csv> --contexts <fixture.json>');
  return options as CliOptions;
}

function assertBaseline(): void {
  const synthetic = parseDictionary([
    'word,definition,translation',
    'bank,"n. financial institution\\nn. side of a river",n. banking;river-side',
    'nuance,"n. subtle difference in meaning",n. difference',
    'phrase,,one;two',
  ].join('\n'));
  const results = evaluateContextRows([
    { category: 'test', target: 'nuance', sentence: 'The subtle difference matters.' },
    { category: 'test', target: 'bank', sentence: 'The boat reached the river bank.' },
    { category: 'test', target: 'phrase', sentence: 'The context has no dictionary definition.' },
  ], synthetic);
  if (contextLemma('studied') !== 'study' || results[0].selectedMeaningCn !== 'difference'
    || results[1].selectedMeaningCn !== '' || results[2].selectedMeaningCn !== '') {
    throw new Error(`Deterministic PoC self-check failed: ${JSON.stringify(results)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run dict:context -- --csv <local-ECDICT.csv> --contexts <fixture.json> [--output <report.json>] [--self-check]');
    return;
  }
  const options = parseArguments(args);
  const dictionaryPath = resolve(options.csv);
  const contextPath = resolve(options.contexts);
  const dictionaryText = await readFile(dictionaryPath, 'utf8');
  const results = evaluateContextRows(parseContextRows(await readFile(contextPath, 'utf8')), parseDictionary(dictionaryText));
  if (options.selfCheck) assertBaseline();
  const outputPath = resolve(options.output ?? join(dirname(dictionaryPath), `echolearn-dictionary-context-${Date.now()}.json`));
  await writeFile(outputPath, `${JSON.stringify({
    source: 'LOCAL_ECDICT_CSV',
    csvFile: basename(dictionaryPath),
    warning: 'LOCAL/NON-PRODUCTION OFFLINE POC: generic definition-overlap baseline; expected values are human-audit notes only.',
    rows: results,
  }, null, 2)}\n`, 'utf8');
  console.log(`Dictionary context PoC: ${results.length} rows; CSV bytes=${Buffer.byteLength(dictionaryText)}`);
  for (const result of results) console.log(`${result.target}\t${result.selectedMeaningCn || '(abstain)'}\t${result.selectedSource}:${result.selectedEntry || '-'}\t${result.reason}`);
  console.log(`Report: ${outputPath}`);
  if (options.selfCheck) console.log('Deterministic PoC self-check: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
