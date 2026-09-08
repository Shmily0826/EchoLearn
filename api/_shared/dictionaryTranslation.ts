import { translateWithGoogle } from './translate';

export type DictionaryTranslationStatus = 'translated' | 'fallback-en';

export async function translateDictionaryDefinition(
  text: string,
  target: string,
): Promise<{ text: string; status?: DictionaryTranslationStatus }> {
  if (target === 'en' || target === 'en-US') return { text };
  try {
    const translated = await translateWithGoogle(text, 'en', target, {
      operation: 'dictionary-definition',
    });
    return translated
      ? { text: translated, status: 'translated' }
      : { text, status: 'fallback-en' };
  } catch {
    return { text, status: 'fallback-en' };
  }
}
