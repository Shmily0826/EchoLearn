/**
 * Vercel Edge Function — Dictionary lookup.
 *
 * Server-side pipeline that mirrors linkertube's /api/backend/dictionary/lookup.
 *
 * DESIGN: the dictionary is the source of truth for the base form.
 * Our hand-rolled lemmatizer only *proposes* candidates; a candidate is used
 * only if Free Dictionary actually has a headword for it. This is what stops
 * bugs like "trusted -> truste" from ever reaching the UI.
 *
 *   1. Fetch the raw clicked word AND the lemmatizer's best candidate in parallel.
 *   2. If the raw entry is really just an inflection pointer ("simple past tense
 *      of trust", "comparative of fast"), follow that pointer — the dictionary
 *      told us the true base form.
 *   3. Otherwise keep whichever real headword we found (raw first, candidate next).
 *   4. Translate the definitions to `target` via the shared Google gtx helper.
 *   5. Normalize into { ipa_uk, ipa_us, audio_url, base_form, entries }.
 *
 * Falls back to Datamuse if Free Dictionary has no entry.
 *
 * Usage:
 *   GET /api/dictionary?word=running&source=en&target=zh-CN
 *   -> 200 { ipa_uk, ipa_us, audio_url, base_form,
 *            entries: [{ pos, definitions:[{display_order, definitions_json:{definition}}] }] }
 *   -> 404 { error: "not found" }
 */

export const config = { runtime: 'edge' };

import { lemmatize } from '../src/utils/lemmatizer';
import { translateWithGoogle } from './_shared/translate';

// ── Config ────────────────────────────────────────────────────

const FREE_DICT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DATAMUSE_BASE = 'https://api.datamuse.com/words';

const MAX_WORD_LEN = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

/**
 * Upstream timeouts. These are deliberately tight: a word popup that takes 8s
 * is useless to a learner, and every tier here has a fallback behind it, so
 * giving up early is strictly better than waiting.
 */
const MW_TIMEOUT_MS = 4000;
const FREE_DICT_TIMEOUT_MS = 3000;
const DATAMUSE_TIMEOUT_MS = 3000;

/**
 * Translation targets we allow — prevents this endpoint being abused as a free
 * open translation proxy.
 */
const ALLOWED_TARGETS = new Set([
  'en', 'en-US', 'zh-CN', 'zh', 'ja', 'es', 'fr', 'de', 'ko', 'ru', 'pt', 'it',
]);

const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

// ── In-memory rate limiter (per Edge instance, best-effort) ──

const buckets = new Map<string, number[]>();
function pruneBuckets(cutoff: number): void {
  if (buckets.size < 5000) return;
  for (const [ip, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= cutoff) buckets.delete(ip);
  }
}
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let hits = buckets.get(ip);
  if (!hits) { hits = []; buckets.set(ip, hits); }
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  pruneBuckets(cutoff);
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  return false;
}
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// ── CORS ──────────────────────────────────────────────────────

function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith('.vercel.app')) return origin;
  return null;
}
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = resolveOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
function jsonResponse(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── Free Dictionary types ─────────────────────────────────────

interface FreePhonetic { text?: string; audio?: string; }
interface FreeDefinition { definition: string; example?: string; synonyms?: string[]; antonyms?: string[]; }
interface FreeMeaning { partOfSpeech: string; definitions: FreeDefinition[]; }
interface FreeEntry { word: string; phonetic?: string; phonetics?: FreePhonetic[]; meanings?: FreeMeaning[]; }

// ── Backend response type (linkertube-shaped) ─────────────────

interface BackendEntry {
  pos: string;
  definitions: Array<{ display_order: number; definitions_json: { definition: string } }>;
}
interface BackendResponse {
  ipa_uk: string;
  ipa_us: string;
  audio_url: string;
  base_form: string;
  entries: BackendEntry[];
  /** Which upstream produced this result — drives UI attribution. */
  source?: 'merriam-webster' | 'free-dictionary' | 'datamuse';
}

// ── Shared definition builder ─────────────────────────────────

/** Bound the work so translation stays fast and MW/gtx quotas stay healthy. */
const MAX_POS = 4;
const MAX_DEFS_PER_POS = 2;

type DefTask = { pos: string; original: string };

/**
 * Translate every definition in parallel, then group back by part of speech
 * while preserving source order.
 */
async function buildEntries(tasks: DefTask[], target: string): Promise<BackendEntry[]> {
  const translateNeeded = target !== 'en' && target !== 'en-US';

  const translated = await Promise.all(
    tasks.map(async (t) => {
      if (!translateNeeded) return t.original;
      try {
        return await translateWithGoogle(t.original, 'en', target);
      } catch {
        return t.original; // keep English on failure
      }
    }),
  );

  const grouped = new Map<string, string[]>();
  for (let i = 0; i < tasks.length; i++) {
    const arr = grouped.get(tasks[i].pos) || [];
    arr.push(translated[i]);
    grouped.set(tasks[i].pos, arr);
  }

  const out: BackendEntry[] = [];
  let order = 0;
  for (const [pos, defs] of grouped) {
    out.push({
      pos,
      definitions: defs.map((definition) => ({
        display_order: order++,
        definitions_json: { definition },
      })),
    });
  }
  return out;
}

// ── Free Dictionary fetch + normalize ─────────────────────────

/**
 * Free Dictionary (dictionaryapi.dev) is a free community service and goes down
 * regularly — it has been returning 502 for every request at times. Each lookup
 * fires up to 5 requests at it, so when it is down we were burning ~1.5s per
 * word waiting for failures before reaching Datamuse.
 *
 * A tiny circuit breaker fixes that: after a couple of consecutive infrastructure
 * failures we stop calling it for a while. 404 ("word not found") is a valid
 * answer, not a failure, so it never trips the breaker.
 */
const FD_BREAKER_THRESHOLD = 2;
const FD_BREAKER_COOLDOWN_MS = 60_000;
let fdFailures = 0;
let fdOpenUntil = 0;

function fdAvailable(): boolean {
  if (Date.now() < fdOpenUntil) return false;
  return true;
}
function fdNoteFailure(): void {
  if (++fdFailures >= FD_BREAKER_THRESHOLD) {
    fdOpenUntil = Date.now() + FD_BREAKER_COOLDOWN_MS;
    fdFailures = 0;
  }
}
function fdNoteSuccess(): void {
  fdFailures = 0;
  fdOpenUntil = 0;
}

async function fetchFreeDict(lemma: string): Promise<FreeEntry | null> {
  if (!fdAvailable()) return null;
  try {
    const res = await fetch(`${FREE_DICT_BASE}/${encodeURIComponent(lemma)}`, {
      signal: AbortSignal.timeout(FREE_DICT_TIMEOUT_MS),
    });
    // 404 = no such word (a real answer). 5xx/429 = the service is unwell.
    if (res.status >= 500 || res.status === 429) {
      fdNoteFailure();
      return null;
    }
    if (!res.ok) {
      fdNoteSuccess();
      return null;
    }
    const data = (await res.json()) as FreeEntry[];
    fdNoteSuccess();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0];
  } catch {
    // Timeout or network error — infrastructure problem.
    fdNoteFailure();
    return null;
  }
}

function extractPhonetic(entry: FreeEntry): { ipa: string; audio: string } {
  let ipa = '';
  let audio = '';
  if (entry.phonetics && entry.phonetics.length) {
    const withAudio = entry.phonetics.find((p) => p.audio && /^https?:/i.test(p.audio));
    const withText = entry.phonetics.find((p) => p.text && p.text.trim().length > 0);
    if (withAudio) { audio = withAudio.audio || ''; ipa = withAudio.text || ''; }
    if (!ipa && withText) ipa = withText.text ?? '';
  }
  if (!ipa) ipa = entry.phonetic || '';
  return { ipa, audio };
}

// ── Lemma resolution — the dictionary is the source of truth ──

/**
 * Matches a definition that is purely an inflection pointer, e.g.
 *   "simple past tense and past participle of trust"
 *   "comparative form of fast: more fast"
 *   "plural of leaf"
 * Capture group 1 is the base form the dictionary itself points at.
 */
const INFLECTION_POINTER_RE =
  /^\s*(?:the\s+)?(?:simple\s+past\s+tense|past\s+tense|past\s+participle|present\s+participle|third[-\s]person\s+singular[^.]*?|plural|singular|comparative(?:\s+form)?|superlative(?:\s+form)?|gerund|inflected\s+form|alternative\s+(?:form|spelling))\b[^.]*?\bof\s+["'\u201c\u2018]?([a-z][a-z'\u2019-]+)/i;

function isInflectionDef(text: string | undefined): boolean {
  return !!text && INFLECTION_POINTER_RE.test(text);
}

function pointerTarget(text: string | undefined): string | null {
  if (!text) return null;
  const m = INFLECTION_POINTER_RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Ask the dictionary entry itself for the base form.
 *
 * We only trust the pointer when it is high-confidence:
 *   a) it is the very first definition of the entry (the dictionary's primary
 *      reading of this word), or
 *   b) it agrees with what our lemmatizer independently proposed.
 * This avoids hijacking words like "saw" (noun: a tool) just because a rare
 * "past tense of see" sense is buried further down.
 */
function dictionaryBaseForm(entry: FreeEntry, candidates: string[]): string | null {
  const meanings = entry.meanings || [];
  if (meanings.length === 0) return null;

  const first = meanings[0]?.definitions?.[0]?.definition;
  const firstPointer = pointerTarget(first);
  if (firstPointer && firstPointer !== entry.word?.toLowerCase()) return firstPointer;

  const candSet = new Set(candidates);
  for (const m of meanings) {
    for (const d of m.definitions || []) {
      const p = pointerTarget(d.definition);
      if (p && candSet.has(p)) return p;
    }
  }
  return null;
}

/**
 * Cheap morphological guesses. These are *proposals only* — each one is
 * validated against the dictionary before it can become the displayed lemma.
 */
function candidateLemmas(word: string): string[] {
  const out: string[] = [];
  const push = (w: string | undefined): void => {
    if (!w) return;
    const c = w.toLowerCase();
    if (c === word || c.length < 2 || out.includes(c)) return;
    out.push(c);
  };

  try { push(lemmatize(word)); } catch { /* lemmatizer is best-effort */ }

  if (word.endsWith('ies') && word.length > 4) push(word.slice(0, -3) + 'y');
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    push(stem);            // trusted -> trust
    push(word.slice(0, -1)); // liked -> like
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // stopped -> stop
  }
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    push(stem);       // talking -> talk
    push(stem + 'e'); // making -> make
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1)); // running -> run
  }
  if (word.endsWith('es') && word.length > 3) push(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) push(word.slice(0, -1));

  return out.slice(0, 4);
}

async function freeEntryToBackend(
  entry: FreeEntry,
  target: string,
  baseFormOverride?: string,
): Promise<BackendResponse | null> {
  const meanings = entry.meanings || [];
  if (meanings.length === 0) return null;

  const tasks: DefTask[] = [];
  const seen = new Set<string>(); // dedupe exact duplicate definitions within a POS
  for (const m of meanings.slice(0, MAX_POS)) {
    const pos = m.partOfSpeech || '';
    if (!m.definitions || m.definitions.length === 0) continue;
    // Push bare "past tense of X" style pointers to the back — a learner wants
    // the real meaning first, not a grammar note.
    const ordered = [...m.definitions].sort(
      (a, b) => Number(isInflectionDef(a.definition)) - Number(isInflectionDef(b.definition)),
    );
    for (const d of ordered.slice(0, MAX_DEFS_PER_POS)) {
      const original = d.definition || '';
      if (!original) continue;
      const key = `${pos}::${original}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ pos, original });
    }
  }
  if (tasks.length === 0) return null;

  const out = await buildEntries(tasks, target);
  const { ipa, audio } = extractPhonetic(entry);
  // 省事版 (simple variant): Free Dictionary does not cleanly separate UK/US IPA,
  // so we use the one available IPA for both fields.
  return {
    ipa_uk: ipa,
    ipa_us: ipa,
    audio_url: audio,
    // Always a real dictionary headword — never a lemmatizer guess.
    base_form: baseFormOverride || entry.word || '',
    entries: out,
    source: 'free-dictionary',
  };
}

// ── Merriam-Webster Learner's Dictionary (primary, when key present) ──

/**
 * MW's Learner's Dictionary is written for ESL learners: senses are ordered by
 * how common they are (not by etymology), so it fixes the "first definition is
 * an obscure sense" problem that Free Dictionary has.
 *
 * It also solves lemmatization for free: querying "trusted" returns the "trust"
 * entry with meta.stems listing every inflected form. And unlike Free
 * Dictionary it labels the British pronunciation explicitly (l: "British"),
 * giving us genuine UK/US IPA.
 *
 * Requires MW_LEARNERS_KEY (free, non-commercial, 1000 req/day). When the env
 * var is absent this whole layer is skipped and we fall back to Free Dictionary.
 */
const MW_BASE = 'https://dictionaryapi.com/api/v3/references/learners/json';
const MW_AUDIO_BASE = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';

interface MwPron { ipa?: string; l?: string; sound?: { audio?: string } }
interface MwEntry {
  meta?: { id?: string; src?: string; stems?: string[] };
  hwi?: { hw?: string; prs?: MwPron[]; altprs?: MwPron[] };
  fl?: string;
  shortdef?: string[];
}

/** MW's audio files live in a subdirectory derived from the filename. */
function mwAudioUrl(audio: string): string {
  if (!audio) return '';
  let sub: string;
  if (audio.startsWith('bix')) sub = 'bix';
  else if (audio.startsWith('gg')) sub = 'gg';
  else if (/^[^a-zA-Z]/.test(audio)) sub = 'number';
  else sub = audio[0];
  return `${MW_AUDIO_BASE}/${sub}/${audio}.mp3`;
}

/** MW marks syllable breaks with '*' in the headword (e.g. "beau*ti*ful"). */
function mwHeadword(entry: MwEntry): string {
  return (entry.hwi?.hw || '').replace(/\*/g, '').trim().toLowerCase();
}

function mwProns(entry: MwEntry): MwPron[] {
  return entry.hwi?.prs || entry.hwi?.altprs || [];
}

/**
 * MW's stems list is generous — querying "went" also matches "unnoticed"
 * (because "went unnoticed" is a listed phrase). Keep an entry only when its
 * headword is plausibly the same lexeme as the query.
 *
 * `primaryHw` is MW's own top-ranked headword, which we always trust: that is
 * what rescues irregular forms our prefix test cannot see (went → go).
 */
function mwRelated(query: string, hw: string, primaryHw: string): boolean {
  if (!hw) return false;
  if (hw === query || hw === primaryHw) return true;
  // run/running, child/children, stop/stopped, trust/trusted, fast/faster …
  const [short, long] = hw.length <= query.length ? [hw, query] : [query, hw];
  return short.length >= 2 && long.startsWith(short);
}

/**
 * Why the last MW attempt did not produce an answer. Surfaced (without the
 * key) on X-Dict-Mw-Status so a bad key can be told apart from a genuine miss.
 */
let mwLastStatus = 'unused';

/**
 * Env values pasted through a dashboard often arrive wrapped in quotes or with
 * a stray newline. Those characters get percent-encoded into the query string
 * and MW rejects the request, which looks exactly like "no result".
 */
function readMwKey(): string {
  return (process.env.MW_LEARNERS_KEY || '').trim().replace(/^["']|["']$/g, '').trim();
}

async function fetchMerriamWebster(word: string, target: string): Promise<BackendResponse | null> {
  const key = readMwKey();
  if (!key) { mwLastStatus = 'no-key'; return null; }

  let data: unknown;
  try {
    const res = await fetch(`${MW_BASE}/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(MW_TIMEOUT_MS),
    });
    if (!res.ok) { mwLastStatus = `http-${res.status}`; return null; }
    data = await res.json();
  } catch (e) {
    mwLastStatus = `fetch-error-${(e as Error)?.name || 'unknown'}`;
    return null;
  }

  // A miss returns [] or an array of spelling suggestions (plain strings).
  if (!Array.isArray(data)) { mwLastStatus = 'bad-shape'; return null; }
  if (data.length === 0) { mwLastStatus = 'empty'; return null; }
  if (typeof data[0] === 'string') { mwLastStatus = 'suggestions'; return null; }

  // Keep only real learner entries that actually cover the queried word.
  // meta.stems is MW's own inflection list, so this is the dictionary telling
  // us "trusted belongs to trust" — no guessing on our side.
  // Drop stub entries (no shortdef, e.g. the bare "went" cross-reference) and
  // anything that does not actually cover the queried word.
  const covering = (data as MwEntry[]).filter((e) => {
    if (!Array.isArray(e.shortdef) || e.shortdef.length === 0) return false;
    const stems = (e.meta?.stems || []).map((s) => s.toLowerCase());
    return stems.includes(word) || mwHeadword(e) === word;
  });
  if (covering.length === 0) { mwLastStatus = 'no-covering-entry'; return null; }

  // MW ranks the best match first — use it as the anchor, then keep only
  // same-lexeme entries so noise like "went" → "unnoticed" cannot leak in.
  const primaryHw = mwHeadword(covering[0]);
  const entries = covering.filter((e) => mwRelated(word, mwHeadword(e), primaryHw));
  if (entries.length === 0) { mwLastStatus = 'no-related-entry'; return null; }

  // Definitions: up to MAX_POS parts of speech, MAX_DEFS_PER_POS senses each.
  const tasks: DefTask[] = [];
  const perPos = new Map<string, number>();
  for (const e of entries) {
    const pos = (e.fl || '').trim();
    if (perPos.size >= MAX_POS && !perPos.has(pos)) continue;
    for (const raw of e.shortdef || []) {
      const used = perPos.get(pos) || 0;
      if (used >= MAX_DEFS_PER_POS) break;
      // MW prefixes usage notes with an em dash, e.g. "—used as a contraction of".
      const original = raw.replace(/^[\s—–-]+/, '').trim();
      if (!original) continue;
      perPos.set(pos, used + 1);
      tasks.push({ pos, original });
    }
  }
  if (tasks.length === 0) { mwLastStatus = 'no-definitions'; return null; }

  // Pronunciation: MW flags the British variant, everything else is US.
  let ipaUs = '';
  let ipaUk = '';
  let audio = '';
  for (const e of entries) {
    for (const p of mwProns(e)) {
      const isBritish = (p.l || '').toLowerCase().includes('british');
      if (isBritish) { if (!ipaUk && p.ipa) ipaUk = p.ipa; }
      else if (!ipaUs && p.ipa) ipaUs = p.ipa;
      if (!audio && p.sound?.audio) audio = mwAudioUrl(p.sound.audio);
    }
    if (ipaUs && ipaUk && audio) break;
  }

  const out = await buildEntries(tasks, target);
  if (out.length === 0) { mwLastStatus = 'translate-failed'; return null; }

  mwLastStatus = 'ok';
  return {
    ipa_uk: ipaUk || ipaUs,
    ipa_us: ipaUs || ipaUk,
    audio_url: audio,
    // MW's own headword — authoritative base form.
    base_form: mwHeadword(entries[0]) || word,
    entries: out,
    source: 'merriam-webster',
  };
}

// ── Datamuse fallback ─────────────────────────────────────────

/**
 * Datamuse encodes pronunciation with `md=r&ipa=1`, e.g. `ipa_pron:hʌɫˈoʊ`.
 * It is machine-generated from CMUdict, so it uses a few symbols that look
 * wrong to learners (dark-l `ɫ`, `ɝ`/`ɚ` r-colored vowels). Normalise them to
 * the notation dictionaries actually print.
 */
function normalizeIpa(raw: string): string {
  return raw
    .replace(/ɫ/g, 'l')
    .replace(/ɝ/g, 'ɜr')
    .replace(/ɚ/g, 'ər')
    .trim();
}

/** Pull a `prefix:value` tag out of Datamuse's flat tag list. */
function datamuseTag(tags: string[] | undefined, prefix: string): string {
  const hit = (tags || []).find((t) => t.startsWith(`${prefix}:`));
  return hit ? hit.slice(prefix.length + 1).trim() : '';
}

async function fetchFromDatamuse(word: string, target: string): Promise<BackendResponse | null> {
  try {
    // md=d definitions · md=p part of speech · md=r pronunciation · ipa=1 → IPA
    // instead of ARPABET. This is the only tier that works without an API key,
    // so it must still carry phonetics.
    const res = await fetch(`${DATAMUSE_BASE}?sp=${encodeURIComponent(word)}&md=dpr&ipa=1&max=10`, {
      signal: AbortSignal.timeout(DATAMUSE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (Array.isArray(data) ? data : []).find(
      (d: { word?: string; defs?: string[] }) =>
        d.word?.toLowerCase() === word.toLowerCase() && Array.isArray(d.defs) && d.defs.length > 0,
    ) as { word?: string; defs?: string[]; tags?: string[] } | undefined;
    if (!hit) return null;

    const POS_MAP: Record<string, string> = {
      n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: '',
    };

    // Datamuse defs look like "adj\treliable". Group them by part of speech so
    // the popup shows the same multi-sense layout as the MW tier.
    const tasks: DefTask[] = [];
    for (const rawDef of hit.defs!) {
      const tab = rawDef.indexOf('\t');
      const posAbbr = tab >= 0 ? rawDef.slice(0, tab) : '';
      const text = (tab >= 0 ? rawDef.slice(tab + 1) : rawDef).trim();
      if (!text) continue;
      const pos = POS_MAP[posAbbr] ?? '';
      if (tasks.filter((t) => t.pos === pos).length >= MAX_DEFS_PER_POS) continue;
      if (!tasks.some((t) => t.pos === pos) && new Set(tasks.map((t) => t.pos)).size >= MAX_POS) continue;
      tasks.push({ pos, original: text });
      if (tasks.length >= MAX_POS * MAX_DEFS_PER_POS) break;
    }
    if (tasks.length === 0) return null;

    // Translate every sense in parallel — sequential calls were the main
    // reason the fallback felt sluggish.
    let texts = tasks.map((t) => t.original);
    if (target !== 'en' && target !== 'en-US') {
      texts = await Promise.all(
        tasks.map((t) =>
          translateWithGoogle(t.original, 'en', target).catch(() => t.original),
        ),
      );
    }

    const byPos = new Map<string, BackendEntry>();
    tasks.forEach((task, i) => {
      let entry = byPos.get(task.pos);
      if (!entry) {
        entry = { pos: task.pos, definitions: [] };
        byPos.set(task.pos, entry);
      }
      entry.definitions.push({
        display_order: entry.definitions.length,
        definitions_json: { definition: texts[i] },
      });
    });

    const ipa = normalizeIpa(datamuseTag(hit.tags, 'ipa_pron'));
    return {
      // CMUdict is a US pronunciation dictionary, so only claim US here.
      ipa_uk: '', ipa_us: ipa, audio_url: '', base_form: word,
      entries: [...byPos.values()],
      source: 'datamuse',
    };
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────

/**
 * Non-secret diagnostics on the response headers. Lets us tell "MW key is
 * missing on Vercel" apart from "MW is rate-limited" apart from "Free
 * Dictionary is down" with a single `curl -i`, without ever echoing the key.
 */
function diagHeaders(source: string | undefined): Record<string, string> {
  return {
    'X-Dict-Source': source || 'none',
    // Length only — enough to spot a truncated or quote-wrapped paste.
    'X-Dict-Mw-Key': readMwKey() ? `configured-${readMwKey().length}` : 'missing',
    'X-Dict-Mw-Status': mwLastStatus,
    'X-Dict-Fd-Breaker': fdAvailable() ? 'closed' : 'open',
  };
}

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }
  if (isRateLimited(getClientIp(request))) {
    return jsonResponse({ error: 'Too many requests, please slow down' }, 429, origin);
  }

  const url = new URL(request.url);
  const word = (url.searchParams.get('word') || '').trim().toLowerCase();
  let target = (url.searchParams.get('target') || 'zh-CN').trim();
  if (!ALLOWED_TARGETS.has(target)) target = 'zh-CN';

  if (!word || word.length > MAX_WORD_LEN) {
    return jsonResponse({ error: 'Invalid word' }, 400, origin);
  }

  // ── Tier 1: Merriam-Webster Learner's (best sense ordering + real UK/US IPA).
  // Skipped automatically when MW_LEARNERS_KEY is not configured.
  const mw = await fetchMerriamWebster(word, target);
  if (mw) {
    return new Response(JSON.stringify(mw), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800',
        ...diagHeaders(mw.source),
        ...corsHeaders(origin),
      },
    });
  }

  // ── Tier 2: Free Dictionary.
  // Resolve the headword — dictionary wins; lemmatizer only proposes. ──
  const candidates = candidateLemmas(word);

  // One round-trip for the raw word, one for the best candidate — in parallel,
  // so the extra accuracy costs no latency.
  const [rawEntry, candEntry] = await Promise.all([
    fetchFreeDict(word),
    candidates.length > 0 ? fetchFreeDict(candidates[0]) : Promise.resolve(null),
  ]);

  let chosen: FreeEntry | null = null;
  let baseForm = '';

  if (rawEntry) {
    const pointer = dictionaryBaseForm(rawEntry, candidates);
    if (pointer && pointer !== word) {
      // The dictionary itself says this is an inflected form — follow it.
      const target0 =
        candEntry && candEntry.word?.toLowerCase() === pointer
          ? candEntry
          : await fetchFreeDict(pointer);
      chosen = target0 ?? rawEntry;
      baseForm = (target0?.word || pointer).toLowerCase();
    } else {
      chosen = rawEntry;
      baseForm = (rawEntry.word || word).toLowerCase();
    }
  } else if (candEntry) {
    // Raw word is not a headword (e.g. "aren't"), and the dictionary confirmed
    // our candidate is real → safe to use it as the base form.
    chosen = candEntry;
    baseForm = (candEntry.word || candidates[0]).toLowerCase();
  }

  let response: BackendResponse | null = chosen
    ? await freeEntryToBackend(chosen, target, baseForm)
    : null;

  if (!response && candidates.length > 1) {
    // Try the remaining proposals in parallel; first validated one wins.
    const rest = await Promise.all(candidates.slice(1, 4).map((c) => fetchFreeDict(c)));
    const hit = rest.find((e): e is FreeEntry => !!e);
    if (hit) response = await freeEntryToBackend(hit, target, (hit.word || '').toLowerCase());
  }

  if (!response) response = await fetchFromDatamuse(word, target);
  if (!response && candidates.length > 0) response = await fetchFromDatamuse(candidates[0], target);

  if (!response) {
    return jsonResponse({ error: 'not found' }, 404, origin);
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800',
      ...diagHeaders(response.source),
      ...corsHeaders(origin),
    },
  });
}
