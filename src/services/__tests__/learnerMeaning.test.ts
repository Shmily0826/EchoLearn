import { describe, expect, it } from 'vitest';
import type { DictionaryReference } from '../../types';
import { resolveLearnerMeaning } from '../learnerMeaning';

const translatedReference: DictionaryReference = {
  queriedForm: 'cat',
  lemma: 'cat',
  provider: 'Free Dictionary',
  sourceLanguage: 'en',
  requestedLanguage: 'zh-CN',
  displayLanguage: 'zh-CN',
  translationStatus: 'translated',
  senses: [{
    pos: 'noun',
    sourceText: 'a small animal',
    displayText: '猫',
    translationStatus: 'translated',
  }],
};

const input = (overrides: Partial<Parameters<typeof resolveLearnerMeaning>[0]> = {}) => ({
  targetLanguage: 'zh-CN',
  sourceSentence: 'The cat slept on the mat.',
  ...overrides,
});

describe('resolveLearnerMeaning', () => {
  it('prefers context AI over quick gloss and dictionary', () => {
    expect(resolveLearnerMeaning(input({
      contextAi: '语境义', quickGloss: '快速释义', dictionaryReference: translatedReference,
    }))).toMatchObject({ text: '语境义', provider: 'context-ai' });
  });

  it('uses quick gloss when context AI is unavailable', () => {
    expect(resolveLearnerMeaning(input({ quickGloss: '快速释义', dictionaryReference: translatedReference })))
      .toMatchObject({ text: '快速释义', provider: 'quick-gloss' });
  });

  it('uses a translated dictionary reference as the final fallback', () => {
    expect(resolveLearnerMeaning(input({ dictionaryReference: translatedReference })))
      .toMatchObject({ text: '猫', provider: 'dictionary' });
  });

  it.each([
    ['fallback-en', { ...translatedReference, translationStatus: 'fallback-en' as const, displayLanguage: 'en' }],
    ['source', { ...translatedReference, translationStatus: 'source' as const, displayLanguage: 'en' }],
    ['unknown', { ...translatedReference, translationStatus: 'unknown' as const, displayLanguage: 'unknown' }],
    ['missing reference', undefined],
  ])('does not form Chinese meaning from %s', (_label, dictionaryReference) => {
    expect(resolveLearnerMeaning(input({ dictionaryReference }))).toMatchObject({
      text: '', provider: 'unavailable', targetLanguage: 'zh-CN',
    });
  });

  it('preserves the clicked subtitle as sourceSentence', () => {
    const result = resolveLearnerMeaning(input({ dictionaryReference: translatedReference }));
    expect(result.sourceSentence).toBe('The cat slept on the mat.');
  });
});
