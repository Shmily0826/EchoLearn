import { describe, expect, it, vi } from 'vitest';
import type { VocabularyItem } from '../../types';
import { analyzeVocabulary } from '../vocabularyDiagnostics';

const item = (overrides: Partial<VocabularyItem> = {}): VocabularyItem => ({
  id: 'test-item',
  word: 'word',
  meaningCn: '',
  context: '',
  sourceVideoId: '',
  addedAt: 1,
  mastered: false,
  reviewCount: 0,
  lastReviewedAt: 0,
  nextReviewAt: 0,
  ...overrides,
});

describe('analyzeVocabulary', () => {
  it('classifies meanings and keeps placeholder counts separate', () => {
    const report = analyzeVocabulary([
      item({ id: 'blank', meaningCn: '' }),
      item({ id: 'han', meaningCn: '猫' }),
      item({ id: 'latin', meaningCn: 'cat' }),
      item({ id: 'other', meaningCn: '—' }),
      item({ id: 'placeholder', meaningCn: '(Local analysis — no translation)' }),
    ]);

    expect(report.totalItems).toBe(5);
    expect(report.meaningCn).toMatchObject({
      blank: 1,
      localNoTranslationPlaceholders: 1,
      hanCharacters: 1,
      likelyNonChineseLatin: 1,
      otherNonHan: 1,
    });
    expect(report.meaningCn.likelyNonChineseBasis).toContain('not proof of English');
  });

  it('reports bounded surface duplicates and lemma/surface collisions', () => {
    const report = analyzeVocabulary([
      item({ id: 'running', word: 'running', lemma: 'run' }),
      item({ id: 'run', word: 'run' }),
      item({ id: 'RUN', word: 'RUN' }),
      item({ id: 'other', word: 'jump' }),
    ]);

    expect(report.surfaceDuplicates.groupCount).toBe(1);
    expect(report.surfaceDuplicates.excessItems).toBe(1);
    expect(report.lemmaSurfaceCollisions.groupCount).toBe(1);
    expect(report.lemmaSurfaceCollisions.groups[0].normalizedKey).toBe('run');
    expect(report.persistedLemma).toMatchObject({
      itemCount: 1,
      provenance: 'unavailable/unverifiable when not persisted on VocabularyItem',
    });
  });

  it('reports providers and bounds representative samples', () => {
    const report = analyzeVocabulary(Array.from({ length: 8 }, (_, index) => item({
      id: `id-${index}`,
      word: `word-${index}`,
      dictionaryProvider: index < 6 ? 'Datamuse' : index === 6 ? 'Free Dictionary API' : undefined,
      lemma: index < 7 ? `lemma-${index}` : undefined,
    })));

    expect(report.dictionaryProviders).toEqual({
      byProvider: { Datamuse: 6, 'Free Dictionary API': 1 },
      missing: 1,
    });
    expect(report.persistedLemma.samples).toHaveLength(5);
  });

  it('does not mutate input items', () => {
    const items = [item({ word: ' Running ', lemma: 'RUN' })];
    const before = structuredClone(items);
    analyzeVocabulary(items);
    expect(items).toEqual(before);
  });
});

describe('readVocabularyDiagnostics', () => {
  it('reads through loadVocabulary and serializes without write APIs', async () => {
    vi.resetModules();
    vi.doMock('../../utils/storage', () => ({
      loadVocabulary: vi.fn(() => [item({ id: 'loaded', word: 'cat', meaningCn: '猫' })]),
    }));
    const module = await import('../vocabularyDiagnostics');
    const report = module.readVocabularyDiagnostics();
    expect(report.totalItems).toBe(1);
    expect(JSON.parse(module.serializeVocabularyDiagnostics()).totalItems).toBe(1);
    vi.doUnmock('../../utils/storage');
  });
});
