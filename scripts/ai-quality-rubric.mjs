/**
 * Manual AI-quality rubric for the real /api/ai (Layer 2, human-run).
 *
 * The CI suite (e2e/study-ai-authenticated.spec.ts) proves the *plumbing*:
 * authenticated request, prompt contents, rendering, fallbacks. It can never
 * prove *quality* — whether the summary is about this video, whether the quoted
 * sentences really occur in the transcript, or whether the suggested words sit
 * in the requested CEFR band. Those need one real provider call per video, so
 * this script is deliberately manual, opt-in and capped.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ai-quality-rubric.mjs \
 *     --email you@example.invalid --password-stdin
 *
 * Convenience (reads both from env, never echoes them):
 *   ECHOLEARN_RUBRIC_EMAIL=... ECHOLEARN_RUBRIC_PASSWORD=... \
 *   ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=2 \
 *   node --experimental-strip-types scripts/ai-quality-rubric.mjs
 *
 * Options:
 *   --transcript <file>  JSON array of { text } lines (default: bundled sample)
 *   --min / --max        CEFR range sent to the model (default B1 / C2)
 *   --vocab <n>          requested vocabulary count (default 8)
 *   --sentences <n>      requested sentence count (default 7 — deliberately not
 *                        the app default of 4, so the client-side cache key
 *                        cannot collide with an ordinary in-app run)
 *   --lang <en|zh>       prompt language (default zh)
 *   --base <url>         API base (default https://echo-learn.uk)
 *   --out <file>         also write the machine-readable report
 *
 * Exit code 0 = no FAIL rule, 1 = at least one FAIL, 2 = blocked/config error.
 *
 * Secret handling: the id token and password are never printed. Only status,
 * byte counts, latency and derived metrics reach stdout or the report.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPaidProviderGuard, resolvePaidProviderPolicy, ALLOW_ENV, CAP_ENV } from './paid-provider-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const IDENTITYTOOLKIT = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'you',
  'they', 'i', 'he', 'she', 'as', 'so', 'not', 'do', 'does', 'did', 'have', 'has', 'had', 'about',
]);

function parseArgs(argv) {
  const args = {
    transcript: path.join(REPO, 'src/data/sample-transcript.json'),
    min: 'B1',
    max: 'C2',
    vocab: 8,
    sentences: 7,
    lang: 'zh',
    base: 'https://echo-learn.uk',
    out: null,
    email: process.env.ECHOLEARN_RUBRIC_EMAIL ?? null,
    password: process.env.ECHOLEARN_RUBRIC_PASSWORD ?? null,
    allowCache: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--transcript') { args.transcript = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--min') { args.min = next; i += 1; }
    else if (key === '--max') { args.max = next; i += 1; }
    else if (key === '--vocab') { args.vocab = Number(next); i += 1; }
    else if (key === '--sentences') { args.sentences = Number(next); i += 1; }
    else if (key === '--lang') { args.lang = next; i += 1; }
    else if (key === '--base') { args.base = next; i += 1; }
    else if (key === '--out') { args.out = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--email') { args.email = next; i += 1; }
    else if (key === '--password') { args.password = next; i += 1; }
    else if (key === '--allow-cache') { args.allowCache = true; }
    else if (key === '--help' || key === '-h') { args.help = true; }
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

/** Public Firebase web config — these identifiers ship in the client bundle. */
function readFirebaseConfig() {
  const source = fs.readFileSync(path.join(REPO, 'src/lib/firebase.ts'), 'utf8');
  const apiKey = source.match(/apiKey:\s*'([^']+)'/)?.[1];
  if (!apiKey) throw new Error('could not read apiKey from src/lib/firebase.ts');
  return { apiKey };
}

function loadTranscript(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lines = Array.isArray(parsed) ? parsed : parsed.lines ?? parsed.transcriptLines;
  if (!Array.isArray(lines)) throw new Error(`unsupported transcript file: ${file}`);
  const texts = lines.map((l) => (typeof l === 'string' ? l : l.text ?? '')).filter(Boolean);
  if (texts.length === 0) throw new Error(`transcript file has no lines: ${file}`);
  return { text: texts.join(' '), lineCount: texts.length };
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Exchange email+password for a Firebase ID token (never logged). */
async function signIn({ apiKey, email, password }) {
  const response = await fetch(`${IDENTITYTOOLKIT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    throw new Error(`sign-in failed with HTTP ${response.status} (credentials are never printed)`);
  }
  const data = await response.json();
  if (!data.idToken) throw new Error('sign-in returned no id token');
  return data.idToken;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** Fraction of the claim's content words that occur in the transcript. */
function grounding(claim, transcriptTokens) {
  const claims = tokenize(claim);
  if (claims.length === 0) return 0;
  const pool = new Set(transcriptTokens);
  const hit = claims.filter((w) => pool.has(w)).length;
  return hit / claims.length;
}

/**
 * Compare word streams, not punctuation: the transcript holds curly quotes and
 * splits long sentences across subtitle lines, while the model returns straight
 * quotes and rejoined text. Dropping punctuation avoids false "fabrication".
 */
function normalizeForMatch(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same sampling the app sends (src/services/aiAnalysis.ts smartTruncate). */
function smartTruncate(text, max = 12000) {
  if (text.length <= max) return text;
  const third = Math.floor(max / 3);
  const midStart = Math.floor((text.length - third) / 2);
  return (
    text.slice(0, third) +
    '\n...[middle]...\n' +
    text.slice(midStart, midStart + third) +
    '\n...[later]...\n' +
    text.slice(text.length - third)
  );
}

/**
 * The CEFR word list is TypeScript with extensionless imports, which plain
 * Node cannot resolve. Bundle it once with Vite's build API (already a project
 * dependency) instead of reimplementing the classification.
 */
async function loadCefrModule() {
  try {
    const { build } = await import('vite');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echolearn-cefr-'));
    await build({
      configFile: false,
      logLevel: 'error',
      publicDir: false,
      build: {
        ssr: path.join(REPO, 'src/services/cefrWordList.ts'),
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: 'esm', entryFileNames: 'cefr.mjs' } },
      },
    });
    const mod = await import(pathToFileURL(path.join(outDir, 'cefr.mjs')).href);
    fs.rmSync(outDir, { force: true, recursive: true });
    return mod.classifyWordCEFR ? mod : null;
  } catch {
    return null;
  }
}

const rules = [];
function rule(name, status, detail) {
  rules.push({ name, status, detail });
  return status;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('See the usage block at the top of scripts/ai-quality-rubric.mjs');
    return 0;
  }
  if (!args.email || !args.password) {
    console.error('missing credentials: pass --email/--password or set ECHOLEARN_RUBRIC_EMAIL / ECHOLEARN_RUBRIC_PASSWORD');
    return 2;
  }
  if (!args.allowCache && args.sentences === 4) {
    console.error('refusing to run with the app-default sentenceCount=4: that cache key may already exist. Use --allow-cache to override.');
    return 2;
  }

  let policy;
  try {
    policy = resolvePaidProviderPolicy();
  } catch (err) {
    console.error(`${err.code}: ${err.message}`);
    console.error(`set ${ALLOW_ENV}=1 and ${CAP_ENV}=<n> to authorize up to n paid calls`);
    return 2;
  }
  if (!policy.enabled) {
    console.error(`paid provider blocked: set ${ALLOW_ENV}=1 and ${CAP_ENV}=1 (or 2)`);
    return 2;
  }
  const guard = createPaidProviderGuard(policy);

  const { apiKey } = readFirebaseConfig();
  const { text: transcript, lineCount } = loadTranscript(args.transcript);
  const promptTranscript = smartTruncate(transcript);
  // Judged against the whole transcript — that is the learner-visible truth
  // ("does this really occur in this video?") — while the model only ever sees
  // `promptTranscript`, so anything outside that window is reported separately.
  const transcriptTokens = tokenize(transcript);
  const normalizedTranscript = normalizeForMatch(transcript);

  // The browser-side 30-day cache is keyed on exactly this string. Printing it
  // lets a reviewer confirm the rubric is not reading an in-app cached result.
  const cacheKey = await sha256Hex(`${args.min}|${args.max}|${args.lang}|${args.vocab}|${args.sentences}|${transcript}`);

  const idToken = await signIn({ apiKey, email: args.email, password: args.password });

  const body = {
    model: 'deepseek-v4-flash',
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: 'You are an expert English-language learning assistant. Reply with JSON only.' },
      {
        role: 'user',
        content: `Analyze this English video transcript for a Chinese-speaking English learner.

Return JSON exactly in this shape (valid JSON only, no markdown fences):
{
  "summaryEn": "2-3 sentence summary",
  "summaryCn": "2-3句中文摘要",
  "keyTakeaways": ["point1", "point2", "point3"],
  "vocabularySuggestions": [{"word":"","context":"","meaningCn":"","reason":""}],
  "sentenceSuggestions": [{"text":"","meaningCn":"","reason":"","grammarNotes":""}],
  "note": "optional"
}

Requirements:
- "vocabularySuggestions": up to ${args.vocab} words at CEFR ${args.min}–${args.max} from the transcript. Each: lemma + context + meaningCn + reason. Distribute EVENLY across levels.
- "sentenceSuggestions": exactly ${args.sentences} exact quotes with useful grammar/expressions. "grammarNotes": 用中文简要解析该句的语法结构、重点短语或表达技巧（2-3句话）. Pick from different parts.
- "keyTakeaways": exactly 3 points in English.
- Vocabulary words must be actual words found in the transcript; sentences must be exact quotes. Never invent either.

Transcript:
---
${promptTranscript}
---`,
      },
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    stream: false,
  };

  const started = Date.now();
  const response = await guard.invoke(fetch, `${args.base.replace(/\/$/, '')}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const latencyMs = Date.now() - started;

  console.log('');
  console.log('AI quality rubric — manual Layer 2');
  console.log('==================================');
  console.log(`target            : ${args.base}/api/ai`);
  console.log(`transcript        : ${path.relative(REPO, args.transcript)} (${lineCount} lines, ${transcript.length} chars${promptTranscript.length < transcript.length ? `, smart-truncated to ${promptTranscript.length}` : ''})`);
  console.log(`cefr range        : ${args.min}–${args.max}   vocab=${args.vocab}   sentences=${args.sentences}   lang=${args.lang}`);
  console.log(`client cache key  : ${cacheKey.slice(0, 16)}… (browser-side only; this call cannot read it)`);
  console.log(`http              : ${response.status}   bytes=${raw.length}   latency=${latencyMs}ms`);
  console.log(`paid invocations  : ${guard.invocations}/${guard.maxInvocations}`);
  console.log('');

  if (!response.ok) {
    rule('api responds 2xx', 'FAIL', `HTTP ${response.status}`);
    return finish(rules, args);
  }
  rule('api responds 2xx', 'PASS', `HTTP ${response.status}`);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    rule('response is JSON', 'FAIL', 'body is not JSON');
    return finish(rules, args);
  }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    rule('response is JSON', 'FAIL', 'no message content');
    return finish(rules, args);
  }
  rule('response is JSON', 'PASS', 'choices[0].message.content present');

  let result;
  try {
    result = JSON.parse(content);
  } catch {
    rule('content parses as analysis JSON', 'FAIL', 'content is not JSON');
    return finish(rules, args);
  }
  rule('content parses as analysis JSON', 'PASS', `${content.length} chars`);

  // ── Cache-MISS assurance ────────────────────────────────────────────────
  // A byte-identical repeat of the recorded fixture would mean we are not
  // looking at a fresh generation for this key.
  const fixturePath = path.join(REPO, 'e2e/fixtures/ai-analysis.sample.json');
  if (fs.existsSync(fixturePath)) {
    const fixtureHash = await sha256Hex(fs.readFileSync(fixturePath, 'utf8').trim());
    const resultHash = await sha256Hex(JSON.stringify(result));
    rule(
      'fresh generation (not the recorded fixture)',
      fixtureHash === resultHash ? 'WARN' : 'PASS',
      fixtureHash === resultHash ? 'identical to e2e/fixtures/ai-analysis.sample.json' : 'differs from the recorded fixture',
    );
  }

  // ── Schema conformance ──────────────────────────────────────────────────
  // Every downstream check reads a specific field, so an item that arrives
  // under the wrong key must fail loudly instead of being silently skipped.
  // (Observed once: sentences came back under "word" instead of "text".)
  const schemaProblems = [];
  if (!String(result.summaryEn ?? '').trim()) schemaProblems.push('summaryEn');
  if (args.lang === 'zh' && !String(result.summaryCn ?? '').trim()) schemaProblems.push('summaryCn');
  for (const [index, item] of (Array.isArray(result.vocabularySuggestions) ? result.vocabularySuggestions : []).entries()) {
    for (const field of ['word', 'context', 'meaningCn']) {
      if (!String(item?.[field] ?? '').trim()) schemaProblems.push(`vocabularySuggestions[${index}].${field}`);
    }
  }
  for (const [index, item] of (Array.isArray(result.sentenceSuggestions) ? result.sentenceSuggestions : []).entries()) {
    for (const field of ['text', 'meaningCn']) {
      if (!String(item?.[field] ?? '').trim()) schemaProblems.push(`sentenceSuggestions[${index}].${field}`);
    }
  }
  rule(
    'response uses the agreed field names',
    schemaProblems.length === 0 ? 'PASS' : 'FAIL',
    schemaProblems.length ? `missing/empty: ${schemaProblems.slice(0, 6).join(', ')}${schemaProblems.length > 6 ? ' …' : ''}` : 'all required fields present',
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  const summary = String(result.summaryEn ?? '');
  const summaryWords = summary.split(/\s+/).filter(Boolean).length;
  const summaryGrounding = grounding(summary, transcriptTokens);
  rule('summary length', summaryWords >= 20 && summaryWords <= 140 ? 'PASS' : 'WARN', `${summaryWords} words`);
  // A summary is meant to paraphrase, so overlap is a band, not a cliff:
  // two consecutive real runs scored 44% and 50% on the same transcript.
  rule(
    'summary is grounded in this transcript',
    summaryGrounding >= 0.5 ? 'PASS' : summaryGrounding >= 0.35 ? 'WARN' : 'FAIL',
    `${(summaryGrounding * 100).toFixed(0)}% of content words occur in the transcript (PASS ≥50%, WARN ≥35%)`,
  );

  // ── Takeaways ───────────────────────────────────────────────────────────
  const takeaways = Array.isArray(result.keyTakeaways) ? result.keyTakeaways : [];
  const weakestTakeaway = Math.min(1, ...takeaways.map((t) => grounding(String(t), transcriptTokens)));
  rule('takeaways present', takeaways.length >= 2 ? 'PASS' : 'FAIL', `${takeaways.length} items`);
  rule(
    'takeaways are grounded',
    weakestTakeaway >= 0.5 ? 'PASS' : weakestTakeaway >= 0.35 ? 'WARN' : 'FAIL',
    `weakest grounding ${(weakestTakeaway * 100).toFixed(0)}%`,
  );

  // ── Vocabulary ──────────────────────────────────────────────────────────
  const vocab = Array.isArray(result.vocabularySuggestions) ? result.vocabularySuggestions : [];
  const cefr = await loadCefrModule();
  const invented = [];
  const outOfBand = [];
  const outsideWindow = [];
  const seenWords = new Set();
  let duplicateWords = 0;
  for (const suggestion of vocab) {
    const word = String(suggestion?.word ?? '').trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seenWords.has(key)) duplicateWords += 1;
    seenWords.add(key);
    const inTranscript = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(transcript);
    if (!inTranscript) invented.push(word);
    else if (!new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(promptTranscript)) {
      outsideWindow.push(word);
    }
    if (!cefr) continue;
    const level = cefr.classifyWordCEFR(key);
    if (cefr.CEFR_LEVELS.indexOf(level) < cefr.CEFR_LEVELS.indexOf(args.min) || cefr.CEFR_LEVELS.indexOf(level) > cefr.CEFR_LEVELS.indexOf(args.max)) {
      outOfBand.push(`${word}(${level})`);
    }
  }
  rule('vocabulary suggestions present', vocab.length > 0 ? 'PASS' : 'FAIL', `${vocab.length} items (requested ${args.vocab})`);
  rule('no invented vocabulary', invented.length === 0 ? 'PASS' : 'FAIL', invented.length ? `not in transcript: ${invented.join(', ')}` : `all ${vocab.length} occur in the transcript`);
  rule('no duplicate vocabulary', duplicateWords === 0 ? 'PASS' : 'WARN', `${duplicateWords} duplicates`);
  if (!cefr) {
    rule('vocabulary inside the requested CEFR band', 'WARN', 'skipped: the CEFR word list could not be bundled');
  } else {
    rule(
      'vocabulary inside the requested CEFR band',
      vocab.length === 0 || outOfBand.length <= Math.ceil(vocab.length / 2) ? 'PASS' : 'WARN',
      outOfBand.length ? `outside ${args.min}–${args.max}: ${outOfBand.join(', ')}` : 'all classified inside the band',
    );
  }

  // ── Sentences ───────────────────────────────────────────────────────────
  const sentences = Array.isArray(result.sentenceSuggestions) ? result.sentenceSuggestions : [];
  const fabricated = [];
  const seenSentences = new Set();
  let duplicateSentences = 0;
  for (const suggestion of sentences) {
    const text = String(suggestion?.text ?? '').trim();
    if (!text) continue;
    if (seenSentences.has(normalizeForMatch(text))) duplicateSentences += 1;
    seenSentences.add(normalizeForMatch(text));
    if (!normalizedTranscript.includes(normalizeForMatch(text))) fabricated.push(text.slice(0, 60));
  }
  rule('sentence suggestions present', sentences.length > 0 ? 'PASS' : 'FAIL', `${sentences.length} items (requested ${args.sentences})`);
  rule('sentences are exact quotes', fabricated.length === 0 ? 'PASS' : 'FAIL', fabricated.length ? `not found verbatim: ${fabricated.join(' | ')}` : `all ${sentences.length} match the transcript`);
  rule('no duplicate sentences', duplicateSentences === 0 ? 'PASS' : 'WARN', `${duplicateSentences} duplicates`);

  if (promptTranscript.length < transcript.length) {
    rule(
      'suggestions stay inside the model-visible window',
      outsideWindow.length === 0 ? 'PASS' : 'WARN',
      outsideWindow.length
        ? `in the video but outside the ${promptTranscript.length}-char window: ${outsideWindow.join(', ')}`
        : 'every suggested word sits in the truncated window the model saw',
    );
  }

  // ── Translations ────────────────────────────────────────────────────────
  const missingCn = vocab.filter((v) => !String(v?.meaningCn ?? '').trim()).length
    + sentences.filter((s) => !String(s?.meaningCn ?? '').trim()).length;
  rule('every suggestion carries a Chinese gloss', missingCn === 0 ? 'PASS' : 'WARN', `${missingCn} missing meaningCn`);

  return finish(rules, args, { response, latencyMs, cacheKey, result });
}

function finish(rules, args, extra = {}) {
  const width = Math.max(...rules.map((r) => r.name.length));
  for (const r of rules) {
    console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = rules.filter((r) => r.status === 'FAIL').length;
  const warned = rules.filter((r) => r.status === 'WARN').length;
  console.log('');
  console.log(`${rules.length - failed - warned} PASS / ${warned} WARN / ${failed} FAIL`);

  if (args.out && extra.result) {
    fs.writeFileSync(args.out, JSON.stringify({
      generatedAt: new Date().toISOString(),
      base: args.base,
      httpStatus: extra.response?.status ?? null,
      latencyMs: extra.latencyMs ?? null,
      cacheKey: extra.cacheKey ?? null,
      rules,
      result: extra.result,
    }, null, 2));
    console.log(`report written to ${args.out}`);
  }
  return failed === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
