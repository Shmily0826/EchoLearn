import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lemmatize } from '../src/utils/lemmatizer.ts';

export type CsvRow = Record<string, string>;

type EvaluationRow = {
  source_kind: string;
  source_file: string;
  category: string;
  test_word: string;
  lookup_query: string;
  lemma_used: string;
  match: 'exact' | 'lemma' | 'miss';
  matched_entry: string;
  raw_chinese_translation: string;
  raw_gloss: string;
  phonetic: string;
  pos: string;
  exchange: string;
  tag: string;
  collins: string;
  oxford: string;
  frequency: string;
  metadata_json: string;
  baseline_chinese_status: 'UNAVAILABLE_LOCAL_OFFLINE';
  baseline_chinese_note: string;
  human_score: '';
  human_notes: '';
};

const DEFAULT_WORDS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'dictionary-evaluation-words.txt');
const BUNDLED_SYNTHETIC_CSV = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/dictionary-eval.synthetic.ecdict.csv');
const REPORT_COLUMNS = [
  'source_kind', 'source_file', 'category', 'test_word', 'lookup_query', 'lemma_used', 'match',
  'matched_entry', 'raw_chinese_translation', 'raw_gloss', 'phonetic', 'pos', 'exchange', 'tag',
  'collins', 'oxford', 'frequency', 'metadata_json', 'baseline_chinese_status',
  'baseline_chinese_note', 'human_score', 'human_notes',
];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim().toLowerCase();
}

export function parseDictionary(text: string): CsvRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('ECDICT CSV is empty.');
  const headers = rows[0].map(normalizeHeader);
  if (!headers.includes('word')) throw new Error('ECDICT CSV must include a word column.');

  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']),
  ));
}

function readWords(text: string): Array<{ category: string; word: string }> {
  let category = 'uncategorized';
  const words: Array<{ category: string; word: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      category = line.slice(1, -1);
      continue;
    }
    words.push({ category, word: line });
  }
  if (words.length === 0) throw new Error('Evaluation word list is empty.');
  return words;
}

export function field(entry: CsvRow, ...names: string[]): string {
  for (const name of names) {
    if (entry[name]) return entry[name];
  }
  return '';
}

function makeEvaluationRow(
  sourceKind: string,
  sourceFile: string,
  category: string,
  testWord: string,
  entriesByWord: Map<string, CsvRow[]>,
): EvaluationRow {
  const lookupQuery = testWord.trim().toLowerCase();
  const lemma = lemmatize(lookupQuery);
  const exactEntries = entriesByWord.get(lookupQuery) ?? [];
  const lemmaEntries = entriesByWord.get(lemma) ?? [];
  const entries = exactEntries.length > 0 ? exactEntries : lemmaEntries;
  const match = exactEntries.length > 0 ? 'exact' : entries.length > 0 ? 'lemma' : 'miss';
  const entry = entries[0] ?? {};
  const metadata = Object.fromEntries(
    Object.entries(entry).filter(([key]) => !['word', 'translation', 'definition', 'phonetic', 'pos', 'exchange', 'tag', 'collins', 'oxford', 'frq'].includes(key)),
  );

  return {
    source_kind: sourceKind,
    source_file: sourceFile,
    category,
    test_word: testWord,
    lookup_query: lookupQuery,
    lemma_used: lemma,
    match,
    matched_entry: field(entry, 'word'),
    raw_chinese_translation: field(entry, 'translation', 'chinese', 'meaning'),
    raw_gloss: field(entry, 'definition', 'gloss'),
    phonetic: field(entry, 'phonetic'),
    pos: field(entry, 'pos'),
    exchange: field(entry, 'exchange'),
    tag: field(entry, 'tag'),
    collins: field(entry, 'collins'),
    oxford: field(entry, 'oxford'),
    frequency: field(entry, 'frq', 'frequency'),
    metadata_json: JSON.stringify(metadata),
    baseline_chinese_status: 'UNAVAILABLE_LOCAL_OFFLINE',
    baseline_chinese_note: 'No local Chinese baseline captured; no Google, AI, or paid provider calls made.',
    human_score: '',
    human_notes: '',
  };
}

function tsvCell(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function reportText(rows: EvaluationRow[], synthetic: boolean, csvPath: string): string {
  const warning = synthetic
    ? 'SYNTHETIC ONLY: fixture validates parser and lemmatizer behavior; it is not real ECDICT coverage or quality evidence.'
    : 'LOCAL/OFFLINE ONLY: this report reflects the supplied local CSV and does not prove provider or production behavior.';
  const metadata = [
    '# EchoLearn Phase A dictionary evaluation',
    `# source=${synthetic ? 'SYNTHETIC_ECDICT_FIXTURE' : 'LOCAL_ECDICT_CSV'}`,
    `# csv_path=${csvPath}`,
    `# warning=${warning}`,
    '# human_score rubric: blank=not reviewed; 2=directly usable; 1=understandable but needs editing/translationese; 0=wrong/unusable.',
    REPORT_COLUMNS.join('\t'),
  ];
  return `${metadata.join('\n')}\n${rows.map((row) => REPORT_COLUMNS.map((column) => tsvCell(String(row[column as keyof EvaluationRow]))).join('\t')).join('\n')}\n`;
}

type CliOptions = {
  csv?: string;
  words?: string;
  output?: string;
  syntheticFixture: boolean;
  selfCheck: boolean;
};

class CliUsageError extends Error {}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = { syntheticFixture: false, selfCheck: false };
  const valueOptions = new Map([
    ['--csv', 'csv'],
    ['--words', 'words'],
    ['--output', 'output'],
  ] as const);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--synthetic-fixture') {
      options.syntheticFixture = true;
    } else if (argument === '--self-check') {
      options.selfCheck = true;
    } else if (valueOptions.get(argument as '--csv' | '--words' | '--output')) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new CliUsageError(`Option ${argument} requires a value.`);
      const optionName = valueOptions.get(argument as '--csv' | '--words' | '--output');
      options[optionName!] = value;
      index += 1;
    } else {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function assertSynthetic(rows: EvaluationRow[]): void {
  const byWord = new Map(rows.map((row) => [row.test_word, row]));
  const expect = (word: string, match: EvaluationRow['match'], lemma: string, translation: string): void => {
    const row = byWord.get(word);
    if (!row || row.match !== match || row.lemma_used !== lemma || row.raw_chinese_translation !== translation) {
      throw new Error(`Synthetic self-check failed for ${word}: ${JSON.stringify(row)}`);
    }
  };
  expect('apple', 'exact', 'apple', '苹果');
  expect('running', 'lemma', 'run', '跑；运行');
  expect('children', 'lemma', 'child', '孩子');
  const miss = byWord.get('awkward');
  if (!miss || miss.match !== 'miss' || miss.raw_chinese_translation !== '' || miss.human_score !== '') {
    throw new Error(`Synthetic miss/blank-score self-check failed: ${JSON.stringify(miss)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run dict:eval -- --csv <local-ECDICT.csv> [--words <list.txt>] [--output <report.tsv>] [--synthetic-fixture] [--self-check]');
    return;
  }
  const options = parseArguments(args);
  if (!options.csv) {
    console.error('Usage: npm run dict:eval -- --csv <local-ECDICT.csv> [--words <list.txt>] [--output <report.tsv>] [--synthetic-fixture] [--self-check]');
    process.exitCode = 2;
    return;
  }

  const csvPath = resolve(options.csv);
  const wordsPath = resolve(options.words ?? DEFAULT_WORDS_PATH);
  const synthetic = options.syntheticFixture || csvPath.toLowerCase() === BUNDLED_SYNTHETIC_CSV.toLowerCase();
  const csvText = await readFile(csvPath, 'utf8');
  const wordsText = await readFile(wordsPath, 'utf8');
  const dictionaryRows = parseDictionary(csvText);
  const entriesByWord = new Map<string, CsvRow[]>();
  for (const entry of dictionaryRows) {
    const word = field(entry, 'word').trim().toLowerCase();
    if (!word) continue;
    const entries = entriesByWord.get(word) ?? [];
    entries.push(entry);
    entriesByWord.set(word, entries);
  }

  const words = readWords(wordsText);
  const sourceKind = synthetic ? 'SYNTHETIC_ECDICT_FIXTURE' : 'LOCAL_ECDICT_CSV';
  const rows = words.map(({ category, word }) => makeEvaluationRow(sourceKind, basename(csvPath), category, word, entriesByWord));
  if (options.selfCheck) assertSynthetic(rows);

  const outputPath = resolve(options.output ?? join(tmpdir(), `echolearn-dictionary-evaluation-${Date.now()}.tsv`));
  await writeFile(outputPath, reportText(rows, synthetic, csvPath), 'utf8');

  const counts = rows.reduce((result, row) => {
    result[row.match] += 1;
    return result;
  }, { exact: 0, lemma: 0, miss: 0 });
  console.log(`Dictionary evaluation: ${sourceKind}`);
  console.log(`CSV rows: ${dictionaryRows.length}; test words: ${rows.length}; exact: ${counts.exact}; lemma: ${counts.lemma}; miss: ${counts.miss}`);
  console.log(`Report: ${outputPath}`);
  if (options.selfCheck) console.log('Synthetic self-check: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  });
}
