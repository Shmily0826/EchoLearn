// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  vocabulary: [] as Array<Record<string, unknown>>,
  sentences: [] as Array<Record<string, unknown>>,
  translateWords: vi.fn(),
  translateWord: vi.fn(),
  translateSentences: vi.fn(),
}));

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({
    lang: 'zh',
    t: (key: string, vars?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'vocab.title': 'Vocabulary',
        'vocab.words': 'words',
        'vocab.mastered': 'mastered',
        'vocab.review': 'Review',
        'vocab.autoTranslate': 'Auto Translate',
        'vocab.translating': 'Translating...',
        'vocab.translationComplete': 'All missing translations filled.',
        'vocab.translationPartial': `${vars?.count ?? 0} translation(s) failed. Try again.`,
        'vocab.translationFailed': 'Translation failed. Try again.',
        'vocab.retry': 'Retry',
        'vocab.clickAdd': 'Click to add meaning...',
        'vocab.translateRetry': 'Click to translate',
        'vocab.noEnglishDef': 'No English definition',
        'vocab.searchPh': 'Search',
        'vocab.export': 'Export',
        'vocab.noWords': 'No words',
        'vocab.noMatch': 'No match',
        'vocab.delete': 'Delete',
        'vocab.editMeaningPh': 'Meaning',
        'vocab.save': 'Save',
        'vocab.markMastered': 'Mark mastered',
        'vocab.unmark': 'Unmark',
        'vocab.due': 'due',
        'vocab.exportCSV': 'Export CSV',
        'vocab.exportPDF': 'Export PDF',
        'vocab.all': 'All',
        'vocab.masteredFilter': 'Mastered',
        'vocab.unmasteredFilter': 'Unmastered',
        'vocab.cardView': 'Cards',
        'vocab.listView': 'List',
        'vocab.fillEnglishDefs': 'Fill English definitions',
        'vocab.loadingDefinitions': 'Loading definitions...',
        'vocab.retryDefinitions': 'Retry definitions',
        'sent.title': 'Sentences',
        'sent.sentences': 'sentences',
        'sent.mastered': 'mastered',
        'sent.review': 'Review',
        'sent.autoTranslate': 'Auto Translate',
        'sent.translating': 'Translating...',
        'sent.translationComplete': 'All missing translations filled.',
        'sent.translationPartial': `${vars?.count ?? 0} translation(s) failed. Try again.`,
        'sent.translationFailed': 'Translation failed. Try again.',
        'sent.translateLang': 'Target language',
        'sent.export': 'Export',
        'sent.searchPh': 'Search',
        'sent.noSentences': 'No sentences',
        'sent.noMatch': 'No match',
        'sent.delete': 'Delete',
        'sent.editMeaningPh': 'Meaning',
        'sent.save': 'Save',
        'sent.markMastered': 'Mark mastered',
        'sent.unmark': 'Unmark',
        'sent.due': 'due',
        'sent.exportCSV': 'Export CSV',
        'sent.exportPDF': 'Export PDF',
      };
      return messages[key] ?? key;
    },
  }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../services/firestoreSync', () => ({ pushItemsToCloud: vi.fn(() => Promise.resolve()) }));
vi.mock('../../components/WordDictionaryPopup', () => ({ default: () => null }));
vi.mock('../../services/exportService', () => ({
  exportVocabularyCSV: vi.fn(), exportVocabularyPDF: vi.fn(),
  exportSentencesCSV: vi.fn(), exportSentencesPDF: vi.fn(),
}));
vi.mock('../../services/aiAnalysis', () => ({ isLocalNoTranslation: (value: string | undefined) => !value }));
vi.mock('../../services/vocabularyEnrichment', () => ({
  enrichVocabularyItem: vi.fn(() => Promise.resolve({})),
  isMissingEnglishDefinition: (value: string | undefined) => !value,
}));
vi.mock('../../utils/jumpToSource', () => ({
  jumpToSource: vi.fn(() => ({ ok: true })), formatTimestamp: vi.fn(() => '0:00'), youtubeUrlAt: vi.fn(() => ''),
}));
vi.mock('../../utils/sentence', () => ({ extractSentence: vi.fn((context: string) => context) }));
vi.mock('../../utils/storage', () => ({
  loadVocabulary: vi.fn(() => state.vocabulary),
  removeVocabularyItem: vi.fn(),
  updateVocabularyItem: vi.fn((id: string, patch: Record<string, unknown>) => {
    state.vocabulary = state.vocabulary.map((item) => item.id === id ? { ...item, ...patch } : item);
    return state.vocabulary;
  }),
  addVocabularyItem: vi.fn((item: Record<string, unknown>) => { state.vocabulary = [...state.vocabulary, item]; return state.vocabulary; }),
  loadSentences: vi.fn(() => state.sentences),
  removeSentenceItem: vi.fn(),
  updateSentenceItem: vi.fn((id: string, patch: Record<string, unknown>) => {
    state.sentences = state.sentences.map((item) => item.id === id ? { ...item, ...patch } : item);
    return state.sentences;
  }),
  loadAllSessions: vi.fn(() => []),
  getTranslateLang: vi.fn(() => 'zh'),
  saveTranslateLang: vi.fn(),
}));
vi.mock('../../services/translationService', () => ({
  translateWords: state.translateWords,
  translateWord: state.translateWord,
  translateSentences: state.translateSentences,
  TRANSLATE_LANGS: { zh: 'Chinese' },
}));

import VocabularyPage from '../VocabularyPage';
import SentencesPage from '../SentencesPage';

const vocabularyItem = (id: string, meaningCn = '') => ({
  id, word: id, meaningCn, context: `A sentence with ${id}.`, sourceVideoId: '', addedAt: 1,
  mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0, definitionEn: 'definition',
});

const sentenceItem = (id: string) => ({
  id, text: `A sentence ${id}.`, meaningCn: '', sourceVideoId: '', startTime: 0, addedAt: 1,
  myOwnSentence: '', mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0,
});

describe('translation failure UX', () => {
  beforeEach(() => {
    state.vocabulary = [];
    state.sentences = [];
    state.translateWords.mockReset();
    state.translateWord.mockReset();
    state.translateSentences.mockReset();
  });

  afterEach(() => cleanup());

  it('shows a retryable error when single word translation fails', async () => {
    state.vocabulary = [vocabularyItem('word')];
    state.translateWord.mockRejectedValueOnce(new Error('translation unavailable'));
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

    fireEvent.click(screen.getByText('Click to add meaning...'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Translation failed. Try again.'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reports partial bulk translation and leaves failed words retryable', async () => {
    state.vocabulary = [vocabularyItem('one'), vocabularyItem('two')];
    state.translateWords.mockResolvedValueOnce({ one: '第一' });
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 translation(s) failed. Try again.'));
    expect(state.vocabulary.find((item) => item.id === 'two')?.meaningCn).toBe('');
    expect(screen.getAllByText('Click to add meaning...')).toHaveLength(1);
  });

  it('reports partial sentence translation without clearing failed sentences', async () => {
    state.sentences = [sentenceItem('one'), sentenceItem('two')];
    state.translateSentences.mockResolvedValueOnce({ one: '第一句' });
    render(<MemoryRouter><SentencesPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 translation(s) failed. Try again.'));
    expect(state.sentences.find((item) => item.id === 'two')?.meaningCn).toBe('');
  });
});
