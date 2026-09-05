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

function makeReq(videoId = 'dQw4w9WgXcQ', allowAsr = false, lang: string | null = 'en') {
  return {
    method: 'GET',
    query: { videoId, ...(lang ? { lang } : {}), ...(allowAsr ? { allowAsr: '1' } : {}) },
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
  vi.stubEnv('SUPADATA_API_KEY', '');
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
    await handler(makeReq(undefined, true), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).source).toBe('vps');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://yt-api.echo-learn.uk/api/transcript?');
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('test-vps-key');
    expect((init?.headers as Record<string, string>)['X-EchoLearn-Trace-Id']).toMatch(/^trace-|^[0-9a-f-]{36}$/i);
    expect(res.headers['x-echolearn-trace-id']).toMatch(/^trace-|^[0-9a-f-]{36}$/i);
    expect(res.body).not.toContain('test-vps-key');
    expect(YoutubeTranscript.fetchTranscript).not.toHaveBeenCalled();
  });

  it('keeps the trace id available when VPS fails and the npm fallback succeeds', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'traceable fallback', offset: 0, duration: 1, lang: 'en' },
    ]);
    const res = makeRes();
    await handler(makeReq(undefined, true), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-echolearn-trace-id']).toMatch(/^trace-|^[0-9a-f-]{36}$/i);
  });

  it('falls back to youtube-transcript after a VPS non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'from npm', offset: 0, duration: 2, lang: 'en' },
    ]);
    const res = makeRes();
    await handler(makeReq(undefined, true), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lines[0].text).toBe('from npm');
    expect(JSON.parse(res.body).source).toBe('npm');
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
    await handler(makeReq(undefined, true), res);
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

  it('keeps the existing npm chain when Supadata has no server key', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'npm only', offset: 0, duration: 1, lang: 'en' },
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('calls Supadata once before npm with native-only parameters and normalized cues', async () => {
    const supadataKey = 'test-supadata-key';
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', supadataKey);
    fetchMock.mockResolvedValueOnce(response({
      content: [
        { text: 'second cue', offset: 2_000, duration: 1_000, lang: 'en' },
        { text: ' first cue ', offset: 0, duration: 1_500, lang: 'en' },
      ],
      lang: 'en',
      availableLangs: ['en'],
    }));
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const res = makeRes();
      await handler(makeReq('video-id', true), res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({
        source: 'supadata',
        language: 'en',
        diagnostics: { supadata: { attempted: true, outcome: 'success' } },
        lines: [
          { id: 'supadata_1', start: 0, end: 1.5, text: 'first cue' },
          { id: 'supadata_2', start: 2, end: 3, text: 'second cue' },
        ],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.origin + parsedUrl.pathname).toBe('https://api.supadata.ai/v1/transcript');
      expect(parsedUrl.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=video-id');
      expect(parsedUrl.searchParams.get('mode')).toBe('native');
      expect(parsedUrl.searchParams.get('text')).toBe('false');
      expect(parsedUrl.searchParams.get('lang')).toBe('en');
      expect(parsedUrl.searchParams.has('generate')).toBe(false);
      expect(String(url)).not.toContain('allowAsr');
      expect(String(url)).not.toContain('/api/asr');
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe(supadataKey);
      expect(res.body).not.toContain(supadataKey);
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain(supadataKey);
      expect(YoutubeTranscript.fetchTranscript).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('omits Supadata lang when no requested language is known', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockResolvedValueOnce(response({
      content: [{ text: 'caption', offset: 0, duration: 1_000 }],
      lang: 'fr',
    }));

    const res = makeRes();
    await handler(makeReq('video-id', false, null), res);

    expect(res.statusCode).toBe(200);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has('lang')).toBe(false);
    expect(JSON.parse(res.body)).toMatchObject({ language: 'fr', source: 'supadata' });
  });

  it.each([
    ['empty content', { content: [], lang: 'en' }],
    ['malformed cue', { content: [{ text: 'caption', offset: '0', duration: 1_000 }], lang: 'en' }],
  ])('rejects Supadata %s and continues to npm', async (_label, payload) => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockResolvedValueOnce(response(payload));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'npm recovery', offset: 0, duration: 1, lang: 'en' },
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lines[0].text).toBe('npm recovery');
    expect(JSON.parse(res.body)).toMatchObject({
      source: 'npm',
      diagnostics: { supadata: { attempted: true, outcome: 'failure' } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('continues after Supadata native-unavailable 206 and preserves no-caption semantics', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockResolvedValueOnce(response({ error: 'native transcript unavailable' }, 206));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('no transcripts available'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('captions_not_found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(YoutubeTranscript.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body).diagnostics).toEqual({
      supadata: { attempted: true, outcome: 'unavailable' },
    });
  });

  it('preserves a Supadata 206 attempt when npm later supplies captions', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockResolvedValueOnce(response({ error: 'native transcript unavailable' }, 206));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'npm after native unavailable', offset: 0, duration: 1, lang: 'en' },
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      source: 'npm',
      diagnostics: { supadata: { attempted: true, outcome: 'unavailable' } },
    });
  });

  it.each([
    [401, 'provider_failure', 500],
    [403, 'provider_failure', 500],
    [429, 'provider_failure', 500],
    [500, 'provider_failure', 500],
    [503, 'provider_failure', 500],
    [504, 'provider_timeout', 504],
  ])('types Supadata HTTP %s as %s', async (status, expectedCode, expectedStatus) => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockResolvedValueOnce(response({ error: 'provider unavailable' }, status));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('no transcripts available'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(expectedStatus);
    expect(JSON.parse(res.body).code).toBe(expectedCode);
  });

  it('types Supadata network failure without relabeling it as no captions', async () => {
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('no transcripts available'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe('provider_failure');
  });

  it.each([
    ['provider timeout', { detail: { code: 'provider_timeout' } }, 504, 'provider_timeout'],
    ['acquisition blocked', { detail: { code: 'youtube_acquisition_blocked' } }, 424, 'youtube_acquisition_blocked'],
  ])('does not let Supadata 206 overwrite an earlier %s', async (_label, vpsBody, vpsStatus, expectedCode) => {
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock
      .mockResolvedValueOnce(response(vpsBody, vpsStatus))
      .mockResolvedValueOnce(response({ error: 'native unavailable' }, 206));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('Transcript is disabled on this video'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(JSON.parse(res.body).code).toBe(expectedCode);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('admits the measured 14.352-second native positive within the bounded deadline', async () => {
    vi.useFakeTimers();
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(response({
        content: [{ text: 'delayed native caption', offset: 0, duration: 1_000 }],
        lang: 'en',
      })), 14_500);
    }));

    try {
      const res = makeRes();
      const pending = handler(makeReq(), res);
      await vi.advanceTimersByTimeAsync(14_500);
      await pending;

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).lines[0].text).toBe('delayed native caption');
      expect(YoutubeTranscript.fetchTranscript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a later npm attempt to the time remaining after Supadata timeout', async () => {
    vi.useFakeTimers();
    vi.stubEnv('YTDLP_API_KEY', '');
    vi.stubEnv('SUPADATA_API_KEY', 'test-supadata-key');
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementationOnce((_url, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.mocked(YoutubeTranscript.fetchTranscript).mockImplementationOnce((_videoId, options) =>
      options.fetch('https://youtube.test/captions').then(() => []),
    );
    fetchMock.mockImplementationOnce((_url, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    try {
      const res = makeRes();
      const pending = handler(makeReq(), res);
      await vi.advanceTimersByTimeAsync(18_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;

      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(res.statusCode).toBe(504);
      expect(JSON.parse(res.body).code).toBe('provider_timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Vercel VPS caption fallback available without an ASR opt-in', async () => {
    fetchMock.mockResolvedValueOnce(response({ lines: [{ text: 'caption-only' }], language: 'en' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).lines[0].text).toBe('caption-only');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/transcript?');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('allowAsr');
  });

  it('does not relabel a VPS timeout followed by disabled npm as transcript_disabled', async () => {
    const error = new Error('upstream timeout');
    error.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(error);
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled on this video'),
    );
    const res = makeRes();
    await handler(makeReq(undefined, true), res);
    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.body).code).toBe('provider_timeout');
  });

  it('preserves a structured VPS timeout and never advertises unsupported ASR recovery', async () => {
    fetchMock.mockResolvedValueOnce(response({
      detail: { code: 'provider_timeout', message: 'upstream detail' },
      recovery: { canAsr: true, requiresExplicitOptIn: true },
    }, 502));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('Transcript is disabled on this video'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.body)).toEqual({
      error: 'provider_timeout',
      code: 'provider_timeout',
      message: 'Transcript provider timed out.',
      diagnostics: { supadata: { attempted: false, outcome: 'not_attempted' } },
    });
  });

  it('does not relabel a generic VPS failure as transcript_disabled', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'upstream unavailable' }, 502));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('Transcript is disabled on this video'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: 'provider_failure',
      code: 'provider_failure',
      message: 'Transcript provider failed.',
      diagnostics: { supadata: { attempted: false, outcome: 'not_attempted' } },
    });
  });

  it('returns a typed provider timeout when the final npm caption fallback exceeds its budget', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response({ error: 'upstream unavailable' }, 502));
    let fallbackSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url, init) => {
      fallbackSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        fallbackSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.mocked(YoutubeTranscript.fetchTranscript).mockImplementationOnce(
      (_videoId, options) => options.fetch('https://youtube.test/captions'),
    );

    try {
      const res = makeRes();
      const pending = handler(makeReq(), res);
      await vi.advanceTimersByTimeAsync(6_500);
      await pending;

      expect(res.statusCode).toBe(504);
      expect(fallbackSignal?.aborted).toBe(true);
      expect(JSON.parse(res.body)).toEqual({
        error: 'provider_timeout',
        code: 'provider_timeout',
        message: 'Transcript provider timed out.',
        diagnostics: { supadata: { attempted: false, outcome: 'not_attempted' } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a delayed but usable npm caption fallback within the Vercel budget', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response({ error: 'upstream unavailable' }, 502));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockImplementationOnce(
      () => new Promise((resolve) => {
        setTimeout(() => resolve([
          { text: 'delayed caption', offset: 0, duration: 1, lang: 'en' },
        ]), 3_500);
      }),
    );

    try {
      const res = makeRes();
      const pending = handler(makeReq(), res);
      await vi.advanceTimersByTimeAsync(3_500);
      await pending;

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).lines[0].text).toBe('delayed caption');
    } finally {
      vi.useRealTimers();
    }
  });

  it('abandons the duplicate VPS attempt after 1s and preserves the longer npm budget', async () => {
    vi.useFakeTimers();
    let vpsSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url, init) => {
      vpsSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        vpsSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.mocked(YoutubeTranscript.fetchTranscript).mockImplementationOnce(
      () => new Promise((resolve) => {
        setTimeout(() => resolve([
          { text: 'independent fallback', offset: 0, duration: 1, lang: 'en' },
        ]), 3_500);
      }),
    );

    try {
      const res = makeRes();
      const pending = handler(makeReq(), res);
      await vi.advanceTimersByTimeAsync(999);
      expect(vpsSignal?.aborted).toBe(false);
      expect(YoutubeTranscript.fetchTranscript).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(vpsSignal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(3_500);
      await pending;

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).lines[0].text).toBe('independent fallback');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves VPS acquisition blocking and ASR-required compatibility without recovery metadata', async () => {
    fetchMock.mockResolvedValueOnce(response({
      detail: { code: 'youtube_acquisition_blocked' },
    }, 424));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('npm fallback failed'));

    const blocked = makeRes();
    await handler(makeReq(), blocked);
    expect(blocked.statusCode).toBe(403);
    expect(JSON.parse(blocked.body)).toEqual({
      error: 'youtube_acquisition_blocked',
      code: 'youtube_acquisition_blocked',
      message: 'YouTube media acquisition is currently unavailable.',
      diagnostics: { supadata: { attempted: false, outcome: 'not_attempted' } },
    });

    fetchMock.mockResolvedValueOnce(response({
      code: 'asr_required',
      recovery: { canAsr: true, requiresExplicitOptIn: true },
    }, 409));
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('npm fallback failed'));

    const asrRequired = makeRes();
    await handler(makeReq(), asrRequired);
    expect(asrRequired.statusCode).toBe(409);
    expect(JSON.parse(asrRequired.body)).toEqual({
      error: 'asr_required',
      code: 'asr_required',
      message: 'Explicit ASR opt-in is required for transcript recovery.',
      diagnostics: { supadata: { attempted: false, outcome: 'not_attempted' } },
    });
  });
});
