// @vitest-environment jsdom
import { cleanup, render, act } from '@testing-library/react';
import { Profiler, useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { usePlaybackPosition } from '../../hooks/usePlaybackPosition';
import type { PlayerHandle } from '../YouTubeEmbed';
import TranscriptViewer from '../TranscriptViewer';
import MobileTranscriptPanel from '../study/MobileTranscriptPanel';
import type { TranscriptLine } from '../../types';

const metrics = vi.hoisted(() => ({ lemmatizeCalls: 0, clockReads: 0, commits: 0 }));
vi.mock('../../utils/lemmatizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/lemmatizer')>();
  return {
    ...actual,
    lemmatize: (word: string) => {
      metrics.lemmatizeCalls++;
      return actual.lemmatize(word);
    },
  };
});
vi.mock('../../i18n/I18nContext', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('../../services/dictionaryService', () => ({ lookupWord: vi.fn() }));
vi.mock('../../services/vocabularyEnrichment', () => ({ prepareVocabularyItem: vi.fn((item: unknown) => item) }));
vi.mock('../WordDictionaryPopup', () => ({ default: () => null }));

const lines: TranscriptLine[] = Array.from({ length: 1461 }, (_, i) => ({
  text: 'Students learned useful words.',
  start: i * 4,
  end: i * 4 + 3.5,
}));
const savedWords = new Set<string>();
const savedSentences = new Set<string>();
const savedSentenceIds = new Map<string, string>();
const noop = () => {};

function countLegacyWordCalls(inputLines: TranscriptLine[]) {
  return inputLines.reduce((count, line) =>
    count + (line.text.match(/[\w']+|[^\w\s]+|\s+/g) || []).filter((token) => /^[\w']+$/.test(token)).length * 2,
  0);
}

function PlaybackTranscriptFixture({ fixtureLines = lines }: { fixtureLines?: TranscriptLine[] }) {
  const [pathname, setPathname] = useState('/study');
  const [lessonLines, setLessonLines] = useState(fixtureLines);
  const [lessonSavedWords, setLessonSavedWords] = useState(savedWords);
  const seconds = useRef(0);
  const paused = useRef(false);
  const [player] = useState<PlayerHandle>(() => ({
      playVideo: noop,
      pauseVideo: () => { paused.current = true; },
      seekTo: noop,
      getCurrentTime: () => {
        metrics.clockReads++;
        if (!paused.current) seconds.current += 0.1;
        return seconds.current;
      },
      setPlaybackRate: noop,
      getPlaybackRate: () => 1,
    }));
  const playerRef = useRef<PlayerHandle | null>(player);
  useEffect(() => {
    if (pathname !== '/study') player.pauseVideo();
  }, [pathname, player]);
  const { currentTime } = usePlaybackPosition({
    playerRef,
    videoId: 'local-fixture',
    platform: 'youtube',
    audioMode: true,
    onPositionChange: noop,
  });
  const activeLineIndex = Math.min(lessonLines.length - 1, Math.floor(currentTime / 4));

  return (
    <>
      <button onClick={() => setPathname('/dashboard')}>leave Study</button>
      <button onClick={() => setLessonSavedWords(new Set(['student']))}>save student</button>
      <button onClick={() => setLessonLines((current) => current.map((line, index) =>
        index === 0 ? { ...line, text: 'Students learned new material.' } : line,
      ))}>change lesson</button>
      <Profiler id="study-transcripts" onRender={() => { metrics.commits++; }}>
        <div style={{ display: pathname === '/study' ? undefined : 'none' }}>
          <TranscriptViewer
            lines={lessonLines}
            videoId="local-fixture"
            onAddVocabulary={noop}
            onAddSentence={noop}
            savedWords={lessonSavedWords}
            savedSentences={savedSentences}
            activeLineIndex={activeLineIndex}
            onSelectLine={noop}
            onSeekTo={noop}
          />
          <MobileTranscriptPanel
            lines={lessonLines}
            activeLineIndex={activeLineIndex}
            videoId="local-fixture"
            videoTitle="Local fixture"
            savedWords={lessonSavedWords}
            savedSentences={savedSentences}
            savedSentenceIds={savedSentenceIds}
            onAddVocabulary={noop}
            onAddSentence={noop}
            onRemoveSentence={noop}
            onSeekTo={noop}
          />
        </div>
      </Profiler>
    </>
  );
}

describe('playback transcript work', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not repeat word lemmatization for unchanged lesson data on clock ticks', () => {
    vi.useFakeTimers();
    metrics.lemmatizeCalls = 0;
    metrics.clockReads = 0;
    metrics.commits = 0;
    const legacyMountCalls = countLegacyWordCalls(lines);
    const legacyTickCalls = legacyMountCalls * 3;

    render(<PlaybackTranscriptFixture />);
    const initialCalls = metrics.lemmatizeCalls;
    const initialReads = metrics.clockReads;
    const initialCommits = metrics.commits;
    expect(initialCalls).toBe(lines.length * 4 * 2);
    expect(legacyMountCalls).toBe(initialCalls);
    expect(legacyTickCalls).toBe(legacyMountCalls * 3);

    for (let i = 0; i < 3; i++) {
      act(() => vi.advanceTimersByTime(100));
    }

    expect(metrics.clockReads - initialReads).toBe(3);
    expect(metrics.commits - initialCommits).toBe(3);
    expect(metrics.lemmatizeCalls, `lemmatize calls grew from ${initialCalls}`).toBe(initialCalls);
  }, 10_000);

  it('keeps polling after route leave but pauses without rerendering the hidden Study tree', () => {
    vi.useFakeTimers();
    metrics.lemmatizeCalls = 0;
    metrics.clockReads = 0;
    metrics.commits = 0;
    const { getByText } = render(<PlaybackTranscriptFixture fixtureLines={lines.slice(0, 2)} />);
    fireEvent.click(getByText('leave Study'));
    const commitsWhenHidden = metrics.commits;
    const readsWhenHidden = metrics.clockReads;

    act(() => vi.advanceTimersByTime(500));

    expect(metrics.clockReads - readsWhenHidden).toBe(5);
    expect(metrics.commits).toBe(commitsWhenHidden);
  });

  it('recomputes cached words when lesson lines or saved words change', () => {
    const shortLines = lines.slice(0, 2);
    metrics.lemmatizeCalls = 0;
    const { getAllByRole, getByText } = render(<PlaybackTranscriptFixture fixtureLines={shortLines} />);
    const initialCalls = metrics.lemmatizeCalls;
    expect(initialCalls).toBe(shortLines.length * 4 * 2);

    fireEvent.click(getByText('save student'));
    expect(metrics.lemmatizeCalls - initialCalls).toBe(shortLines.length * 4 * 2);
    expect(getAllByRole('button', { name: 'Look up Students' }).every((word) =>
      word.className.includes('bg-amber-100'),
    )).toBe(true);

    const afterSavedWords = metrics.lemmatizeCalls;
    fireEvent.click(getByText('change lesson'));
    expect(metrics.lemmatizeCalls - afterSavedWords).toBe(shortLines.length * 4 * 2);
    expect(getAllByRole('button', { name: 'Look up Students' }).every((word) =>
      word.className.includes('bg-amber-100'),
    )).toBe(true);
  });
});
