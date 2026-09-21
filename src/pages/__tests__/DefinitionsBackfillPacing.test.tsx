// @vitest-environment jsdom
//
// Pacing and progress for the "Fill English definitions" backfill.
//
// The learner-visible symptom this guards: a bulk run that fires four words at a
// time can exhaust /api/dictionary's 120 req/min/IP budget on its own, and every
// word after that came back as "English definitions could not be loaded" with no
// indication of how far the run had got. Two things had to change, and both are
// cheap to undo by accident: the batch width, and a progress readout.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  vocabulary: [] as Array<Record<string, unknown>>,
  enrich: vi.fn(),
  inflight: 0,
  maxInflight: 0,
}));

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({
    lang: 'en',
    t: (key: string, vars?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'vocab.title': 'Vocabulary',
        'vocab.words': 'words',
        'vocab.mastered': 'mastered',
        'vocab.due': 'due',
        'vocab.review': 'Review',
        'vocab.searchPh': 'Search',
        'vocab.export': 'Export',
        'vocab.exportCSV': 'Export CSV',
        'vocab.exportPDF': 'Export PDF',
        'vocab.all': 'All',
        'vocab.unmastered': 'Unmastered',
        'vocab.masteredFilter': 'Mastered',
        'vocab.cardView': 'Cards',
        'vocab.listView': 'List',
        'vocab.fillEnglishDefs': 'Fill English definitions',
        'vocab.loadingDefinitions': 'Loading definitions...',
        'vocab.loadingDefinitionsProgress': `Loading definitions… ${vars?.done ?? 0}/${vars?.total ?? 0}`,
        'vocab.retryDefinitions': 'Retry definitions',
        'vocab.defsFailedAll': 'Could not load English definitions. Check your network and try again.',
        'vocab.defsFailedSome': `No English definition found for: ${vars?.words ?? ''}`,
        'vocab.delete': 'Delete',
        'vocab.noEnglishDef': 'No English definition',
        'vocab.newest': 'Newest first',
        'vocab.az': 'A - Z',
        'vocab.reviewSoonest': 'Review soonest',
        'vocab.mostReviewed': 'Most reviewed',
        'vocab.markMastered': 'Mark mastered',
        'vocab.unmark': 'Unmark',
        'vocab.noWords': 'No words',
        'vocab.noMatch': 'No match',
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
}));
vi.mock('../../services/aiAnalysis', () => ({ isLocalNoTranslation: (value: string | undefined) => !value }));
vi.mock('../../services/vocabularyEnrichment', () => ({
  enrichVocabularyItem: (item: Record<string, unknown>) => state.enrich(item),
  isMissingEnglishDefinition: (value: string | undefined) => !value,
  prepareVocabularyItem: vi.fn((item: Record<string, unknown>) => item),
}));
vi.mock('../../utils/jumpToSource', () => ({
  jumpToSource: vi.fn(() => ({ ok: true })), formatTimestamp: vi.fn(() => '0:00'), youtubeUrlAt: vi.fn(() => ''),
}));
vi.mock('../../utils/sentence', () => ({ extractSentence: vi.fn((context: string) => context) }));
vi.mock('../../utils/storage', () => ({
  todayStartMs: () => 0,
  tomorrowMs: () => Date.now() + 86_400_000,
  loadVocabulary: vi.fn(() => state.vocabulary),
  removeVocabularyItem: vi.fn(),
  updateVocabularyItem: vi.fn((id: string, patch: Record<string, unknown>) => {
    state.vocabulary = state.vocabulary.map((item) => (item.id === id ? { ...item, ...patch } : item));
    return state.vocabulary;
  }),
  addVocabularyItem: vi.fn(),
  loadSentences: vi.fn(() => []),
  loadAllSessions: vi.fn(() => []),
  getTranslateLang: vi.fn(() => 'en'),
  saveTranslateLang: vi.fn(),
}));
vi.mock('../../services/translationService', () => ({
  translateWords: vi.fn(), translateWord: vi.fn(), translateSentences: vi.fn(), TRANSLATE_LANGS: { en: 'English' },
}));

import VocabularyPage from '../VocabularyPage';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];

beforeEach(() => {
  state.vocabulary = WORDS.map((word, i) => ({
    id: `v_${i}`, word, meaningCn: 'meaning', context: `A sentence with ${word}.`,
    sourceVideoId: '', addedAt: 1, definitionEn: '', mastered: false,
    reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0,
  }));
  state.enrich.mockReset();
  state.inflight = 0;
  state.maxInflight = 0;
  state.enrich.mockImplementation(async () => {
    state.inflight += 1;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    state.inflight -= 1;
    return { definitionEn: 'a filled definition' };
  });
});

afterEach(() => cleanup());

describe('definitions backfill pacing', () => {
  it('never asks the dictionary for more than two words at a time', async () => {
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fill English definitions/ }));

    await waitFor(() => expect(state.enrich).toHaveBeenCalledTimes(WORDS.length), { timeout: 5000 });
    expect(state.maxInflight).toBeLessThanOrEqual(2);
  });

  it('reports how far the run has got while it is running', async () => {
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fill English definitions/ }));

    const trigger = screen.getByRole('button', { name: /Loading definitions/i });
    await waitFor(() => expect(trigger.textContent).toMatch(/[1-7]\/7/), { timeout: 5000 });

    // A fully filled library no longer needs the trigger at all, so the run
    // ending is marked by the control disappearing — not by its label flipping
    // back — and by no alert being left behind.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Loading definitions/i })).toBeNull(), { timeout: 5000 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(state.vocabulary.every((item) => item.definitionEn === 'a filled definition')).toBe(true);
  }, 15000);

  it('offers a retry that re-runs only the words still missing a definition', async () => {
    state.enrich.mockResolvedValue({});
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fill English definitions/ }));

    const retry = await screen.findByRole('button', { name: /Retry definitions/ }, { timeout: 5000 });
    expect(screen.getByRole('alert').textContent).toContain('Could not load English definitions');

    state.enrich.mockClear();
    state.enrich.mockResolvedValue({ definitionEn: 'a filled definition' });
    fireEvent.click(retry);
    await waitFor(() => expect(state.enrich).toHaveBeenCalledTimes(WORDS.length), { timeout: 5000 });
  });
});
