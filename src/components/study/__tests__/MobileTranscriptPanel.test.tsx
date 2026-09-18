// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('../../../i18n/I18nContext', () => ({
  useI18n: () => ({ lang: 'zh', t: (key: string) => key }),
}));
vi.mock('../../../services/dictionaryService', () => ({
  lookupWord: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../../services/vocabularyEnrichment', () => ({
  prepareVocabularyItem: vi.fn((item: unknown) => item),
}));
vi.mock('../../WordDictionaryPopup', () => ({
  default: ({ word, onClose, actions }: { word: string; onClose: () => void; actions?: React.ReactNode }) => (
    <div data-testid="dict-popup">
      <span data-testid="popup-word">{word}</span>
      {actions}
      <button onClick={onClose}>close-popup</button>
    </div>
  ),
}));

import MobileTranscriptPanel from '../MobileTranscriptPanel';
import type { TranscriptLine } from '../../../types';

// jsdom has no Element.scrollTo; the active-line auto-scroll effect calls it.
Element.prototype.scrollTo = vi.fn();

const lines: TranscriptLine[] = [
  { text: 'This is the first line.', start: 0, end: 5 },
  { text: 'And here is a placed sentence.', start: 90, end: 95 },
];

const renderPanel = (overrides: Record<string, unknown> = {}) => {
  const props = {
    lines,
    activeLineIndex: -1,
    videoId: 'vid1',
    videoTitle: 'A video',
    savedWords: new Set<string>(),
    savedSentences: new Set<string>(),
    savedSentenceIds: new Map<string, string>(),
    onSelectLine: vi.fn(),
    onLookupStateChange: vi.fn(),
    onAddVocabulary: vi.fn(),
    onAddSentence: vi.fn(),
    onRemoveSentence: vi.fn(),
    onSeekTo: vi.fn(),
    ...overrides,
  };
  const view = render(<MobileTranscriptPanel {...(props as unknown as ComponentProps<typeof MobileTranscriptPanel>)} />);
  return { ...props, view };
};

const rowOf = (token: string) => screen.getByText(token).closest('[data-transcript-line]')!;
const bookmarkOf = (token: string) => rowOf(token).querySelector('button')!;

describe('MobileTranscriptPanel', () => {
  afterEach(() => cleanup());

  it('shows an empty hint when there are no subtitle lines', () => {
    renderPanel({ lines: [] });
    expect(screen.getByText('study.noSubtitles')).toBeTruthy();
  });

  it('marks the active line with the highlight style', () => {
    renderPanel({ activeLineIndex: 1 });
    expect(rowOf('placed').className).toContain('bg-indigo-50');
    expect(rowOf('first').className).not.toContain('bg-indigo-50');
  });

  it('tapping a line timestamp selects the line and seeks to its start', () => {
    const { onSelectLine, onSeekTo } = renderPanel();
    fireEvent.click(screen.getByText('0:00'));
    expect(onSelectLine).toHaveBeenCalledWith(lines[0]);
    expect(onSeekTo).toHaveBeenCalledWith(0);
  });

  it('bookmark button toggles a saved sentence through the id map', () => {
    const { onAddSentence, onRemoveSentence } = renderPanel({
      savedSentences: new Set([lines[0].text]),
      savedSentenceIds: new Map([[lines[0].text, 'sent-7']]),
    });
    fireEvent.click(bookmarkOf('first'));
    expect(onRemoveSentence).toHaveBeenCalledWith('sent-7');
    expect(onAddSentence).not.toHaveBeenCalled();

    fireEvent.click(bookmarkOf('placed'));
    expect(onAddSentence).toHaveBeenCalledTimes(1);
    const item = onAddSentence.mock.calls[0][0] as { text: string; startTime: number };
    expect(item.text).toBe('And here is a placed sentence.');
    expect(item.startTime).toBe(90);
  });

  it('word tap opens the lookup popup and reports lookup state', () => {
    const { onSelectLine, onLookupStateChange } = renderPanel();
    fireEvent.click(screen.getByText('placed'));
    expect(screen.getByTestId('popup-word').textContent).toBe('placed');
    expect(onSelectLine).toHaveBeenCalledWith(lines[1]);
    expect(onLookupStateChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText('close-popup'));
    expect(onLookupStateChange).toHaveBeenCalledWith(false);
  });

  it('offers the already-saved label instead of a duplicate add button', () => {
    renderPanel({ savedWords: new Set(['here']) });
    fireEvent.click(screen.getByText('here'));
    expect(screen.getByText('study.alreadySaved')).toBeTruthy();
    expect(screen.queryByText(/study\.addToVocab/)).toBeNull();
  });

  it('add-word saves a vocabulary item timestamped from its line', async () => {
    const { onAddVocabulary } = renderPanel();
    fireEvent.click(screen.getByText('placed'));
    fireEvent.click(screen.getByText(/study\.addToVocab/));
    await waitFor(() => expect(onAddVocabulary).toHaveBeenCalledTimes(1));
    const item = onAddVocabulary.mock.calls[0][0] as { word: string; sourceTimestamp: number };
    expect(item.word).toBe('placed');
    expect(item.sourceTimestamp).toBe(90);
  });
});
