import { describe, expect, it, vi } from 'vitest';
// Vite's raw import lets this contract test run in the browser-oriented
// TypeScript project without adding Node-only test types to the app build.
import source from '../../../cf-worker/src/index.js?raw';
import {
  CAPTION_DEADLINE_MS,
  createCaptionContext,
  createProviderContext,
  handleTranscript,
  readResponseBody,
// @ts-expect-error The Worker is plain JavaScript; this import is test-only.
} from '../../../cf-worker/src/index.js';

describe('CF Worker transcript routing contract', () => {
  it('keeps the direct ASR block before caption providers', () => {
    const providers = [
      'const innerTubeResult = await fetchViaInnerTube',
      'const webResult = await fetchViaWebPage',
      'const invidiousResult = await fetchViaInvidious',
      'const pipedResult = await fetchViaPiped',
    ].map((marker) => source.indexOf(marker));
    const asr = source.indexOf('if (allowAsr)');

    expect(Math.min(...providers)).toBeGreaterThan(-1);
    expect(asr).toBeLessThan(Math.min(...providers));
  });

  it('requires explicit allowAsr=1 before generation paths', () => {
    expect(source).toContain("const allowAsr = url.searchParams.get('allowAsr') === '1'");
    expect(source).toContain("error: 'asr_required'");
    expect(source).toContain('} else if (env && env.GROQ_API_KEY)');
    expect(source).toContain('if (allowAsr)');
    expect(source).toContain('clearTimeout(timer)');
    expect(source).toContain('captionProviderTimedOut = true');
    expect(source).toContain('const asrAvailable = !!(env && (env.YTDLP_API_URL || env.GROQ_API_KEY))');
  });

  it('keeps a VPS-local timeout cancellable without aborting the global caption budget', () => {
    vi.useFakeTimers();
    const globalContext = createCaptionContext();
    const vpsContext = createProviderContext(globalContext, 5000);

    vi.advanceTimersByTime(5000);

    expect(vpsContext.signal.aborted).toBe(true);
    expect(globalContext.signal.aborted).toBe(false);
    expect(globalContext.remainingBudget()).toBeGreaterThan(0);

    vpsContext.dispose();
    globalContext.dispose();
    vi.useRealTimers();
  });

  it('returns provider_timeout when a caption body read hangs until the global deadline', async () => {
    const context = createCaptionContext(20);
    const response = { text: () => new Promise<string>(() => {}) } as unknown as Response;

    await expect(readResponseBody(response, 'text', context)).rejects.toMatchObject({
      code: 'provider_timeout',
    });
    context.dispose();
  });
});

describe('CF Worker caption deadline behavior', () => {
  it('returns a typed 504 when the caption cascade reaches its global deadline', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;

    try {
      const resultPromise = handleTranscript(
        new URL('https://worker.test/api/transcript?videoId=video-id&lang=en'),
        { YTDLP_API_URL: 'https://vps.test' },
        'deadline-trace',
      );
      await vi.advanceTimersByTimeAsync(CAPTION_DEADLINE_MS);
      const result = await resultPromise;
      expect(result.status).toBe(504);
      expect(result.headers.get('X-EchoLearn-Trace-Id')).toBe('deadline-trace');
      expect(await result.json()).toMatchObject({
        error: 'provider_timeout',
        recovery: { canAsr: true, requiresExplicitOptIn: true },
      });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('does not advertise ASR recovery when no ASR route is configured', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;

    try {
      const resultPromise = handleTranscript(
        new URL('https://worker.test/api/transcript?videoId=video-id&lang=en'),
        {},
        'no-asr-trace',
      );
      await vi.advanceTimersByTimeAsync(CAPTION_DEADLINE_MS);
      const result = await resultPromise;
      expect(result.status).toBe(504);
      expect(await result.json()).toEqual({ error: 'provider_timeout', message: 'Caption providers timed out.' });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('routes explicit ASR directly and preserves VPS acquisition blocking', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ error: 'youtube_acquisition_blocked' }), { status: 424 }));
    }) as typeof fetch;

    try {
      const result = await handleTranscript(
        new URL('https://worker.test/api/transcript?videoId=video-id&lang=en&allowAsr=1'),
        { YTDLP_API_URL: 'https://vps.test' },
        'asr-trace',
      );
      expect(result.status).toBe(403);
      expect(result.headers.get('X-EchoLearn-Trace-Id')).toBe('asr-trace');
      expect(await result.json()).toMatchObject({ error: 'youtube_acquisition_blocked' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/api/asr?');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('routes explicit ASR to only the preferred configured branch', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ lines: [{ text: 'audio' }], language: 'en' }), { status: 200 }));
    }) as typeof fetch;

    try {
      const result = await handleTranscript(
        new URL('https://worker.test/api/transcript?videoId=video-id&lang=en&allowAsr=1'),
        { YTDLP_API_URL: 'https://vps.test', GROQ_API_KEY: 'configured' },
        'asr-preferred-trace',
      );
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/api/asr?');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lets a later cheap caption provider succeed after the VPS local cap', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://vps.test/')) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      }
      if (url.includes('youtubei/v1/player')) {
        return Promise.resolve(new Response(JSON.stringify({
          playabilityStatus: { status: 'OK' },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;

    try {
      const resultPromise = handleTranscript(
        new URL('https://worker.test/api/transcript?videoId=video-id&lang=en'),
        { YTDLP_API_URL: 'https://vps.test' },
        'test-trace',
      );
      await new Promise((resolve) => setTimeout(resolve, 5050));
      const result = await resultPromise;

      expect(calls[0]).toContain('https://vps.test/');
      expect(calls.some((url) => url.includes('youtubei/v1/player'))).toBe(true);
      expect(result.status).not.toBe(504);
      expect(result.status).toBe(409);
      expect(CAPTION_DEADLINE_MS).toBe(11000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);
});
