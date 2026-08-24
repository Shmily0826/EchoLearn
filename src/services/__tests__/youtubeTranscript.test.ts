import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YoutubeTranscript } from 'youtube-transcript';
import {
  fetchYouTubeServerTranscript,
  fetchYouTubeTranscript,
  CF_WORKER_URL,
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
    ['timeout', () => {
      const error = new Error('aborted'); error.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(error);
    }],
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
});

describe('fetchYouTubeTranscript provider order and failure classification', () => {
  it('tries fast official paths before slow server fallbacks and does not claim captions are absent', async () => {
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
      // Local proxy is unavailable.
      .mockRejectedValueOnce(new Error('local proxy unavailable'))
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
      // Both server endpoints fail after the fast official paths.
      .mockResolvedValueOnce(response({ error: 'worker timed out' }, 504))
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
    expect(workerIndex).toBeGreaterThan(pageIndex);
    expect(failure?.message).toContain(
      'Caption metadata may exist even when a provider cannot retrieve',
    );
  });
});
