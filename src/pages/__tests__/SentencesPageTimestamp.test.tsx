// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sentences: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({
    lang: 'zh',
    t: (key: string) => key,
  }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../services/firestoreSync', () => ({ pushItemsToCloud: vi.fn(() => Promise.resolve()) }));
vi.mock('../../components/WordDictionaryPopup', () => ({ default: () => null }));
vi.mock('../../services/exportService', () => ({
  exportSentencesCSV: vi.fn(), exportSentencesPDF: vi.fn(),
}));
vi.mock('../../services/aiAnalysis', () => ({ isLocalNoTranslation: (value: string | undefined) => !value }));
vi.mock('../../services/translationService', () => ({
  translateSentences: vi.fn(), TRANSLATE_LANGS: { zh: 'Chinese' },
}));
vi.mock('../../utils/storage', () => ({
  loadSentences: vi.fn(() => state.sentences),
  removeSentenceItem: vi.fn(),
  updateSentenceItem: vi.fn(),
  loadAllSessions: vi.fn(() => []),
  getTranslateLang: vi.fn(() => 'zh'),
  saveTranslateLang: vi.fn(),
}));

import SentencesPage from '../SentencesPage';

const sentenceItem = (overrides: Record<string, unknown>) => ({
  id: 's-1',
  text: 'A sentence.',
  meaningCn: '一句话。',
  sourceVideoId: 'vid1',
  startTime: 0,
  addedAt: 1_760_000_000_000,
  myOwnSentence: '',
  mastered: false,
  reviewCount: 0,
  lastReviewedAt: 0,
  nextReviewAt: 1_760_086_400_000,
  ...overrides,
});

const renderPage = () => render(<MemoryRouter><SentencesPage /></MemoryRouter>);

describe('SentencesPage timestamp chip', () => {
  beforeEach(() => { state.sentences = []; });
  afterEach(() => cleanup());

  it('renders the confirmed moment as a formatted chip', () => {
    state.sentences = [sentenceItem({ startTime: 566 })];
    renderPage();
    expect(screen.getByText('@9:26')).toBeTruthy();
  });

  it('never shows a fake @0:00 for a sentence without a confirmed moment', () => {
    // startTime 0 is the sentinel for "no confirmed moment" (unplaceable AI
    // suggestion or legacy restored data) — same rule as SentenceList.
    state.sentences = [sentenceItem({ startTime: 0, text: 'An unplaceable sentence.' })];
    renderPage();
    // The row still renders — assert on one token span, since the sentence is
    // tokenized into per-word spans.
    expect(screen.getByText('unplaceable')).toBeTruthy();
    expect(screen.queryByText('@0:00')).toBeNull();
  });

  it('shows chips only for the placed rows when both kinds are listed', () => {
    state.sentences = [
      sentenceItem({ id: 'placed', startTime: 90, text: 'A placed sentence.' }),
      sentenceItem({ id: 'unplaced', startTime: 0, text: 'An unplaced sentence.' }),
    ];
    renderPage();
    expect(screen.getByText('@1:30')).toBeTruthy();
    expect(screen.getByText('placed')).toBeTruthy();
    expect(screen.getByText('unplaced')).toBeTruthy();
    expect(screen.queryByText('@0:00')).toBeNull();
  });
});
