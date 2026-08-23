import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The real limiter has module-level state shared with the app's AI-analysis
// budget. Mock it so tests are deterministic and never consume the budget.
const rateLimit = vi.hoisted(() => ({ allowed: true, wait: 42 }));
vi.mock('../aiRateLimit', () => ({
  checkAiRateLimit: () => rateLimit.allowed,
  rateLimitWaitSeconds: () => rateLimit.wait,
}));

import {
  translateWord,
  translateWordFast,
  translateWords,
  translateSentences,
} from '../translationService';

function mockResponse(body: string, opts: { status?: number } = {}): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

/** Build a DeepSeek-shaped /api/ai success body wrapping `content`. */
function aiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function callsTo(url: string): number {
  return fetchMock.mock.calls.filter(([u]) => String(u).includes(url)).length;
}

beforeEach(() => {
  fetchMock.mockReset();
  rateLimit.allowed = true;
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── translateWord (DeepSeek layer, cached) ─────────────────────

describe('translateWord', () => {
  it('returns the translation from the DeepSeek proxy and caches it', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('["你好"]')));

    const first = await translateWord('hello');

    expect(first).toBe('你好');
    expect(callsTo('/api/ai')).toBe(1);

    // Second call must be served from the localStorage cache — no new request.
    const second = await translateWord('hello');
    expect(second).toBe('你好');
    expect(callsTo('/api/ai')).toBe(1);
  });

  it('uses a different cache entry when the context differs', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(aiBody('["你好"]')))
      .mockResolvedValueOnce(mockResponse(aiBody('["喂"]')));

    const noCtx = await translateWord('hello');
    const withCtx = await translateWord('hello', 'Hello there, everyone');

    expect(noCtx).toBe('你好');
    expect(withCtx).toBe('喂');
    expect(callsTo('/api/ai')).toBe(2);
  });

  it('unwraps object-wrapped translation arrays', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('{"translations":["世界"]}')));

    expect(await translateWord('world')).toBe('世界');
  });

  it('returns "" on a non-2xx proxy response (never throws)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('rate limited', { status: 429 }));

    expect(await translateWord('hello')).toBe('');
  });

  it('returns "" when the network rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    expect(await translateWord('hello')).toBe('');
  });

  it('returns "" when the model returns empty content', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('')));

    expect(await translateWord('hello')).toBe('');
  });

  it('returns "" when the model content is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('sure! here you go')));

    expect(await translateWord('hello')).toBe('');
  });

  it('does not cache failures — a later success still fetches', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(aiBody(''))) // empty → ''
      .mockResolvedValueOnce(mockResponse(aiBody('["你好"]')));

    expect(await translateWord('hello')).toBe('');
    expect(await translateWord('hello')).toBe('你好');
    expect(callsTo('/api/ai')).toBe(2);
  });
});

// ── translateWordFast (Google gtx layer → DeepSeek fallback) ───

describe('translateWordFast', () => {
  it('uses the keyless /api/translate layer first and caches under its own key', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('{"translation":"苹果"}'));

    expect(await translateWordFast('apple')).toBe('苹果');
    expect(callsTo('/api/translate')).toBe(1);
    expect(callsTo('/api/ai')).toBe(0);

    // Cache hit on the fast layer — no further requests of any kind.
    expect(await translateWordFast('apple')).toBe('苹果');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to DeepSeek when Google returns an empty translation', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse('{"translation":""}'))
      .mockResolvedValueOnce(mockResponse(aiBody('["苹果"]')));

    expect(await translateWordFast('apple')).toBe('苹果');
    expect(callsTo('/api/translate')).toBe(1);
    expect(callsTo('/api/ai')).toBe(1);
  });

  it('falls back to DeepSeek when the Google proxy errors at the network level', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('proxy down'))
      .mockResolvedValueOnce(mockResponse(aiBody('["苹果"]')));

    expect(await translateWordFast('apple')).toBe('苹果');
    expect(callsTo('/api/ai')).toBe(1);
  });

  it('respects noDeepSeekFallback: returns "" without touching /api/ai', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('{"translation":""}'));

    const result = await translateWordFast('apple', 'zh', 'en', { noDeepSeekFallback: true });

    expect(result).toBe('');
    expect(callsTo('/api/ai')).toBe(0);
  });

  it('returns "" for blank input without any request', async () => {
    expect(await translateWordFast('   ')).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the DeepSeek fallback result under the google: namespace', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse('{"translation":""}'))
      .mockResolvedValueOnce(mockResponse(aiBody('["苹果"]')));

    await translateWordFast('apple');
    // Next call hits the cache even though the fast layer never succeeded.
    const again = await translateWordFast('apple');
    expect(again).toBe('苹果');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Batch APIs and rate limiting ───────────────────────────────

describe('translateWords / translateSentences', () => {
  it('maps batch results back to the submitted ids in order', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('["猫","狗"]')));

    const result = await translateWords([
      { id: 'a', word: 'cat' },
      { id: 'b', word: 'dog' },
    ]);

    expect(result).toEqual({ a: '猫', b: '狗' });
  });

  it('drops ids whose slot is missing from a short response array', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(aiBody('["只有第一个"]')));

    const result = await translateWords([
      { id: 'a', word: 'cat' },
      { id: 'b', word: 'dog' },
    ]);

    expect(result).toEqual({ a: '只有第一个' });
  });

  it('returns {} without any request when the shared AI rate limit is hit', async () => {
    rateLimit.allowed = false;

    const result = await translateSentences([{ id: 'x', text: 'Hello world.' }]);

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns {} for an empty batch without any request', async () => {
    expect(await translateWords([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
