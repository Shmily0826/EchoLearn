import type {
  DictionaryReference,
  LearnerMeaning,
  LearnerMeaningProvider,
  LearnerMeaningWithheldReason,
} from '../types';

export interface LearnerMeaningInput {
  targetLanguage: string;
  sourceSentence: string;
  contextAi?: string | null;
  quickGloss?: string | null;
  dictionaryReference?: DictionaryReference | null;
}

function usableText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sameLanguage(left: string | undefined, right: string): boolean {
  return Boolean(left) && left!.trim().toLowerCase() === right.trim().toLowerCase();
}

export function isCompactChineseDictionaryGloss(value: string | null | undefined): boolean {
  const text = usableText(value);
  return text.length > 0 && text.length <= 24 && !/[.!?。！？]/.test(text);
}

function dictionaryMeaning(
  reference: DictionaryReference | null | undefined,
  targetLanguage: string,
): { text: string; withheldReason?: LearnerMeaningWithheldReason } {
  if (!reference
    || reference.translationStatus !== 'translated'
    || !sameLanguage(reference.requestedLanguage, targetLanguage)
    || !sameLanguage(reference.displayLanguage, targetLanguage)) return { text: '' };

  const translatedSenses = reference.senses.filter((candidate) => candidate.translationStatus === 'translated');
  const sense = translatedSenses.find((candidate) => isCompactChineseDictionaryGloss(candidate.displayText));
  if (sense) return { text: usableText(sense.displayText) };
  return translatedSenses.some((candidate) => usableText(candidate.displayText))
    ? { text: '', withheldReason: 'dictionary-translation-not-compact' }
    : { text: '' };
}

export function resolveLearnerMeaning(input: LearnerMeaningInput): LearnerMeaning {
  const dictionary = dictionaryMeaning(input.dictionaryReference, input.targetLanguage);
  const candidates: Array<[LearnerMeaningProvider, string]> = [
    ['context-ai', usableText(input.contextAi)],
    ['quick-gloss', usableText(input.quickGloss)],
    ['dictionary', dictionary.text],
  ];
  const [provider, text] = candidates.find(([, value]) => value) ?? ['unavailable', ''];

  return {
    text,
    provider,
    ...(provider === 'unavailable' && dictionary.withheldReason
      ? { withheldReason: dictionary.withheldReason }
      : {}),
    targetLanguage: input.targetLanguage,
    sourceSentence: input.sourceSentence,
  };
}
