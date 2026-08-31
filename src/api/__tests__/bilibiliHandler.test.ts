import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../../api/bilibili';

const VPS_API_URL = 'https://yt-api.echo-learn.uk';

// ── Minimal Vercel-style req/res doubles ────────────────────────

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
  send(payload: string | Uint8Array): MockRes;
  end(): void;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = String(value);
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = JSON.stringify(payload);
      return res;
    },
    send(payload) {
      res.body = typeof payload === 'string' ? payload : '[binary]';
      return res;
    },
    end() {
      /* no-op */
    },
  };
  return res;
}

interface MockReq {
  method: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
}

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: 'GET',
    query: {},
    headers: {},
    ...overrides,
  };
}

function upstreamResponse(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = opts.status ?? 200;
  const headers = new Map(Object.entries(opts.headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  vi.stubEnv('YTDLP_API_KEY', 'test-vps-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── CORS / method gate ─────────────────────────────────────────

describe('api/bilibili handler — CORS and method', () => {
  it('answers OPTIONS with 204 and CORS headers for an allowed origin', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: { origin: 'https://echo-learn.uk' } }), res);

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://echo-learn.uk');
    expect(res.headers['access-control-allow-headers']).toContain('Range');
  });

  it('does not set Access-Control-Allow-Origin for unknown origins', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), res);

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res);

    expect(res.statusCode).toBe(405);
  });
});

// ── Input validation ───────────────────────────────────────────

describe('api/bilibili handler — input validation', () => {
  it('rejects info requests without a url (400)', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { info: '1' } }), res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects non-Bilibili hosts to prevent SSRF through the proxy (400)', async () => {
    const res = makeRes();
    await handler(
      makeReq({ query: { info: '1', url: 'https://internal-service.local/secret' } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed urls (400)', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { info: '1', url: 'not a url' } }), res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects transcript requests with an invalid bvid (400)', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { bvid: 'NOT_A_BVID' } }), res);

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid part number (400)', async () => {
    const res = makeRes();
    await handler(makeReq({ query: { bvid: 'BV1xx411c7mD', p: 'abc' } }), res);

    expect(res.statusCode).toBe(400);
  });
});

// ── Configuration and upstream failures ────────────────────────

describe('api/bilibili handler — configuration and upstream failures', () => {
  it('returns 503 when YTDLP_API_KEY is not configured', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    const res = makeRes();
    await handler(makeReq({ query: { info: '1', url: 'https://b23.tv/hbSyQzx' } }), res);

    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 with a timeout message when the upstream aborts', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortErr);

    const res = makeRes();
    await handler(makeReq({ query: { info: '1', url: 'https://b23.tv/hbSyQzx' } }), res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('timed out');
  });

  it('returns 502 when the upstream is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    const res = makeRes();
    await handler(makeReq({ query: { info: '1', url: 'https://b23.tv/hbSyQzx' } }), res);

    expect(res.statusCode).toBe(502);
  });
});

// ── Forwarding behavior ────────────────────────────────────────

describe('api/bilibili handler — upstream forwarding', () => {
  it('forwards info requests to the VPS with the server-side API key', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse(JSON.stringify({ title: 'T', bvid: 'BV1xx411c7mD' })),
    );

    const res = makeRes();
    await handler(makeReq({ query: { info: '1', url: 'https://b23.tv/hbSyQzx' } }), res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(`${VPS_API_URL}/api/info?url=${encodeURIComponent('https://b23.tv/hbSyQzx')}`);
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('test-vps-key');
    // The API key must never leak into the client-visible response.
    expect(res.body).not.toContain('test-vps-key');
  });

  it('propagates the upstream status code and body verbatim', async () => {
    fetchMock.mockResolvedValueOnce(upstreamResponse('{"error":"no subtitles"}', { status: 404 }));

    const res = makeRes();
    await handler(makeReq({ query: { bvid: 'BV1xx411c7mD' } }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('no subtitles');
  });

  it('forwards transcript requests through the VPS caption route with a canonical URL and part', async () => {
    fetchMock.mockResolvedValueOnce(upstreamResponse('{"lines":[]}'));

    const res = makeRes();
    await handler(makeReq({ query: { bvid: 'BV1xx411c7mD', lang: 'en', p: '2' } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const called = String(fetchMock.mock.calls[0][0]);
    expect(called).toContain('/api/transcript?url=');
    expect(called).not.toContain('/api/bilibili');
    expect(decodeURIComponent(called)).toContain('https://www.bilibili.com/video/BV1xx411c7mD?p=2');
    expect(called).toContain('lang=en');
    expect(res.statusCode).toBe(200);
  });

  it('forwards the Range header for audio and passes media headers back', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse('mp3-bytes', {
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': '9',
          'content-range': 'bytes 0-8/9',
        },
      }),
    );

    const res = makeRes();
    await handler(
      makeReq({ query: { audio: '1', url: 'https://www.bilibili.com/video/BV1xx411c7mD' }, headers: { range: 'bytes=0-8' } }),
      res,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/api/audio?url=');
    expect((init?.headers as Record<string, string>).Range).toBe('bytes=0-8');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['content-range']).toBe('bytes 0-8/9');
    expect(res.body).toBe('[binary]');
  });
});
