import type { DictionaryEntry } from '../types';

const CACHE_KEY = 'echolearn_dictionary_cache';
const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

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
 * Look up a word in the Free Dictionary API.
 * Returns a DictionaryEntry on success, or null if the word was not found
 * or the API request failed.
 *
 * Results are cached in localStorage to avoid repeated requests.
 */
export async function lookupWord(word: string): Promise<DictionaryEntry | null> {
  const cleaned = cleanWord(word);
  if (!cleaned) return null;

  // Check cache first
  const cache = loadCache();
  if (cleaned in cache) {
    return cache[cleaned]; // may be null (known miss)
  }

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(cleaned)}`);

    if (!response.ok) {
      // 404 = word not found, other = API error
      cache[cleaned] = null;
      saveCache(cache);
      return null;
    }

    const data: ApiEntry[] = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      cache[cleaned] = null;
      saveCache(cache);
      return null;
    }

    const entry = parseApiEntry(data[0]);
    cache[cleaned] = entry;
    saveCache(cache);
    return entry;
  } catch {
    // Network error — don't cache (might succeed later)
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
