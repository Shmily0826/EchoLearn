/**
 * Translation service — uses DeepSeek API to backfill translations
 * for vocabulary words and sentences that were manually added without meaningCn.
 */

import { checkAiRateLimit, rateLimitWaitSeconds } from './aiRateLimit';

/** Requests go through the server-side proxy at /api/ai (API key stays server-side). */
const DEEPSEEK_ENDPOINT = '/api/ai';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// ── localStorage cache (per-device, per-browser) ───────────────
// Caches single-word translations so the dictionary popup / auto-translate
// on save don't re-hit DeepSeek for the same word. Same scope as the
// dictionary cache in dictionaryService.ts (device-local, not shared/server).
const TRANSLATE_CACHE_KEY = 'echolearn_translation_cache';

interface TranslationCacheStore {
  [key: string]: string;
}

function loadTranslationCache(): TranslationCacheStore {
  try {
    const raw = localStorage.getItem(TRANSLATE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTranslationCache(cache: TranslationCacheStore): void {
  try {
    localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Supported target languages for translation */
export const TRANSLATE_LANGS: Record<string, string> = {
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  vi: 'Tiếng Việt',
  th: 'ไทย',
};

export type TranslateLang = keyof typeof TRANSLATE_LANGS;

interface TranslateItem {
  id: string;
  text: string;
  context?: string;
}

/**
 * Small stable hash so we can fold the (potentially long) context into a short
 * cache key without bloating localStorage.
 */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

/**
 * Batch-translate a list of words / sentences using DeepSeek.
 * @param targetLang  Target language code (default: 'zh')
 * Returns a map of id → translated text.
 */
async function callBatchTranslate(
  items: TranslateItem[],
  kind: 'word' | 'sentence',
  targetLang: TranslateLang = 'zh',
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  // Client-side rate limit: shared 10 calls/min budget with AI analysis
  if (!checkAiRateLimit()) {
    const wait = rateLimitWaitSeconds();
    console.warn(`[translation] Rate limited, retry after ${wait}s`);
    return {};
  }

  const kindLabel = kind === 'word' ? 'English vocabulary word' : 'English sentence';
  const langName = TRANSLATE_LANGS[targetLang] ?? 'Chinese';

  const systemPrompt = `You are a professional English-to-${langName} translator.
Translate each ${kindLabel} into natural, accurate, concise ${langName}.
Return ONLY a valid JSON array of strings — no markdown fences, no explanation.
The array must have exactly ${items.length} element(s), in the same order as the input.`;

  const numbered = items
    .map((item, i) => {
      const ctx = item.context ? ` (context: "${item.context}")` : '';
      return `${i + 1}. ${item.text}${ctx}`;
    })
    .join('\n');

  const userPrompt = `Translate the following ${items.length} ${kindLabel}(s) to ${langName}:\n\n${numbered}`;

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`DeepSeek API error ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('Empty response from DeepSeek');

    // Try to extract the array from the JSON response
    const parsed = JSON.parse(content) as unknown;
    let translations: string[];

    if (Array.isArray(parsed)) {
      translations = parsed.map(String);
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Sometimes DeepSeek wraps in { "translations": [...] }
      const obj = parsed as Record<string, unknown>;
      const arr = Object.values(obj).find(Array.isArray);
      if (Array.isArray(arr)) {
        translations = arr.map(String);
      } else {
        translations = [];
      }
    } else {
      translations = [];
    }

    const result: Record<string, string> = {};
    items.forEach((item, i) => {
      if (translations[i]) {
        result[item.id] = translations[i];
      }
    });
    return result;
  } catch (err) {
    console.warn('[translation] Batch translate failed:', err);
    return {};
  }
}

// ── Public API ────────────────────────────────────────────────

/** Translate a single word. Result is cached in localStorage per word+lang+model. */
export async function translateWord(
  word: string,
  context?: string,
  targetLang?: TranslateLang,
): Promise<string> {
  const lang = targetLang ?? 'zh';
  const ctx = context ? context.slice(0, 200) : '';
  // Include a context signature in the key so a translation tied to one sentence
  // doesn't get reused (and cached forever) for a different sense of the word.
  const cacheKey = `${DEEPSEEK_MODEL}:${lang}:${word.toLowerCase()}:${hashString(ctx)}`;
  const cache = loadTranslationCache();
  if (cacheKey in cache) {
    return cache[cacheKey];
  }
  const items: TranslateItem[] = [{ id: '0', text: word, context }];
  const result = await callBatchTranslate(items, 'word', lang);
  const translated = result['0'] || '';
  if (translated) {
    cache[cacheKey] = translated;
    saveTranslationCache(cache);
  }
  return translated;
}

/**
 * Fast single-word translation layer for the transcript inline popup.
 *
 * Strategy: try the keyless Google gtx proxy (/api/translate) first for
 * sub-second latency and ~100% word coverage, then fall back to DeepSeek
 * (translateWord) only if Google returns an empty string or errors.
 * Results are cached in localStorage per word+lang (separate key namespace
 * from DeepSeek so the two layers never collide).
 *
 * @param word        The English word to translate.
 * @param targetLang  Target language code (default: 'zh'). Only 'zh' is wired
 *                    into the UI today; passed through for future use.
 * @param sourceLang  Source language code (default: 'en').
 */
export async function translateWordFast(
  word: string,
  targetLang: TranslateLang = 'zh',
  sourceLang = 'en',
  options: { noDeepSeekFallback?: boolean } = {},
): Promise<string> {
  const w = word.trim().toLowerCase();
  if (!w) return '';

  const lang = targetLang ?? 'zh';
  const cacheKey = `google:${lang}:${w}`;
  const cache = loadTranslationCache();
  if (cacheKey in cache) {
    return cache[cacheKey];
  }

  // Fast layer: keyless Google gtx proxy (sub-second, no API key).
  try {
    const googleTarget = lang === 'zh' ? 'zh-CN' : lang;
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: word, source: sourceLang, target: googleTarget }),
    });
    if (res.ok) {
      const data = (await res.json()) as { translation?: string };
      const t = (data.translation ?? '').trim();
      if (t) {
        cache[cacheKey] = t;
        saveTranslationCache(cache);
        return t;
      }
    }
  } catch {
    // Network / proxy error → fall through to DeepSeek (unless disabled).
  }

  // Fallback layer: DeepSeek (slower, ~2-3s, but reliable for context + rare
  // words). Callers in the inline popups disable this so a slow/empty Google
  // response can never stall the lookup — the backend already returns the
  // headword translation inline, so the gloss is optional there.
  if (options.noDeepSeekFallback) return '';
  const fallback = await translateWord(word, undefined, lang);
  if (fallback) {
    cache[cacheKey] = fallback;
    saveTranslationCache(cache);
  }
  return fallback;
}

/** Translate a single sentence. */
export async function translateSentence(
  sentence: string,
  targetLang?: TranslateLang,
): Promise<string> {
  const items: TranslateItem[] = [{ id: '0', text: sentence }];
  const result = await callBatchTranslate(items, 'sentence', targetLang);
  return result['0'] || '';
}

/** Batch-translate words. Returns id → translated text map. */
export async function translateWords(
  items: Array<{ id: string; word: string; context?: string }>,
  targetLang?: TranslateLang,
): Promise<Record<string, string>> {
  const mapped: TranslateItem[] = items.map((it) => ({
    id: it.id,
    text: it.word,
    context: it.context,
  }));
  return callBatchTranslate(mapped, 'word', targetLang);
}

/** Batch-translate sentences. Returns id → translated text map. */
export async function translateSentences(
  items: Array<{ id: string; text: string }>,
  targetLang?: TranslateLang,
): Promise<Record<string, string>> {
  return callBatchTranslate(
    items.map((it) => ({ id: it.id, text: it.text })),
    'sentence',
    targetLang,
  );
}
