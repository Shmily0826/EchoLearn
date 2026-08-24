import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../resilientFetch';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  it('keeps a slow-but-in-budget request alive until it succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve({ ok: true } as Response), 900);
        expect(init?.signal?.aborted).toBe(false);
      }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const request = fetchWithTimeout('/slow-success', { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(900);

    await expect(request).resolves.toMatchObject({ ok: true });
  });

  it('aborts a request at its configured boundary', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const request = fetchWithTimeout('/timeout', { timeoutMs: 1000 });
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
  });
});
