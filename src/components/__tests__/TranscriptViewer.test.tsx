// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({ lang: 'zh', t: (key: string) => key }),
}));
vi.mock('../../services/dictionaryService', () => ({
  lookupWord: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../services/vocabularyEnrichment', () => ({
  prepareVocabularyItem: vi.fn((item: unknown) => item),
}));
vi.mock('../WordDictionaryPopup', () => ({
  default: ({ word, onClose, actions }: { word: string; onClose: () => void; actions?: React.ReactNode }) => (
    <div data-testid="dict-popup">
      <span data-testid="popup-word">{word}</span>
      {actions}
      <button onClick={onClose}>close-popup</button>
    </div>
  ),
}));

import TranscriptViewer from '../TranscriptViewer';
import type { ComponentProps } from 'react';
import type { TranscriptLine } from '../../types';

const lines: TranscriptLine[] = [
  { text: 'This is the first line.', start: 0, end: 5 },
  { text: 'And here is a placed sentence.', start: 90, end: 95 },
  { text: 'Finally the last line.', start: 566, end: 572 },
];

const renderViewer = (overrides: Record<string, unknown> = {}) => {
  const props = {
    lines,
    videoId: 'vid1',
    videoTitle: 'A video',
    onAddVocabulary: vi.fn(),
    onAddSentence: vi.fn(),
    onRemoveSentence: vi.fn(),
    savedWords: new Set<string>(),
    savedSentences: new Set<string>(),
    activeLineIndex: -1,
    onSelectLine: vi.fn(),
    onSeekTo: vi.fn(),
    onLookupStateChange: vi.fn(),
    ...overrides,
  };
  render(<TranscriptViewer {...(props as unknown as ComponentProps<typeof TranscriptViewer>)} />);
  return props;
};

describe('TranscriptViewer line interactions', () => {
  afterEach(() => cleanup());

  it('renders every line with its formatted timestamp', () => {
    renderViewer();
    // Sentence text is tokenized into per-word spans — assert one token per line.
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('placed')).toBeTruthy();
    expect(screen.getByText('last')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(screen.getByText('9:26')).toBeTruthy();
  });

  it('selects the line and seeks when a row is clicked', () => {
    const { onSelectLine, onSeekTo } = renderViewer();
    const row = screen.getByText('placed').closest('[data-transcript-line]');
    fireEvent.click(row!);
    expect(onSelectLine).toHaveBeenCalledWith(lines[1]);
    expect(onSeekTo).toHaveBeenCalledWith(90);
  });

  it('saves the clicked line as a sentence carrying its confirmed moment', () => {
    const { onAddSentence } = renderViewer();
    fireEvent.click(screen.getAllByLabelText('study.saveSentenceBookmark')[1]); // second line, start=90
    expect(onAddSentence).toHaveBeenCalledTimes(1);
    const item = onAddSentence.mock.calls[0][0] as { text: string; startTime: number };
    expect(item.text).toBe('And here is a placed sentence.');
    expect(item.startTime).toBe(90);
  });

  it('removes a saved sentence through its bookmark button', () => {
    const { onAddSentence, onRemoveSentence } = renderViewer({
      savedSentences: new Set([lines[1].text]),
      savedSentenceIds: new Map([[lines[1].text, 'sent-42']]),
    });
    fireEvent.click(screen.getByLabelText('study.removeSentenceBookmark'));
    expect(onRemoveSentence).toHaveBeenCalledWith('sent-42');
    expect(onAddSentence).not.toHaveBeenCalled();
    // the other two lines keep their unsaved bookmark buttons
    expect(screen.getAllByLabelText('study.saveSentenceBookmark')).toHaveLength(2);
  });
});

describe('TranscriptViewer word lookup', () => {
  afterEach(() => cleanup());

  it('opens the popup on word click and reports lookup state on close', () => {
    const { onLookupStateChange, onSelectLine } = renderViewer();
    fireEvent.click(screen.getByText('placed'));
    expect(screen.getByTestId('popup-word').textContent).toBe('placed');
    expect(onLookupStateChange).toHaveBeenCalledWith(true);
    expect(onSelectLine).toHaveBeenCalledWith(lines[1]);

    fireEvent.click(screen.getByText('close-popup'));
    expect(onLookupStateChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('dict-popup')).toBeNull();
  });

  it('saves a vocabulary item with the word timestamped from its line', async () => {
    const { onAddVocabulary } = renderViewer();
    fireEvent.click(screen.getByText('placed'));
    fireEvent.click(screen.getByText('transcript.addWord'));
    await waitFor(() => expect(onAddVocabulary).toHaveBeenCalledTimes(1));
    const item = onAddVocabulary.mock.calls[0][0] as { word: string; sourceTimestamp: number; sourceVideoId: string };
    expect(item.word).toBe('placed');
    expect(item.sourceTimestamp).toBe(90);
    expect(item.sourceVideoId).toBe('vid1');
  });
});
