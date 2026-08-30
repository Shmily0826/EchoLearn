import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YoutubeTranscript } from 'youtube-transcript';
import {
  fetchYouTubeServerTranscript,
  fetchYouTubeTranscript,
  CF_WORKER_URL,
  YOUTUBE_ACQUISITION_BLOCKED,
  YouTubeAcquisitionBlockedError,
} from '../youtubeTranscript';

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: vi.fn() },
}));

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('fetchYouTubeServerTranscript', () => {
  it('returns Worker captions without attempting direct VPS access', async () => {
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'worker' }], language: 'en' }));
    const result = await fetchYouTubeServerTranscript('video-id', 'en');
    expect(result?.lines[0].text).toBe('worker');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(CF_WORKER_URL);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('yt-api.echo-learn.uk');
  });

  it.each([
    ['network failure', () => fetchMock.mockRejectedValueOnce(new Error('network down'))],
    ['Worker 500', () => fetchMock.mockResolvedValueOnce(response({ error: 'bad gateway' }, 500))],
  ])('falls back to same-origin Vercel after Worker %s', async (_label, setup) => {
    setup();
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'vercel' }], language: 'en' }));
    const result = await fetchYouTubeServerTranscript('video-id', 'en');
    expect(result?.lines[0].text).toBe('vercel');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/transcript?videoId=video-id&lang=en');
    expect(fetchMock.mock.calls.map(([url]) => String(url)).join('\n')).not.toContain('yt-api.echo-learn.uk');
  });

  it('falls through when both server endpoints fail', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: 'worker' }, 502))
      .mockResolvedValueOnce(response({ error: 'vercel' }, 503));
    const failures: string[] = [];
    await expect(fetchYouTubeServerTranscript('video-id', 'en', (detail) => failures.push(detail))).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failures).toEqual([
      'CF Worker HTTP 502: {"error":"worker"}',
      'Vercel server API HTTP 503: {"error":"vercel"}',
    ]);
  });

  it('falls through when a 2xx response has no usable lines', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ lines: [] }))
      .mockResolvedValueOnce(response({ lines: [{ text: 'usable' }] }));
    const result = await fetchYouTubeServerTranscript('video-id', 'en');
    expect(result?.lines[0].text).toBe('usable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls through when a 2xx response is not valid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('unexpected token'); },
        text: async () => '<html>not json</html>',
      } as unknown as Response)
      .mockResolvedValueOnce(response({ lines: [{ text: 'recovered' }] }));

    const result = await fetchYouTubeServerTranscript('video-id', 'en');

    expect(result?.lines[0].text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a bounded YouTube acquisition limitation without trying Vercel', async () => {
    fetchMock.mockResolvedValueOnce(response({
      error: YOUTUBE_ACQUISITION_BLOCKED,
      message: 'safe user-facing message',
    }, 424));

    await expect(fetchYouTubeServerTranscript('video-id', 'en'))
      .rejects.toBeInstanceOf(YouTubeAcquisitionBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchYouTubeTranscript provider order and failure classification', () => {
  it('does not probe the local proxy when no proxy is configured', async () => {
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'worker' }], language: 'en' }));

    const result = await fetchYouTubeTranscript('no-local-proxy', 'en');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(result?.lines[0].text).toBe('worker');
    expect(urls.some((url) => url.includes('proxy.echo-learn.uk'))).toBe(false);
    expect(urls.some((url) => url.startsWith(CF_WORKER_URL))).toBe(true);
  });

  it('attempts an explicit local proxy and falls back to the server path', async () => {
    localStorage.setItem('echolearn_local_proxy_url', 'https://proxy.echo-learn.uk');
    fetchMock
      .mockRejectedValueOnce(new Error('local proxy unavailable'))
      .mockResolvedValueOnce(response({ lines: [{ text: 'server fallback' }], language: 'en' }));

    const result = await fetchYouTubeTranscript('explicit-local-proxy', 'en');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(result?.lines[0].text).toBe('server fallback');
    expect(urls[0]).toContain('https://proxy.echo-learn.uk/api/transcript?');
    expect(urls[1]).toContain(CF_WORKER_URL);
  });

  it('uses official paths after server fallbacks and does not claim captions are absent', async () => {
    const emptyPlayerResponse = {
      playabilityStatus: { status: 'OK' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    };
    const pagePlayerResponse = {
      playabilityStatus: { status: 'OK' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: 'https://www.youtube.com/api/timedtext?v=Zq8e3xX02u8',
            languageCode: 'en',
            kind: 'asr',
          }],
        },
      },
    };
    const pageHtml = `var ytInitialPlayerResponse = ${JSON.stringify(pagePlayerResponse)};`;

    fetchMock
      // Both server endpoints fail, so the official paths are next.
      .mockResolvedValueOnce(response({ error: 'worker unavailable' }, 500))
      .mockResolvedValueOnce(response({ error: 'vercel timed out' }, 504))
      // ANDROID and WEB InnerTube requests return usable player responses but
      // no tracks, so the page strategy is the next official path.
      .mockResolvedValueOnce(response(emptyPlayerResponse))
      .mockResolvedValueOnce(response(emptyPlayerResponse))
      .mockResolvedValueOnce(response(pageHtml))
      // The public player metadata exists, but timed-text returns empty data
      // for every requested format — the reported production failure mode.
      .mockResolvedValueOnce(response(''))
      .mockResolvedValueOnce(response(''))
      .mockResolvedValueOnce(response(''))
      // The npm fallback also fails after the official paths.
      .mockResolvedValueOnce(response({ error: 'npm fallback disabled' }, 500));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled on this video'),
    );

    let failure: Error | undefined;
    try {
      await fetchYouTubeTranscript('Zq8e3xX02u8', 'en');
    } catch (err) {
      failure = err as Error;
    }
    expect(failure?.message).toContain('Unable to fetch captions for this video');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    const pageIndex = urls.findIndex((url) => url.includes('watch'));
    const workerIndex = urls.findIndex((url) => url.startsWith(CF_WORKER_URL));
    expect(pageIndex).toBeGreaterThanOrEqual(0);
    expect(workerIndex).toBeLessThan(pageIndex);
    expect(failure?.message).toContain(
      'Caption metadata may exist even when a provider cannot retrieve',
    );
  });

  it('does not retry Vercel after a Worker provider timeout', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'provider_timeout' }, 504));

    await expect(fetchYouTubeServerTranscript('video-id', 'en'))
      .rejects.toMatchObject({ code: 'provider_timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves structured ASR recovery metadata from a Worker timeout', async () => {
    fetchMock.mockResolvedValueOnce(response({
      error: 'provider_timeout',
      message: 'Caption providers timed out.',
      recovery: { canAsr: true, requiresExplicitOptIn: true },
    }, 504));

    await expect(fetchYouTubeServerTranscript('video-id', 'en'))
      .rejects.toMatchObject({
        code: 'provider_timeout',
        recovery: { canAsr: true, requiresExplicitOptIn: true },
      });
  });

  it('keeps Vercel timeout truth while dropping unsupported Vercel recovery metadata', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: 'Worker unavailable' }, 500))
      .mockResolvedValueOnce(response({
        error: 'provider_timeout',
        code: 'provider_timeout',
        recovery: { canAsr: true, requiresExplicitOptIn: true },
      }, 504));

    let failure: unknown;
    try {
      await fetchYouTubeServerTranscript('video-id', 'en');
    } catch (err) {
      failure = err;
    }

    expect(failure).toMatchObject({ code: 'provider_timeout' });
    expect((failure as { recovery?: unknown }).recovery).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry Vercel after a Worker captions-not-found outcome', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'captions_not_found', code: 'captions_not_found' }, 404));

    await expect(fetchYouTubeServerTranscript('video-id', 'en'))
      .rejects.toMatchObject({ code: 'captions_not_found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps ASR opt-in off by default and propagates asr_required', async () => {
    fetchMock.mockResolvedValueOnce(response({
      error: 'asr_required',
      code: 'asr_required',
      recovery: { canAsr: true, requiresExplicitOptIn: true },
    }, 409));

    await expect(fetchYouTubeServerTranscript('video-id', 'en'))
      .rejects.toMatchObject({
        code: 'asr_required',
        recovery: { canAsr: true, requiresExplicitOptIn: true },
      });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('allowAsr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds the ASR opt-in only for an explicit server request', async () => {
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'asr' }], language: 'en' }));

    await expect(fetchYouTubeServerTranscript('video-id', 'en', undefined, { allowAsr: true }))
      .resolves.toMatchObject({ lines: [{ text: 'asr' }] });
    expect(String(fetchMock.mock.calls[0][0])).toContain('allowAsr=1');
  });

  it('uses the bounded ASR budget and never falls back to Vercel', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });

    const request = fetchYouTubeServerTranscript('video-id', 'en', undefined, { allowAsr: true });
    const rejection = expect(request).rejects.toMatchObject({ code: 'provider_timeout' });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('allowAsr=1');
    vi.useRealTimers();
  });
});
