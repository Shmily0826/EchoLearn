import type { DictionaryEntry, LearnerMeaning, VocabularyItem } from '../types';
import { lookupWord } from './dictionaryService';
import { resolveLearnerMeaning } from './learnerMeaning';
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

export interface VocabularySemanticInput {
  dictionaryEntry?: DictionaryEntry | null;
  dictionaryFields?: DictionaryEntry | null;
  learnerMeaning?: LearnerMeaning | null;
}

function isTrustedLemma(entry: DictionaryEntry | null | undefined): boolean {
  const provenance = entry?.reference?.lemmaProvenance;
  return provenance === 'provider-confirmed' || provenance === 'dictionary-confirmed';
}

/** Prepare one vocabulary item without promoting query/candidate lemmas to identity. */
export function prepareVocabularyItem(
  item: VocabularyItem,
  semantic: VocabularySemanticInput = {},
): VocabularyItem {
  const prepared: VocabularyItem = { ...item };
  const reference = semantic.dictionaryEntry?.reference;
  const trustedLemma = isTrustedLemma(semantic.dictionaryEntry) ? reference?.lemma?.trim() : '';

  if (trustedLemma) {
    prepared.word = trustedLemma;
    prepared.lemma = trustedLemma;
  } else if (prepared.lemma && prepared.lemma !== prepared.word) {
    delete prepared.lemma;
  }

  if (semantic.learnerMeaning) prepared.meaningCn = semantic.learnerMeaning.text;

  const dictionary = semantic.dictionaryFields;
  if (dictionary) {
    prepared.phonetic = dictionary.phonetic || '';
    prepared.audioUrl = dictionary.audioUrl || '';
    prepared.partOfSpeech = dictionary.partOfSpeech || '';
    prepared.definitionEn = dictionary.definitionEn || '';
    prepared.example = dictionary.example || '';
    prepared.synonyms = dictionary.synonyms || [];
    prepared.antonyms = dictionary.antonyms || [];
    prepared.dictionaryProvider = dictionary.provider || '';
  }

  return prepared;
}

/**
 * Fill language-neutral dictionary data for a saved word.
 *
 * `definitionEn` is always fetched from an English dictionary, regardless of
 * the current UI language. Chinese is an optional learning aid and is only
 * generated when the entry does not already have a usable Chinese meaning.
 *
 * `aiTranslationEnabled` must reflect the signed-in state: the AI-backed
 * contextual translation (`translateWord`) is an authenticated-only capability
 * (the /api/ai proxy rejects anonymous callers), and guests must still be able
 * to save words — they simply keep the non-AI fallbacks (dictionary reference
 * meaning, quick gloss, local no-translation placeholder).
 */
export async function enrichVocabularyItem(
  item: VocabularyItem,
  options: { aiTranslationEnabled?: boolean } = {},
): Promise<Partial<VocabularyItem>> {
  const aiTranslationEnabled = options.aiTranslationEnabled ?? false;
  const word = item.lemma || item.word;
  const needsEnglish = isMissingEnglishDefinition(item.definitionEn);
  const needsChinese = isLocalNoTranslation(item.meaningCn);

  const [dictionary, chineseEntry, quickGloss] = await Promise.all([
    needsEnglish ? lookupWord(word, 'en').catch(() => null) : Promise.resolve(null),
    needsChinese ? lookupWord(word, 'zh-CN').catch(() => null) : Promise.resolve(null),
    needsChinese && aiTranslationEnabled
      ? translateWord(word, item.context).catch(() => '')
      : Promise.resolve(''),
  ]);

  const learnerMeaning = resolveLearnerMeaning({
    targetLanguage: 'zh-CN',
    sourceSentence: item.context,
    quickGloss: quickGloss || undefined,
    dictionaryReference: chineseEntry?.reference,
  });
  const prepared = prepareVocabularyItem(item, {
    dictionaryEntry: dictionary,
    dictionaryFields: dictionary,
    learnerMeaning: learnerMeaning.provider === 'unavailable' ? null : learnerMeaning,
  });
  const patch: Partial<VocabularyItem> = {};
  for (const key of [
    'word', 'lemma', 'meaningCn', 'phonetic', 'audioUrl', 'partOfSpeech',
    'definitionEn', 'example', 'synonyms', 'antonyms', 'dictionaryProvider',
  ] as const) {
    if (prepared[key] !== item[key]) patch[key] = prepared[key] as never;
  }
  return patch;
}
