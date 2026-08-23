import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: { fetchTranscript: vi.fn() },
}));

import { YoutubeTranscript } from 'youtube-transcript';
import handler from '../../../api/transcript';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
  end(): void;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0, headers: {}, body: '',
    setHeader(name, value) { res.headers[name.toLowerCase()] = String(value); },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = JSON.stringify(payload); return res; },
    end() {},
  };
  return res;
}

function makeReq(videoId = 'dQw4w9WgXcQ') {
  return {
    method: 'GET',
    query: { videoId, lang: 'en' },
    headers: { origin: 'https://echo-learn.uk', 'x-forwarded-for': Math.random().toString() },
  };
}

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  vi.stubEnv('YTDLP_API_KEY', 'test-vps-key');
  vi.mocked(YoutubeTranscript.fetchTranscript).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('api/transcript server fallback', () => {
  it('uses the authenticated VPS first and keeps the key server-side', async () => {
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'from VPS' }], language: 'en' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).source).toBe('vps');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://yt-api.echo-learn.uk/api/transcript?');
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('test-vps-key');
    expect(res.body).not.toContain('test-vps-key');
    expect(YoutubeTranscript.fetchTranscript).not.toHaveBeenCalled();
  });

  it('falls back to youtube-transcript after a VPS non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'from npm', offset: 0, duration: 2, lang: 'en' },
    ]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lines[0].text).toBe('from npm');
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('falls back after a VPS timeout failure', async () => {
    const error = new Error('upstream timeout');
    error.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(error);
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'fallback', offset: 1, duration: 2, lang: 'en' },
    ]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lines[0].text).toBe('fallback');
  });

  it('skips VPS when no server key is configured', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'npm only', offset: 0, duration: 1, lang: 'en' },
    ]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
