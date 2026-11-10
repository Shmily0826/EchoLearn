// @vitest-environment jsdom
/**
 * "Jump back to where I learned this" — used by the Vocabulary and Sentences
 * pages on every saved item.
 *
 * Two things the learner depends on:
 *  - A deleted session must degrade to `{ ok: false }` (the caller then offers a
 *    plain YouTube link) instead of navigating to an empty study page.
 *  - A live session must navigate AND leave a seek request behind, because
 *    StudyPage only reloads on a session-id change and would otherwise ignore a
 *    timestamp inside an already-open video.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoStudySession } from '../../types';
import {
  SEEK_REQUEST_EVENT,
  formatTimestamp,
  jumpToSource,
  youtubeUrlAt,
  type SeekRequestDetail,
} from '../jumpToSource';

function session(videoId = 'vid_1'): VideoStudySession {
  return {
    id: 'sess_1',
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    youtubeId: videoId,
    title: 'A lesson',
    transcriptLines: [],
    createdAt: 1,
    updatedAt: 1,
    status: 'studying',
    lastPosition: 0,
  } as VideoStudySession;
}

describe('jump to source', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports failure without navigating when the study session was deleted', () => {
    const navigate = vi.fn();

    const result = jumpToSource('vid_missing', 42, navigate);

    expect(result).toEqual({ ok: false });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports failure for an item that has no source video', () => {
    const navigate = vi.fn();

    expect(jumpToSource('', 10, navigate)).toEqual({ ok: false });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('resumes at the saved moment and asks the live player to seek there', () => {
    localStorage.setItem('echolearn_sessions_list', JSON.stringify([session('vid_1')]));
    const navigate = vi.fn();
    const seeks: SeekRequestDetail[] = [];
    const onSeek = (event: Event) => seeks.push((event as CustomEvent<SeekRequestDetail>).detail);
    window.addEventListener(SEEK_REQUEST_EVENT, onSeek);
    vi.useFakeTimers();

    const result = jumpToSource('vid_1', 90.7, navigate);
    vi.advanceTimersByTime(100);
    window.removeEventListener(SEEK_REQUEST_EVENT, onSeek);

    expect(result).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith('/study');
    // The resume position is persisted so a fresh StudyPage mount starts there.
    const stored = JSON.parse(localStorage.getItem('echolearn_session') as string) as VideoStudySession;
    expect(stored.youtubeId).toBe('vid_1');
    expect(stored.lastPosition).toBe(90);
    // …and the seek event covers the already-open-video case.
    expect(seeks).toEqual([{ videoId: 'vid_1', seconds: 90 }]);
  });

  it('clamps a missing or negative timestamp to the start of the video', () => {
    localStorage.setItem('echolearn_sessions_list', JSON.stringify([session('vid_1')]));
    const navigate = vi.fn();
    vi.useFakeTimers();

    jumpToSource('vid_1', -12, navigate);

    const stored = JSON.parse(localStorage.getItem('echolearn_session') as string) as VideoStudySession;
    expect(stored.lastPosition).toBe(0);
  });
});

describe('timestamp labels and fallback links', () => {
  it('renders mm:ss under an hour and h:mm:ss over it', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(9)).toBe('0:09');
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(600)).toBe('10:00');
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });

  it('never renders a negative timestamp', () => {
    expect(formatTimestamp(-30)).toBe('0:00');
  });

  it('links to the exact second, and to the plain video when the moment is unknown', () => {
    expect(youtubeUrlAt('vid_1', 90)).toBe('https://www.youtube.com/watch?v=vid_1&t=90s');
    expect(youtubeUrlAt('vid_1')).toBe('https://www.youtube.com/watch?v=vid_1');
    expect(youtubeUrlAt('vid_1', 0)).toBe('https://www.youtube.com/watch?v=vid_1');
  });
});
