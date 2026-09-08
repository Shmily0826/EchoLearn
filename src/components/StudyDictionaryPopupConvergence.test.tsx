// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nContext';
import type { DictionaryEntry, TranscriptLine, VocabularyItem, SentenceItem } from '../types';
import TranscriptViewer from './TranscriptViewer';
import MobileTranscriptPanel from './study/MobileTranscriptPanel';
import { lookupWord } from '../services/dictionaryService';

const sharedPopup = vi.fn();

vi.mock('./WordDictionaryPopup', () => ({
  default: (props: {
    word: string;
    context?: string;
    actions?: React.ReactNode;
    onClose: () => void;
    onDataChange?: (data: { word: string; entry: DictionaryEntry | null; meaningCn: string }) => void;
  }) => {
    sharedPopup(props);
    return (
      <div data-testid="shared-study-popup" data-word={props.word} data-context={props.context}>
        <div data-testid="shared-p2-content">prep · 1. shared definition · Merriam-Webster attribution</div>
        <button onClick={props.onClose}>Close popup</button>
        {props.actions}
      </div>
    );
  },
}));

vi.mock('../services/dictionaryService', () => ({ lookupWord: vi.fn() }));

const line: TranscriptLine = { id: 'line-1', start: 12, end: 14, text: 'test word' };
const entry: DictionaryEntry = {
  word: 'test',
  phonetic: '',
  audioUrl: '',
  partOfSpeech: 'noun',
  definitionEn: 'a test',
  definitionsEn: [{ pos: 'noun', definition: 'a test' }],
  example: '',
  synonyms: [],
  antonyms: [],
  provider: 'Free Dictionary',
};

const renderWithI18n = (child: React.ReactNode) => render(<I18nProvider>{child}</I18nProvider>);

const desktopProps = {
  lines: [line],
  videoId: 'video-1',
  videoTitle: 'Video',
  onAddVocabulary: vi.fn<(item: VocabularyItem) => void>(),
  onAddSentence: vi.fn<(item: SentenceItem) => void>(),
  onRemoveSentence: vi.fn<(id: string) => void>(),
  savedWords: new Set<string>(),
  savedSentences: new Set<string>(),
  savedSentenceIds: new Map<string, string>(),
  activeLineIndex: -1,
  onSeekTo: vi.fn<(seconds: number) => void>(),
};

const mobileProps = {
  lines: [line],
  activeLineIndex: -1,
  videoId: 'video-1',
  videoTitle: 'Video',
  savedWords: new Set<string>(),
  savedSentences: new Set<string>(),
  savedSentenceIds: new Map<string, string>(),
  onAddVocabulary: vi.fn<(item: VocabularyItem) => void>(),
  onAddSentence: vi.fn<(item: SentenceItem) => void>(),
  onRemoveSentence: vi.fn<(id: string) => void>(),
  onSeekTo: vi.fn<(seconds: number) => void>(),
};

describe('Study dictionary popup convergence', () => {
  beforeEach(() => {
    localStorage.setItem('echolearn_lang', 'en');
    vi.clearAllMocks();
    vi.mocked(lookupWord).mockResolvedValue(entry);
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => cleanup());

  it('desktop Study word clicks render the shared P2 popup and retain save action', () => {
    renderWithI18n(<TranscriptViewer {...desktopProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Look up test' }));

    expect(screen.getByTestId('shared-study-popup').getAttribute('data-word')).toBe('test');
    expect(screen.getByTestId('shared-p2-content')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add/i })).toBeTruthy();
    expect(sharedPopup).toHaveBeenCalled();
  });

  it('mobile Study word clicks render the shared P2 popup and retain close/save behavior', async () => {
    renderWithI18n(<MobileTranscriptPanel {...mobileProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Look up test' }));

    expect(screen.getByTestId('shared-study-popup').getAttribute('data-word')).toBe('test');
    expect(screen.getByTestId('shared-p2-content')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close popup' }));
    expect(screen.queryByTestId('shared-study-popup')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Look up test' }));
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(mobileProps.onAddVocabulary).toHaveBeenCalledOnce());
  });
});
