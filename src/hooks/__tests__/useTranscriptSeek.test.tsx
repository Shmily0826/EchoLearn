// @vitest-environment jsdom
/**
 * `useTranscriptSeek` is the consumer of the seek request that "jump to source"
 * emits. The player is usually still loading when the request arrives, so the
 * hook keeps the request pending and retries until the player handle exists.
 *
 * What the learner notices if this breaks:
 *  - tapping a saved word lands at 0:00 instead of the moment it was learned;
 *  - or, worse, a stale request fires minutes later and yanks a later lesson to
 *    an old timestamp. Requests must expire and must never apply to another video.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerHandle } from '../../components/YouTubeEmbed';
import { useTranscriptSeek } from '../useTranscriptSeek';
import { SEEK_REQUEST_EVENT } from '../../utils/jumpToSource';

function player() {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 600),
    setPlaybackRate: vi.fn(),
    getPlaybackRate: vi.fn(() => 1),
  } satisfies PlayerHandle;
}

function requestSeek(videoId: string, seconds: number): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(SEEK_REQUEST_EVENT, { detail: { videoId, seconds } }),
    );
  });
}

describe('transcript seek requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a request that arrives before the player is ready', async () => {
    const playerRef: { current: PlayerHandle | null } = { current: null };
    renderHook(() =>
      useTranscriptSeek({
        playerRef,
        videoId: 'vid_1',
        pathname: '/study',
        currentTime: 0,
        displayLines: [],
      }),
    );

    requestSeek('vid_1', 42);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // Nothing to seek yet — the player has not mounted.
    expect(playerRef.current).toBeNull();

    const handle = player();
    playerRef.current = handle;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(handle.seekTo).toHaveBeenCalledWith(42);
    expect(handle.playVideo).toHaveBeenCalled();
  });

  it('ignores a request addressed to a different video', async () => {
    const handle = player();
    const playerRef: { current: PlayerHandle | null } = { current: handle };
    renderHook(() =>
      useTranscriptSeek({
        playerRef,
        videoId: 'vid_1',
        pathname: '/study',
        currentTime: 0,
        displayLines: [],
      }),
    );

    requestSeek('vid_other', 42);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(handle.seekTo).not.toHaveBeenCalled();
  });

  it('drops a request that could not be applied while the player was missing', async () => {
    const playerRef: { current: PlayerHandle | null } = { current: null };
    renderHook(() =>
      useTranscriptSeek({
        playerRef,
        videoId: 'vid_1',
        pathname: '/study',
        currentTime: 0,
        displayLines: [],
      }),
    );

    requestSeek('vid_1', 42);
    // The hook gives up after ~40 attempts of 150ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    const handle = player();
    playerRef.current = handle;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(handle.seekTo).not.toHaveBeenCalled();
  });

  it('tracks the active transcript line as playback advances', () => {
    const playerRef: { current: PlayerHandle | null } = { current: null };
    const displayLines = [
      { start: 0, end: 2, text: 'first' },
      { start: 2, end: 4, text: 'second' },
    ];
    const { result, rerender } = renderHook(
      ({ currentTime }: { currentTime: number }) =>
        useTranscriptSeek({ playerRef, videoId: 'vid_1', pathname: '/study', currentTime, displayLines }),
      { initialProps: { currentTime: 0.5 } },
    );

    expect(result.current.activeLineIndex).toBe(0);

    rerender({ currentTime: 3 });

    expect(result.current.activeLineIndex).toBe(1);
  });
});
