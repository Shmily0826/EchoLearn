// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioMode } from '../useAudioMode';
import type { VideoStudySession, VideoPlatform } from '../../types';

const CF_WORKER_URL = 'https://yt-transcript-proxy.rng2018520.workers.dev';

function makeSession(youtubeUrl: string): VideoStudySession {
  return {
    id: 's1',
    youtubeUrl,
    youtubeId: 'BV1xx411c7mD',
    title: 'T',
    transcriptLines: [],
    createdAt: 0,
    updatedAt: 0,
    status: 'studying',
  };
}

function setup(
  props: Partial<Parameters<typeof useAudioMode>[0]> = {},
) {
  const initialProps = {
    session: null,
    platform: 'youtube' as VideoPlatform,
    videoId: 'dQw4w9WgXcQ',
    biliPage: undefined,
    ...props,
  };
  return renderHook(
    (p: Parameters<typeof useAudioMode>[0]) => useAudioMode(p),
    { initialProps },
  );
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function audioResponse(ct: string, ok = true) {
  return {
    ok,
    headers: { get: (name: string) => (name === 'content-type' ? ct : null) },
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Canonical URL derivation ─────────────────────────────────

describe('useAudioMode — videoUrl derivation', () => {
  it('uses the saved http(s) URL when present (share text tolerated)', () => {
    const { result } = setup({
      session: makeSession('【标题】 https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    });
    expect(result.current.videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('keeps a saved b23.tv short link as-is', () => {
    const { result } = setup({
      session: makeSession('https://b23.tv/hbSyQzx'),
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
    });
    expect(result.current.videoUrl).toBe('https://b23.tv/hbSyQzx');
  });

  it('falls back to the canonical URL when the stored value is not a URL', () => {
    const { result } = setup({
      session: makeSession('BV1xx411c7mD'), // legacy plain-BV youtubeUrl
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
    });
    expect(result.current.videoUrl).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });

  it('appends the selected part to the Bilibili canonical URL (p>1 only)', () => {
    const a = setup({ platform: 'bilibili', videoId: 'BV1xx411c7mD', biliPage: 3 });
    expect(a.result.current.videoUrl).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=3');
    const b = setup({ platform: 'bilibili', videoId: 'BV1xx411c7mD', biliPage: 1 });
    expect(b.result.current.videoUrl).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });

  it('builds the YouTube canonical URL without a session', () => {
    const { result } = setup({ platform: 'youtube', videoId: 'dQw4w9WgXcQ' });
    expect(result.current.videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

// ── Audio source selection ───────────────────────────────────

describe('useAudioMode — audio source URLs', () => {
  it('audioSrc is null until audio mode is on and a video is loaded', () => {
    const { result } = setup({ platform: 'youtube' });
    expect(result.current.audioSrc).toBeNull();
    act(() => {
      result.current.setAudioMode(true);
    });
    expect(result.current.audioSrc).toBe(
      `${CF_WORKER_URL}/api/audio?url=${encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}`,
    );
  });

  it('Bilibili fallback stays same-origin (never a direct VPS URL)', () => {
    const { result } = setup({ platform: 'bilibili', videoId: 'BV1xx411c7mD' });
    // Bilibili auto-enables audio mode.
    expect(result.current.audioMode).toBe(true);
    expect(result.current.audioFallbackSrc).toBe(
      `/api/bilibili?audio=1&url=${encodeURIComponent('https://www.bilibili.com/video/BV1xx411c7mD')}`,
    );
    expect(result.current.audioFallbackSrc).not.toContain('yt-api.echo-learn.uk');
  });

  it('YouTube fallback goes through the Worker, never the VPS directly', () => {
    const { result } = setup({ platform: 'youtube' });
    act(() => {
      result.current.setAudioMode(true);
    });
    expect(result.current.audioFallbackSrc).toContain(CF_WORKER_URL);
    expect(result.current.audioFallbackSrc).not.toContain('yt-api.echo-learn.uk');
  });
});

// ── Preference persistence & platform rule ───────────────────

describe('useAudioMode — preference and platform rules', () => {
  it('persists the audioMode preference to localStorage', () => {
    const { result } = setup({ platform: 'youtube' });
    expect(localStorage.getItem('echolearn_audio_mode')).toBe('0');
    act(() => {
      result.current.setAudioMode(true);
    });
    expect(localStorage.getItem('echolearn_audio_mode')).toBe('1');
  });

  it('restores the persisted preference on mount', () => {
    localStorage.setItem('echolearn_audio_mode', '1');
    const { result } = setup({ platform: 'youtube' });
    expect(result.current.audioMode).toBe(true);
  });

  it('auto-enables audio mode when the platform switches to bilibili', () => {
    const { result, rerender } = setup({ platform: 'youtube' });
    expect(result.current.audioMode).toBe(false);
    act(() => {
      rerender({ session: null, platform: 'bilibili', videoId: 'BV1xx411c7mD', biliPage: undefined });
    });
    expect(result.current.audioMode).toBe(true);
  });
});

// ── Pre-warm lifecycle ───────────────────────────────────────

describe('useAudioMode — audio cache pre-warm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not pre-warm while audio mode is on (AudioPlayer owns it)', async () => {
    localStorage.setItem('echolearn_audio_mode', '1');
    setup({ platform: 'youtube' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops retrying once real audio (audio/* content-type) is cached', async () => {
    fetchMock.mockResolvedValue(audioResponse('audio/mpeg'));
    setup({ platform: 'youtube' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retries after success
  });

  it('retries with backoff when the response is not real audio', async () => {
    fetchMock.mockResolvedValue(audioResponse('application/json')); // 200 but error JSON
    setup({ platform: 'youtube' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // First backoff is 2.5s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second backoff is 5s more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after 5 attempts', async () => {
    fetchMock.mockResolvedValue(audioResponse('application/json'));
    setup({ platform: 'youtube' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500 + 5000 + 7500 + 10000 + 1000);
    });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('aborts the retry loop when the video changes', async () => {
    fetchMock.mockResolvedValue(audioResponse('application/json'));
    const { rerender } = setup({ platform: 'youtube', videoId: 'aaaaaaaaaaa' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ session: null, platform: 'youtube', videoId: 'bbbbbbbbbbb', biliPage: undefined });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Old video's loop aborted; only the new video's first fetch happened.
    const calledUrls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calledUrls.filter((u) => u.includes('aaaaaaaaaaa'))).toHaveLength(1);
  });
});
