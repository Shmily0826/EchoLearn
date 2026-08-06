/**
 * Vercel Edge Function — Dictionary lookup.
 *
 * Server-side pipeline that mirrors linkertube's /api/backend/dictionary/lookup:
 *   1. Lemmatize the input word (reuses src/utils/lemmatizer — single source of
 *      truth, includes the -er base-form fix).
 *   2. Fetch the base form from Free Dictionary API (no CORS issues server-side).
 *   3. Translate each primary definition to `target` via the shared Google gtx
 *      helper (same one used by /api/translate).
 *   4. Normalize into { ipa_uk, ipa_us, audio_url, base_form, entries }.
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
}

// ── Free Dictionary fetch + normalize ─────────────────────────

async function fetchFreeDict(lemma: string): Promise<FreeEntry | null> {
  try {
    const res = await fetch(`${FREE_DICT_BASE}/${encodeURIComponent(lemma)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as FreeEntry[];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0];
  } catch {
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

async function freeEntryToBackend(entry: FreeEntry, target: string): Promise<BackendResponse | null> {
  const meanings = entry.meanings || [];
  if (meanings.length === 0) return null;
  const translateNeeded = target !== 'en' && target !== 'en-US';

  // Bound the work: up to 3 POS, up to 2 definitions per POS (Free Dictionary's
  // most-common senses). This exposes the common definition to the popup while
  // keeping Google gtx translation calls bounded.
  const MAX_POS = 3;
  const MAX_DEFS_PER_POS = 2;

  type Task = { pos: string; original: string };
  const tasks: Task[] = [];
  const seen = new Set<string>(); // dedupe exact duplicate definitions within a POS
  for (const m of meanings.slice(0, MAX_POS)) {
    const pos = m.partOfSpeech || '';
    if (!m.definitions || m.definitions.length === 0) continue;
    for (const d of m.definitions.slice(0, MAX_DEFS_PER_POS)) {
      const original = d.definition || '';
      if (!original) continue;
      const key = `${pos}::${original}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ pos, original });
    }
  }
  if (tasks.length === 0) return null;

  // Translate all definitions in parallel (much faster than sequential await).
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

  // Group translations back by POS, preserving source order.
  const grouped = new Map<string, string[]>();
  for (let i = 0; i < tasks.length; i++) {
    const { pos } = tasks[i];
    const arr = grouped.get(pos) || [];
    arr.push(translated[i]);
    grouped.set(pos, arr);
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

  const { ipa, audio } = extractPhonetic(entry);
  // 省事版 (simple variant): Free Dictionary does not cleanly separate UK/US IPA,
  // so we use the one available IPA for both fields.
  return { ipa_uk: ipa, ipa_us: ipa, audio_url: audio, base_form: entry.word || '', entries: out };
}

// ── Datamuse fallback ─────────────────────────────────────────

async function fetchFromDatamuse(word: string, target: string): Promise<BackendResponse | null> {
  try {
    const res = await fetch(`${DATAMUSE_BASE}?sp=${encodeURIComponent(word)}&md=d&max=10`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (Array.isArray(data) ? data : []).find(
      (d: { word?: string; defs?: string[] }) =>
        d.word?.toLowerCase() === word.toLowerCase() && Array.isArray(d.defs) && d.defs.length > 0,
    );
    if (!hit) return null;
    const POS_MAP: Record<string, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
    const firstDef = hit.defs![0];
    const tab = firstDef.indexOf('\t');
    const posAbbr = tab >= 0 ? firstDef.slice(0, tab) : '';
    const defText = (tab >= 0 ? firstDef.slice(tab + 1) : firstDef).trim();
    let translated = defText;
    if (target !== 'en' && target !== 'en-US') {
      try { translated = await translateWithGoogle(defText, 'en', target); } catch { /* keep English on failure */ }
    }
    return {
      ipa_uk: '', ipa_us: '', audio_url: '', base_form: word,
      entries: [{ pos: POS_MAP[posAbbr] ?? '', definitions: [{ display_order: 0, definitions_json: { definition: translated } }] }],
    };
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────

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

  const base = lemmatize(word);

  let response: BackendResponse | null = await fetchFreeDict(base).then((e) =>
    e ? freeEntryToBackend(e, target) : null,
  );
  if (!response) response = await fetchFromDatamuse(base, target);
  if (!response && base !== word) {
    // Last resort: try the original (un-lemmatized) word.
    response = (await fetchFreeDict(word).then((e) => (e ? freeEntryToBackend(e, target) : null))) ?? null;
    if (!response) response = await fetchFromDatamuse(word, target);
  }

  if (!response) {
    return jsonResponse({ error: 'not found' }, 404, origin);
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800',
      ...corsHeaders(origin),
    },
  });
}
