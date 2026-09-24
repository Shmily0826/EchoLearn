// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { usePlaybackPosition } from '../usePlaybackPosition';
import type { PlayerHandle } from '../../components/YouTubeEmbed';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function playerAt(getTime: () => number): PlayerHandle {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: getTime,
    setPlaybackRate: vi.fn(),
    getPlaybackRate: vi.fn(() => 1),
  };
}

/**
 * A restored local-audio lesson resolves its blob URL after the page renders,
 * so the player handle appears one or more ticks late. The clock must survive
 * that ordering: it used to bail out of creating its interval while the handle
 * was missing, which left the transcript frozen at 0:00 for the whole lesson.
 */
describe('usePlaybackPosition', () => {
  it('starts reporting once the player mounts later than the hook', () => {
    let time = 0;
    const onPositionChange = vi.fn();
    // Stays null across the hook's first effect, exactly like the player of a
    // restored lesson whose blob URL has not resolved yet.
    const playerRef: { current: PlayerHandle | null } = { current: null };

    const { result } = renderHook(() => usePlaybackPosition({
      playerRef,
      videoId: 'local_1',
      platform: 'youtube',
      audioMode: true,
      onPositionChange,
    }));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.currentTime).toBe(0);

    time = 42.5;
    playerRef.current = playerAt(() => time);
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.currentTime).toBe(42.5);
  });

  it('persists a resume position at most every few seconds', () => {
    let time = 0;
    const onPositionChange = vi.fn();
    renderHook(() => {
      const playerRef = useRef<PlayerHandle | null>(playerAt(() => time));
      return usePlaybackPosition({
        playerRef,
        videoId: 'local_1',
        platform: 'youtube',
        audioMode: true,
        onPositionChange,
      });
    });

    time = 10;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    time = 11;
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(onPositionChange).toHaveBeenCalledTimes(2);
    expect(onPositionChange).toHaveBeenLastCalledWith(11);
  });

  it('keeps the clock off for a Bilibili video that is not in audio mode', () => {
    const onPositionChange = vi.fn();
    const { result } = renderHook(() => {
      const playerRef = useRef<PlayerHandle | null>(playerAt(() => 30));
      return usePlaybackPosition({
        playerRef,
        videoId: 'bv1',
        platform: 'bilibili',
        audioMode: false,
        onPositionChange,
      });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.currentTime).toBe(0);
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});
