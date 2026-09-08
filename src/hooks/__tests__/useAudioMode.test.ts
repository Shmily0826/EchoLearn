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
  it('YouTube focus mode has no extracted audio source or fallback', () => {
    localStorage.setItem('echolearn_audio_mode', '1');
    const { result } = setup({ platform: 'youtube' });
    expect(result.current.audioSrc).toBeNull();
    expect(result.current.audioSrc).toBeNull();
    expect(result.current.audioFallbackSrc).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Bilibili keeps extracted audio and a same-origin fallback', () => {
    const { result } = setup({ platform: 'bilibili', videoId: 'BV1xx411c7mD' });
    // Bilibili auto-enables audio mode.
    expect(result.current.audioMode).toBe(true);
    expect(result.current.audioSrc).toBe(
      `${CF_WORKER_URL}/api/audio?url=${encodeURIComponent('https://www.bilibili.com/video/BV1xx411c7mD')}`,
    );
    expect(result.current.audioFallbackSrc).toBe(
      `/api/bilibili?audio=1&url=${encodeURIComponent('https://www.bilibili.com/video/BV1xx411c7mD')}`,
    );
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

  it('does not pre-warm YouTube focus mode or normal playback', async () => {
    setup({ platform: 'youtube' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
