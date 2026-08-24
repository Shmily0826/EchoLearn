import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchYouTubeServerTranscript, CF_WORKER_URL } from '../youtubeTranscript';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
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
    await expect(fetchYouTubeServerTranscript('video-id', 'en')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
