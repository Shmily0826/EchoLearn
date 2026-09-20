// @vitest-environment jsdom
//
// Out-of-order / concurrent-update coverage for the two AI bulk translation
// actions (Vocabulary words and Sentences).
//
// Each is a long-running async action that ends by committing a whole list
// back into React state. Anything that changes the list while the request is
// in flight must survive that commit. Both triggers are authenticated-only and
// disabled while running, so this race is not reachable from the guest E2E
// suites and is covered here instead.
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
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'test-user' } }) }));
vi.mock('../../services/firestoreSync', () => ({ pushItemsToCloud: vi.fn(() => Promise.resolve()) }));
vi.mock('../../components/WordDictionaryPopup', () => ({ default: () => null }));
vi.mock('../../services/exportService', () => ({
  exportSentencesCSV: vi.fn(), exportSentencesPDF: vi.fn(),
  exportVocabularyCSV: vi.fn(), exportVocabularyPDF: vi.fn(),
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
// Mirrors the real storage semantics: each update reads the current list,
// writes back, and returns what it wrote.
vi.mock('../../utils/storage', () => ({
  todayStartMs: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); },
  tomorrowMs: () => Date.now() + 24 * 60 * 60 * 1000,
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

import SentencesPage from '../SentencesPage';
import VocabularyPage from '../VocabularyPage';

const SENTENCES_CHANGED = 'echolearn:sentences-changed';
const VOCAB_CHANGED = 'echolearn:vocab-changed';
const TRANSLATION_FAILED = 'Translation failed. Try again.';

const vocabularyItem = (id: string) => ({
  id, word: id, meaningCn: '', context: `A sentence with ${id}.`, sourceVideoId: '', addedAt: 1,
  mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0, definitionEn: 'definition',
});

const sentenceItem = (id: string) => ({
  id, text: `A sentence ${id}.`, meaningCn: '', sourceVideoId: '', startTime: 0, addedAt: 1,
  myOwnSentence: '', mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0,
});

// Sentence text is split into per-word spans, and the vocabulary card count
// varies by view, so both suites assert on what the page shows for a uniquely
// named row instead of on a count of ambiguous controls.
const showsRow = (id: string) => (document.body.textContent ?? '').includes(id);

function deferSentences() {
  let resolve!: (value: Record<string, string>) => void;
  state.translateSentences.mockImplementationOnce(
    () => new Promise<Record<string, string>>((r) => { resolve = r; }),
  );
  return { resolve: (value: Record<string, string>) => resolve(value) };
}

function deferWords() {
  let resolve!: (value: Record<string, string>) => void;
  state.translateWords.mockImplementationOnce(
    () => new Promise<Record<string, string>>((r) => { resolve = r; }),
  );
  return { resolve: (value: Record<string, string>) => resolve(value) };
}

describe('bulk translation races with list changes', () => {
  beforeEach(() => {
    state.vocabulary = [];
    state.sentences = [];
    state.translateWords.mockReset();
    state.translateWord.mockReset();
    state.translateSentences.mockReset();
  });

  afterEach(() => cleanup());

  describe('sentences', () => {
    it('keeps a sentence added while a successful translation is in flight', async () => {
      state.sentences = [sentenceItem('alpharow')];
      const pending = deferSentences();
      render(<MemoryRouter><SentencesPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      // Another surface adds a sentence while the request is outstanding.
      state.sentences = [sentenceItem('alpharow'), sentenceItem('betarow')];
      window.dispatchEvent(new CustomEvent(SENTENCES_CHANGED));
      await waitFor(() => expect(showsRow('betarow')).toBe(true));

      pending.resolve({ alpharow: '第一句' });

      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All missing translations filled.'));
      expect(showsRow('betarow'), 'the concurrent addition must survive the commit').toBe(true);
    });

    it('does not resurrect a sentence deleted while a failed translation is in flight', async () => {
      state.sentences = [sentenceItem('alpharow'), sentenceItem('betarow')];
      const pending = deferSentences();
      render(<MemoryRouter><SentencesPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      // Another surface deletes a sentence while the request is outstanding.
      state.sentences = [sentenceItem('alpharow')];
      window.dispatchEvent(new CustomEvent(SENTENCES_CHANGED));
      await waitFor(() => expect(showsRow('betarow')).toBe(false));

      // The provider returns nothing usable.
      pending.resolve({});

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TRANSLATION_FAILED));
      expect(showsRow('betarow'), 'a deleted sentence must not come back').toBe(false);
    });

    it('does not drop a sentence added while a failed translation is in flight', async () => {
      state.sentences = [sentenceItem('alpharow')];
      const pending = deferSentences();
      render(<MemoryRouter><SentencesPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      state.sentences = [sentenceItem('alpharow'), sentenceItem('betarow')];
      window.dispatchEvent(new CustomEvent(SENTENCES_CHANGED));
      await waitFor(() => expect(showsRow('betarow')).toBe(true));

      pending.resolve({});

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TRANSLATION_FAILED));
      expect(showsRow('betarow'), 'the concurrent addition must survive the commit').toBe(true);
    });
  });

  describe('vocabulary', () => {
    it('keeps a word added while a successful translation is in flight', async () => {
      state.vocabulary = [vocabularyItem('alphaword')];
      const pending = deferWords();
      render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      state.vocabulary = [vocabularyItem('alphaword'), vocabularyItem('betaword')];
      window.dispatchEvent(new CustomEvent(VOCAB_CHANGED));
      await waitFor(() => expect(showsRow('betaword')).toBe(true));

      pending.resolve({ alphaword: '第一个词' });

      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('All missing translations filled.'));
      expect(showsRow('betaword'), 'the concurrent addition must survive the commit').toBe(true);
    });

    it('does not resurrect a word deleted while a failed translation is in flight', async () => {
      state.vocabulary = [vocabularyItem('alphaword'), vocabularyItem('betaword')];
      const pending = deferWords();
      render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      state.vocabulary = [vocabularyItem('alphaword')];
      window.dispatchEvent(new CustomEvent(VOCAB_CHANGED));
      await waitFor(() => expect(showsRow('betaword')).toBe(false));

      pending.resolve({});

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TRANSLATION_FAILED));
      expect(showsRow('betaword'), 'a deleted word must not come back').toBe(false);
    });

    it('does not drop a word added while a failed translation is in flight', async () => {
      state.vocabulary = [vocabularyItem('alphaword')];
      const pending = deferWords();
      render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'Auto Translate' }));

      state.vocabulary = [vocabularyItem('alphaword'), vocabularyItem('betaword')];
      window.dispatchEvent(new CustomEvent(VOCAB_CHANGED));
      await waitFor(() => expect(showsRow('betaword')).toBe(true));

      pending.resolve({});

      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(TRANSLATION_FAILED));
      expect(showsRow('betaword'), 'the concurrent addition must survive the commit').toBe(true);
    });
  });
});
