import { describe, expect, it, vi } from 'vitest';
import type { DictionaryEntry, LearnerMeaning, VocabularyItem } from '../../types';

const { lookupWordMock, translateWordMock } = vi.hoisted(() => ({
  lookupWordMock: vi.fn(),
  translateWordMock: vi.fn(),
}));

vi.mock('../dictionaryService', () => ({ lookupWord: lookupWordMock }));
vi.mock('../translationService', () => ({ translateWord: translateWordMock }));

import { enrichVocabularyItem, prepareVocabularyItem } from '../vocabularyEnrichment';

function item(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'vocab_1', word: 'running', meaningCn: '', context: 'They are running.',
    sourceVideoId: 'video_1', addedAt: 1, mastered: false, reviewCount: 0,
    lastReviewedAt: 0, nextReviewAt: 0, ...overrides,
  };
}

function entry(reference: NonNullable<DictionaryEntry['reference']>, overrides: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    word: 'running', phonetic: '', audioUrl: '', partOfSpeech: 'verb',
    definitionEn: 'to move quickly', example: '', synonyms: [], antonyms: [],
    provider: 'test', reference, ...overrides,
  };
}

function meaning(text: string): LearnerMeaning {
  return { text, provider: 'quick-gloss', targetLanguage: 'zh-CN', sourceSentence: 'They are running.' };
}

describe('canonical vocabulary preparation and enrichment', () => {
  it('uses only confirmed reference provenance to canonicalize identity', () => {
    const dictionary = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'dictionary-confirmed',
      provider: 'Free Dictionary API', sourceLanguage: 'en', requestedLanguage: 'en',
      displayLanguage: 'en', translationStatus: 'source', senses: [],
    });

    const prepared = prepareVocabularyItem(item(), {
      dictionaryEntry: dictionary,
      learnerMeaning: meaning('跑步'),
    });

    expect(prepared.word).toBe('run');
    expect(prepared.lemma).toBe('run');
    expect(prepared.meaningCn).toBe('跑步');
  });

  it('does not promote a candidate or query lemma into saved identity', () => {
    const candidate = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'candidate',
      provider: 'Datamuse', sourceLanguage: 'en', requestedLanguage: 'en',
      displayLanguage: 'en', translationStatus: 'source', senses: [],
    });

    const prepared = prepareVocabularyItem(item({ lemma: 'run' }), { dictionaryEntry: candidate });

    expect(prepared.word).toBe('running');
    expect(prepared.lemma).toBeUndefined();
  });

  it('uses contextual quick translation through LearnerMeaning when dictionary translation falls back', async () => {
    const english = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'dictionary-confirmed',
      provider: 'Free Dictionary API', sourceLanguage: 'en', requestedLanguage: 'en',
      displayLanguage: 'en', translationStatus: 'source', senses: [],
    });
    const fallbackChinese = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'dictionary-confirmed',
      provider: 'Free Dictionary API', sourceLanguage: 'en', requestedLanguage: 'zh-CN',
      displayLanguage: 'en', translationStatus: 'fallback-en', senses: [],
    });
    lookupWordMock.mockImplementation(async (_word: string, target: string) => target === 'en' ? english : fallbackChinese);
    translateWordMock.mockResolvedValue('语境中的跑步');

    const patch = await enrichVocabularyItem(item(), { aiTranslationEnabled: true });

    expect(patch.meaningCn).toBe('语境中的跑步');
    expect(translateWordMock).toHaveBeenCalledWith('running', 'They are running.');
  });

  it('guest saves keep non-AI enrichment and never call the AI translation path', async () => {
    translateWordMock.mockClear();
    const english = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'dictionary-confirmed',
      provider: 'Free Dictionary API', sourceLanguage: 'en', requestedLanguage: 'en',
      displayLanguage: 'en', translationStatus: 'source', senses: [],
    });
    const fallbackChinese = entry({
      queriedForm: 'running', lemma: 'run', lemmaProvenance: 'dictionary-confirmed',
      provider: 'Free Dictionary API', sourceLanguage: 'en', requestedLanguage: 'zh-CN',
      displayLanguage: 'en', translationStatus: 'fallback-en', senses: [],
    });
    lookupWordMock.mockImplementation(async (_word: string, target: string) => target === 'en' ? english : fallbackChinese);

    // Default (no options) and explicit guest mode must both skip the AI call.
    const guestPatch = await enrichVocabularyItem(item());
    const explicitPatch = await enrichVocabularyItem(item(), { aiTranslationEnabled: false });

    expect(translateWordMock).not.toHaveBeenCalled();
    // Dictionary data (free providers) is still enriched so the save succeeds.
    expect(guestPatch.definitionEn).toBe('to move quickly');
    expect(explicitPatch.definitionEn).toBe('to move quickly');
    // Neither patch should contain an AI-generated meaning.
    expect(translateWordMock.mock.calls.length).toBe(0);
  });
});
