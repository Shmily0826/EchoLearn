/**
 * Translation service — uses DeepSeek API to backfill Chinese translations
 * for vocabulary words and sentences that were manually added without meaningCn.
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

interface TranslateItem {
  id: string;
  text: string;
  context?: string;
}

function getApiKey(): string | undefined {
  return import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined;
}

/**
 * Batch-translate a list of words / sentences to Chinese using DeepSeek.
 * Returns a map of id → meaningCn.
 */
async function callBatchTranslate(
  items: TranslateItem[],
  kind: 'word' | 'sentence',
): Promise<Record<string, string>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[translation] No VITE_DEEPSEEK_API_KEY set');
    return {};
  }
  if (items.length === 0) return {};

  const kindLabel = kind === 'word' ? 'English vocabulary word' : 'English sentence';

  const systemPrompt = `You are a professional English-to-Chinese translator.
Translate each ${kindLabel} into natural, accurate, concise Chinese.
Return ONLY a valid JSON array of strings — no markdown fences, no explanation.
The array must have exactly ${items.length} element(s), in the same order as the input.`;

  const numbered = items
    .map((item, i) => {
      const ctx = item.context ? ` (context: "${item.context}")` : '';
      return `${i + 1}. ${item.text}${ctx}`;
    })
    .join('\n');

  const userPrompt = `Translate the following ${items.length} ${kindLabel}(s) to Chinese:\n\n${numbered}`;

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
): Promise<string> {
  const items: TranslateItem[] = [{ id: '0', text: word, context }];
  const result = await callBatchTranslate(items, 'word');
  return result['0'] || '';
}

/** Translate a single sentence. */
export async function translateSentence(
  sentence: string,
): Promise<string> {
  const items: TranslateItem[] = [{ id: '0', text: sentence }];
  const result = await callBatchTranslate(items, 'sentence');
  return result['0'] || '';
}

/** Batch-translate words. Returns id → meaningCn map. */
export async function translateWords(
  items: Array<{ id: string; word: string; context?: string }>,
): Promise<Record<string, string>> {
  const mapped: TranslateItem[] = items.map((it) => ({
    id: it.id,
    text: it.word,
    context: it.context,
  }));
  return callBatchTranslate(mapped, 'word');
}

/** Batch-translate sentences. Returns id → meaningCn map. */
export async function translateSentences(
  items: Array<{ id: string; text: string }>,
): Promise<Record<string, string>> {
  return callBatchTranslate(
    items.map((it) => ({ id: it.id, text: it.text })),
    'sentence',
  );
}
