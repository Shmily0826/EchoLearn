import type { DictionaryEntry } from '../types';
import { lemmatize } from '../utils/lemmatizer';
import { KNOWN_PROPER_NOUNS, isKnownProperNoun } from '../utils/properNouns';

export { isKnownProperNoun };

// v2: invalidates older caches that may have been poisoned with permanent
// `null` (miss) entries during Free Dictionary API outages.
const CACHE_KEY = 'echolearn_dictionary_cache_v2';
const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DATAMUSE_BASE = 'https://api.datamuse.com/words';

// ── Cache helpers ──────────────────────────────────────────────

interface CacheStore {
  [word: string]: DictionaryEntry | null; // null = known miss (avoids retrying)
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

// ── API response types (Free Dictionary API) ───────────────────

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

// ── Main lookup function ───────────────────────────────────────

/**
 * Build the ordered list of spelling variants to try for a cleaned word.
 * Tries the lemma first, then the original, plus hyphen-part and -ly-adverb
 * best-effort variants so more subtitle words resolve to a definition.
 */
function buildCandidates(cleaned: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (w: string) => {
    const lw = w.toLowerCase();
    if (lw && !seen.has(lw)) {
      seen.add(lw);
      out.push(lw);
    }
  };

  const lemma = lemmatize(cleaned);
  push(lemma);
  push(cleaned);

  // Hyphenated compounds: try each part and the de-hyphenated form
  if (cleaned.includes('-')) {
    for (const part of cleaned.split('-')) {
      if (part) push(lemmatize(part));
    }
    push(cleaned.replace(/-/g, ''));
  }

  // -ly adverbs: best-effort adjective root (tried last, after the adverb itself)
  if (cleaned.endsWith('ly') && cleaned.length > 4) {
    push(cleaned.slice(0, -2));
  }

  return out;
}

/**
 * Look up a word across the Free Dictionary API (primary) and Datamuse (fallback).
 * Returns a DictionaryEntry on success, or null if no source had the word.
 * Results are cached in localStorage to avoid repeated requests.
 */
export async function lookupWord(word: string): Promise<(DictionaryEntry & { lemma?: string }) | null> {
  const cleaned = cleanWord(word);
  if (!cleaned) return null;
  // Skip the dictionary API for known brands / abbreviations / proper nouns —
  // they are never in the free dictionaries, so this avoids a wasted request.
  if (KNOWN_PROPER_NOUNS.has(cleaned)) return null;

  for (const candidate of buildCandidates(cleaned)) {
    const result = await fetchEntry(candidate);
    if (result) {
      // Expose the form we actually resolved to, if different from the clicked word
      const lemma = candidate === cleaned ? undefined : candidate;
      return { ...result, lemma };
    }
  }

  return null;
}

/**
 * Second free dictionary source (Datamuse, WordNet-backed, no API key, CORS-enabled).
 * Used as a fallback when the primary Free Dictionary API has no entry.
 * Returns a minimal DictionaryEntry (definition + part of speech only).
 */
async function fetchFromDatamuse(word: string): Promise<DictionaryEntry | null> {
  try {
    const res = await fetch(`${DATAMUSE_BASE}?sp=${encodeURIComponent(word)}&md=d&max=10`);
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
      n: 'noun',
      v: 'verb',
      adj: 'adjective',
      adv: 'adverb',
    };
    const firstDef = hit.defs![0];
    const tab = firstDef.indexOf('\t');
    const posAbbr = tab >= 0 ? firstDef.slice(0, tab) : '';
    const defText = (tab >= 0 ? firstDef.slice(tab + 1) : firstDef).trim();

    return {
      word: hit.word!,
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

// Session-only miss memory (not persisted). Prevents re-querying the same
// missing word repeatedly within a session, WITHOUT permanently poisoning
// localStorage with `null` if an upstream API was temporarily down.
const sessionMisses = new Set<string>();

/** Fetch a single entry from cache or API. Returns null on miss. */
async function fetchEntry(word: string): Promise<DictionaryEntry | null> {
  const cache = loadCache();
  if (word in cache) {
    return cache[word]; // a persisted, found entry (we no longer persist misses)
  }
  if (sessionMisses.has(word)) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(word)}`);
    const ok = response.ok;
    let data: ApiEntry[] = [];
    if (ok) {
      try {
        data = await response.json();
      } catch {
        data = [];
      }
    }

    if (!ok || !Array.isArray(data) || data.length === 0) {
      // Primary source missed — try a second free dictionary source before giving up.
      const fallback = await fetchFromDatamuse(word);
      if (fallback) {
        cache[word] = fallback;
        saveCache(cache);
        return fallback;
      }
      // Both sources missed. Only remember for this session — never persist a
      // `null`, so a transient outage can't permanently mark a word "not found".
      sessionMisses.add(word);
      return null;
    }

    const entry = parseApiEntry(data[0]);
    cache[word] = entry;
    saveCache(cache);
    return entry;
  } catch {
    // Network error — don't cache at all (might succeed later)
    return null;
  }
}

/**
 * Parse the first API entry into our DictionaryEntry format.
 * Picks the first meaningful definition across all parts of speech.
 */
function parseApiEntry(raw: ApiEntry): DictionaryEntry {
  // Find phonetic: prefer one with both text and audio
  let phonetic = '';
  let audioUrl = '';
  if (raw.phonetics) {
    const withAudio = raw.phonetics.find(
      (p) => p.audio && p.audio.length > 0,
    );
    const withText = raw.phonetics.find((p) => p.text && p.text.length > 0);
    if (withAudio) {
      audioUrl = withAudio.audio || '';
      phonetic = withAudio.text || '';
    }
    if (!phonetic && withText) {
      phonetic = withText.text || '';
    }
    // Fallback: raw.phonetic field
    if (!phonetic) {
      phonetic = raw.phonetic || '';
    }
  }

  // Find first meaningful definition
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
    synonyms: synonyms.slice(0, 8),  // limit to keep data small
    antonyms: antonyms.slice(0, 8),
    provider: 'Free Dictionary API',
  };
}
