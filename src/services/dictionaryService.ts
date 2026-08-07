import type { DictionaryEntry } from '../types';
import { lemmatize } from '../utils/lemmatizer';
import { KNOWN_PROPER_NOUNS, isKnownProperNoun } from '../utils/properNouns';

export { isKnownProperNoun };

/**
 * v4: primary path is the self-hosted backend /api/dictionary, which does
 * server-side lemmatization (reusing src/utils/lemmatizer) + Free Dictionary
 * fetch + server translation + CDN caching, and returns a linkertube-shaped
 * payload { ipa_uk, ipa_us, audio_url, base_form, entries }.
 *
 * If the backend is unreachable (e.g. `vercel dev` is not running locally, or
 * the edge function is down) we fall back to the previous client-side Free
 * Dictionary + Datamuse racing so the popup never hard-fails.
 */

const CACHE_KEY = 'echolearn_dictionary_cache_v4';
const API_BASE = '/api/dictionary';

const FREE_DICT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DATAMUSE_BASE = 'https://api.datamuse.com/words';

// ── Cache helpers ──────────────────────────────────────────────

interface CacheStore {
  [key: string]: DictionaryEntry & { lemma?: string }; // only successful lookups; never store null/miss
}

function loadCache(): CacheStore {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: CacheStore): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// ── Word cleaning ──────────────────────────────────────────────

/** Strip surrounding punctuation from a word for lookup (keeps contractions). */
function cleanWord(word: string): string {
  return word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
}

// ── Backend response type (mirrors linkertube shape) ───────────

interface BackendDefinition {
  display_order: number;
  definitions_json: { definition: string };
}
interface BackendEntry {
  pos: string;
  definitions: BackendDefinition[];
}
interface BackendResponse {
  ipa_uk: string;
  ipa_us: string;
  audio_url: string;
  base_form: string;
  entries: BackendEntry[];
  source?: 'merriam-webster' | 'free-dictionary' | 'datamuse';
  word_translation?: string;
}

/** Human-readable provider label, used for attribution in the popup. */
const PROVIDER_LABELS: Record<string, string> = {
  'merriam-webster': 'Merriam-Webster',
  'free-dictionary': 'Free Dictionary',
  datamuse: 'Datamuse',
};

// ── Primary: backend lookup ────────────────────────────────────

async function fetchFromBackend(
  cleaned: string,
  target: string,
): Promise<(DictionaryEntry & { lemma?: string }) | null> {
  try {
    const url =
      `${API_BASE}?word=${encodeURIComponent(cleaned)}` +
      `&source=en&target=${encodeURIComponent(target)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null; // 404 / backend error → fall back below
    const raw: BackendResponse = await res.json();
    if (!raw.entries || raw.entries.length === 0) return null;

    const firstEntry = raw.entries[0];
    const firstDef = firstEntry?.definitions?.[0]?.definitions_json?.definition ?? '';
    // Prefer US as the single-line phonetic (matches the TTS voice we use),
    // but keep both so the popup can show "UK … US …" when they differ.
    const phonetic = raw.ipa_us || raw.ipa_uk;

    // Flatten every (POS, definition) the backend returned so the popup can
    // show all common senses (the most common fix for "wrong sense" complaints).
    const definitionsEn: Array<{ pos: string; definition: string }> = [];
    for (const entry of raw.entries) {
      if (!entry?.definitions) continue;
      for (const d of entry.definitions) {
        const text = d?.definitions_json?.definition;
        if (!text) continue;
        definitionsEn.push({ pos: entry.pos || '', definition: text });
      }
    }

    return {
      word: cleaned,
      phonetic,
      phoneticUk: raw.ipa_uk || undefined,
      phoneticUs: raw.ipa_us || undefined,
      audioUrl: raw.audio_url || '',
      partOfSpeech: firstEntry?.pos || '',
      definitionEn: firstDef,
      definitionsEn: definitionsEn.length > 0 ? definitionsEn : undefined,
      example: '',
      synonyms: [],
      antonyms: [],
      provider: raw.source ? PROVIDER_LABELS[raw.source] ?? raw.source : 'EchoLearn Dictionary API',
      wordCn: raw.word_translation || undefined,
      lemma: raw.base_form && raw.base_form !== cleaned ? raw.base_form : undefined,
    };
  } catch {
    return null;
  }
}

// ── Fallback: client-side Free Dictionary + Datamuse (v3 logic) ──

interface ApiPhonetic {
  text?: string;
  audio?: string;
}

interface ApiDefinition {
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
}

interface ApiMeaning {
  partOfSpeech: string;
  definitions: ApiDefinition[];
  synonyms?: string[];
  antonyms?: string[];
}

interface ApiEntry {
  word: string;
  phonetic?: string;
  phonetics?: ApiPhonetic[];
  meanings?: ApiMeaning[];
  sourceUrls?: string[];
}

/**
 * Build ordered spelling variants to try for a cleaned word.
 * Tries lemma first, then original, plus hyphen parts and -ly root.
 */
function buildCandidates(cleaned: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (w: string) => {
    const lw = w.toLowerCase();
    if (lw && !seen.has(lw)) { seen.add(lw); out.push(lw); }
  };

  const lemma = lemmatize(cleaned);
  push(lemma);
  push(cleaned);

  // Hyphenated compounds
  if (cleaned.includes('-')) {
    for (const part of cleaned.split('-')) {
      if (part) push(lemmatize(part));
    }
    push(cleaned.replace(/-/g, ''));
  }

  // -ly adverbs: try adjective root as last resort
  if (cleaned.endsWith('ly') && cleaned.length > 4) {
    push(cleaned.slice(0, -2));
  }

  return out;
}

async function fetchFromFreeDict(word: string): Promise<DictionaryEntry | null> {
  try {
    const res = await fetch(`${FREE_DICT_BASE}/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: ApiEntry[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return parseFreeDictEntry(data[0]);
  } catch {
    return null;
  }
}

async function fetchFromDatamuse(word: string): Promise<DictionaryEntry | null> {
  try {
    const res = await fetch(`${DATAMUSE_BASE}?sp=${encodeURIComponent(word)}&md=d&max=10`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const hit = data.find(
      (d: { word?: string; defs?: string[] }) =>
        d.word?.toLowerCase() === word.toLowerCase() &&
        Array.isArray(d.defs) &&
        d.defs.length > 0,
    );
    if (!hit) return null;

    const POS_MAP: Record<string, string> = {
      n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb',
    };
    const firstDef = hit.defs![0];
    const tab = firstDef.indexOf('\t');
    const posAbbr = tab >= 0 ? firstDef.slice(0, tab) : '';
    const defText = (tab >= 0 ? firstDef.slice(tab + 1) : firstDef).trim();

    return {
      word: hit.word ?? word,
      phonetic: '',
      audioUrl: '',
      partOfSpeech: POS_MAP[posAbbr] ?? '',
      definitionEn: defText,
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Datamuse',
    };
  } catch {
    return null;
  }
}

function parseFreeDictEntry(raw: ApiEntry): DictionaryEntry {
  let phonetic = '';
  let audioUrl = '';
  if (raw.phonetics) {
    const withAudio = raw.phonetics.find((p) => p.audio && p.audio.length > 0);
    const withText = raw.phonetics.find((p) => p.text && p.text.length > 0);
    if (withAudio) { audioUrl = withAudio.audio || ''; phonetic = withAudio.text || ''; }
    if (!phonetic && withText) phonetic = withText.text ?? '';
    if (!phonetic) phonetic = raw.phonetic || '';
  }

  let partOfSpeech = '';
  let definitionEn = '';
  let example = '';
  let synonyms: string[] = [];
  let antonyms: string[] = [];

  if (raw.meanings && raw.meanings.length > 0) {
    const meaning = raw.meanings[0];
    partOfSpeech = meaning.partOfSpeech || '';
    if (meaning.definitions && meaning.definitions.length > 0) {
      const def = meaning.definitions[0];
      definitionEn = def.definition || '';
      example = def.example || '';
      synonyms = def.synonyms || meaning.synonyms || [];
      antonyms = def.antonyms || meaning.antonyms || [];
    }
  }

  return {
    word: raw.word || '',
    phonetic,
    audioUrl,
    partOfSpeech,
    definitionEn,
    example,
    synonyms: synonyms.slice(0, 8),
    antonyms: antonyms.slice(0, 8),
    provider: 'Free Dictionary API',
  };
}

async function fetchEntryParallel(word: string): Promise<DictionaryEntry | null> {
  const cache = loadCache();
  if (word in cache) return cache[word];
  if (sessionMisses.has(word)) return null;

  try {
    const [freeDictResult, datamuseResult] = await Promise.allSettled([
      fetchFromFreeDict(word),
      fetchFromDatamuse(word),
    ]);

    const freeDict = freeDictResult.status === 'fulfilled' ? freeDictResult.value : null;
    const datamuse = datamuseResult.status === 'fulfilled' ? datamuseResult.value : null;

    const winner = freeDict ?? datamuse;
    if (winner) {
      cache[word] = winner;
      saveCache(cache);
      return winner;
    }

    sessionMisses.add(word);
    saveSessionMisses(sessionMisses);
    return null;
  } catch {
    return null;
  }
}

// ── Session miss cache (in-memory only, survives page reload via
//   sessionStorage for reduced re-fetching within a browsing session) ──

const SESSION_KEY = 'echolearn_dict_session_misses_v4';

function loadSessionMisses(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSessionMisses(s: Set<string>): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...s]));
  } catch { /* sessionStorage unavailable */ }
}

let sessionMisses = loadSessionMisses();

// ── Main lookup ───────────────────────────────────────────────

/**
 * Look up a word.
 *
 * 1. Backend /api/dictionary (server-side lemmatization + translation + cache).
 *    `target` selects the translation language (default 'zh-CN'). Results are
 *    cached per (word, target).
 * 2. If the backend is unavailable, fall back to client-side Free Dictionary +
 *    Datamuse racing (English only) so the popup still works in local dev.
 */
export async function lookupWord(
  word: string,
  target = 'zh-CN',
): Promise<(DictionaryEntry & { lemma?: string }) | null> {
  const cleaned = cleanWord(word);
  if (!cleaned) return null;

  // Known proper nouns / brands — skip all APIs
  if (KNOWN_PROPER_NOUNS.has(cleaned)) return null;

  const cache = loadCache();
  const backendKey = `${cleaned}:${target}`;

  // 1. Backend (primary)
  if (backendKey in cache) return cache[backendKey];
  const backend = await fetchFromBackend(cleaned, target);
  if (backend) {
    cache[backendKey] = backend;
    saveCache(cache);
    const lemma = backend.lemma && backend.lemma !== cleaned ? backend.lemma : undefined;
    return { ...backend, lemma };
  }

  // 2. Fallback (client-side) — note: English only, no server translation
  for (const candidate of buildCandidates(cleaned)) {
    const result = await fetchEntryParallel(candidate);
    if (result) {
      const lemma = candidate === cleaned ? undefined : candidate;
      const cached: DictionaryEntry & { lemma?: string } = { ...result, lemma };
      cache[candidate] = cached;
      saveCache(cache);
      return cached;
    }
  }

  return null;
}
