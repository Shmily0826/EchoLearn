import type { DictionaryReference, LearnerMeaning, LearnerMeaningProvider } from '../types';

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

export function isCompactLearnerMeaning(value: string | null | undefined): boolean {
  const text = usableText(value);
  // ponytail: conservative 24-character heuristic; use provider gloss metadata if it becomes available.
  return text.length > 0 && text.length <= 24 && !/[.!?。！？]/.test(text);
}

function dictionaryMeaning(reference: DictionaryReference | null | undefined, targetLanguage: string): string {
  if (!reference
    || reference.translationStatus !== 'translated'
    || !sameLanguage(reference.requestedLanguage, targetLanguage)
    || !sameLanguage(reference.displayLanguage, targetLanguage)) return '';

  const sense = reference.senses.find((candidate) =>
    candidate.translationStatus === 'translated' && isCompactLearnerMeaning(candidate.displayText));
  return usableText(sense?.displayText);
}

export function resolveLearnerMeaning(input: LearnerMeaningInput): LearnerMeaning {
  const candidates: Array<[LearnerMeaningProvider, string]> = [
    ['context-ai', usableText(input.contextAi)],
    ['quick-gloss', usableText(input.quickGloss)],
    ['dictionary', dictionaryMeaning(input.dictionaryReference, input.targetLanguage)],
  ];
  const [provider, text] = candidates.find(([, value]) => value) ?? ['unavailable', ''];

  return {
    text,
    provider,
    targetLanguage: input.targetLanguage,
    sourceSentence: input.sourceSentence,
  };
}
