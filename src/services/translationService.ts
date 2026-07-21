/**
 * Translation service — uses DeepSeek API to backfill translations
 * for vocabulary words and sentences that were manually added without meaningCn.
 */

/** Requests go through the server-side proxy at /api/ai (API key stays server-side). */
const DEEPSEEK_ENDPOINT = '/api/ai';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

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

/** Translate a single word. */
export async function translateWord(
  word: string,
  context?: string,
  targetLang?: TranslateLang,
): Promise<string> {
  const items: TranslateItem[] = [{ id: '0', text: word, context }];
  const result = await callBatchTranslate(items, 'word', targetLang);
  return result['0'] || '';
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
