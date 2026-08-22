import type { VocabularyItem } from '../types';
import { lookupWord } from './dictionaryService';
import { translateWord } from './translationService';
import { isLocalNoTranslation } from './aiAnalysis';

const EMPTY_DEFINITION_PLACEHOLDERS = new Set([
  'no english definition',
  '(no english definition)',
]);

/** True when a saved item does not contain a usable English definition. */
export function isMissingEnglishDefinition(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || EMPTY_DEFINITION_PLACEHOLDERS.has(normalized);
}

/**
 * Fill language-neutral dictionary data for a saved word.
 *
 * `definitionEn` is always fetched from an English dictionary, regardless of
 * the current UI language. Chinese is an optional learning aid and is only
 * generated when the entry does not already have a usable Chinese meaning.
 */
export async function enrichVocabularyItem(item: VocabularyItem): Promise<Partial<VocabularyItem>> {
  const word = item.lemma || item.word;
  const needsEnglish = isMissingEnglishDefinition(item.definitionEn);
  const needsChinese = isLocalNoTranslation(item.meaningCn);

  const [dictionary, meaningCn] = await Promise.all([
    needsEnglish ? lookupWord(word, 'en').catch(() => null) : Promise.resolve(null),
    needsChinese ? translateWord(word, item.context).catch(() => '') : Promise.resolve(''),
  ]);

  const patch: Partial<VocabularyItem> = {};
  if (dictionary) {
    patch.definitionEn = dictionary.definitionEn || '';
    patch.phonetic = dictionary.phonetic || '';
    patch.audioUrl = dictionary.audioUrl || '';
    patch.partOfSpeech = dictionary.partOfSpeech || '';
    patch.example = dictionary.example || '';
    patch.synonyms = dictionary.synonyms || [];
    patch.antonyms = dictionary.antonyms || [];
    patch.dictionaryProvider = dictionary.provider || '';
    if (dictionary.lemma) patch.lemma = dictionary.lemma;
  }
  if (meaningCn) patch.meaningCn = meaningCn;
  return patch;
}
