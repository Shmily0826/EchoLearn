// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaptionRequest } from '../useCaptionRequest';
import { YouTubeTranscriptError } from '../../services/youtubeTranscript';

/** A controllable promise so tests decide exactly when a "request" settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Hook = ReturnType<typeof useCaptionRequest>;

/** renderHook result — always read state through `.current` (it re-renders). */
function setup() {
  return renderHook(() => useCaptionRequest());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCaptionRequest — happy path', () => {
  it('exposes fetching=true while running and applies the latest result', async () => {
    const hook = setup();
    const onSuccess = vi.fn(() => ({ count: 12, source: 'Worker' }) as const);
    const d = deferred<{ lines: string[] }>();

    act(() => {
      hook.result.current.run(() => d.promise, { onSuccess });
    });
    expect(hook.result.current.fetching).toBe(true);

    await act(async () => {
      d.resolve({ lines: ['a'] });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(hook.result.current.fetching).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.fetchToast).toEqual({ count: 12, seconds: 0, source: 'Worker' });
  });

  it('fires no toast when onSuccess reports nothing (empty transcript)', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise, { onSuccess: () => undefined });
    });
    await act(async () => {
      d.resolve({});
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.fetchToast).toBeNull();
    expect(hook.result.current.fetching).toBe(false);
  });

  it('maps a failure to err.message by default', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise);
    });
    await act(async () => {
      d.reject(new Error('No captions available'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.error).toBe('No captions available');
    expect(hook.result.current.fetching).toBe(false);
    expect(hook.result.current.fetchToast).toBeNull();
  });

  it('honours a custom errorMessage mapping', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise, { errorMessage: () => 'Failed to load this part' });
    });
    await act(async () => {
      d.reject(new Error('anything'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.error).toBe('Failed to load this part');
  });

  it('preserves structured recovery metadata on the current failure', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise);
    });
    await act(async () => {
      d.reject(new YouTubeTranscriptError(
        'provider_timeout',
        'Caption providers timed out.',
        { canAsr: true, requiresExplicitOptIn: true },
      ));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.errorCode).toBe('provider_timeout');
    expect(hook.result.current.recovery).toEqual({ canAsr: true, requiresExplicitOptIn: true });
  });
});

describe('useCaptionRequest — race protection (latest request wins)', () => {
  it('discards the OLDER result when it resolves after the newer one', async () => {
    const hook = setup();
    const onSuccessA = vi.fn();
    const onSuccessB = vi.fn(() => ({ count: 3 }));
    const a = deferred<string>();
    const b = deferred<string>();

    act(() => {
      hook.result.current.run(() => a.promise, { onSuccess: onSuccessA });
    });
    act(() => {
      hook.result.current.run(() => b.promise, { onSuccess: onSuccessB });
    });

    // B resolves first and is accepted…
    await act(async () => {
      b.resolve('B');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onSuccessB).toHaveBeenCalledOnce();

    // …then A resolves late and must be discarded entirely.
    await act(async () => {
      a.resolve('A');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onSuccessA).not.toHaveBeenCalled();
    // B's toast must survive A's late arrival.
    expect(hook.result.current.fetchToast?.count).toBe(3);
    expect(hook.result.current.fetching).toBe(false);
  });

  it('a stale success cannot clear the newer request\'s error', async () => {
    const hook = setup();
    const a = deferred<string>();
    const b = deferred<string>();

    act(() => {
      hook.result.current.run(() => a.promise, { onSuccess: () => ({ count: 99 }) });
    });
    act(() => {
      hook.result.current.run(() => b.promise);
    });

    await act(async () => {
      b.reject(new Error('newer failed'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.error).toBe('newer failed');

    await act(async () => {
      a.resolve('older success');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.error).toBe('newer failed'); // unchanged by stale success
    expect(hook.result.current.fetchToast).toBeNull();
  });

  it('a stale failure cannot overwrite the newer request\'s success', async () => {
    const hook = setup();
    const a = deferred<string>();
    const b = deferred<string>();

    act(() => {
      hook.result.current.run(() => a.promise);
    });
    act(() => {
      hook.result.current.run(() => b.promise, { onSuccess: () => ({ count: 7 }) });
    });

    await act(async () => {
      b.resolve('newer success');
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      a.reject(new Error('older failure'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.fetchToast?.count).toBe(7);
  });

  it('invalidate() makes an in-flight request stale (clear-session path)', async () => {
    const hook = setup();
    const onSuccess = vi.fn();
    const d = deferred<string>();

    act(() => {
      hook.result.current.run(() => d.promise, { onSuccess });
    });
    act(() => {
      hook.result.current.invalidate();
    });
    await act(async () => {
      d.resolve('late');
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(hook.result.current.fetchToast).toBeNull();
  });
});

describe('useCaptionRequest — begin/fail manual flow (short-link resolution)', () => {
  it('begin() marks a request current; fail() surfaces the message and stops fetching', async () => {
    const hook = setup();

    let handle: ReturnType<Hook['begin']> | undefined;
    act(() => {
      handle = hook.result.current.begin();
    });
    expect(hook.result.current.fetching).toBe(true);
    expect(hook.result.current.error).toBeNull();

    act(() => {
      hook.result.current.fail('B站短链解析失败', handle);
    });
    expect(hook.result.current.error).toBe('B站短链解析失败');
    expect(hook.result.current.fetching).toBe(false);
  });

  it('isCurrent() turns false once a newer request begins', () => {
    const hook = setup();
    let first!: ReturnType<Hook['begin']>;
    let second!: ReturnType<Hook['begin']>;
    act(() => {
      first = hook.result.current.begin();
    });
    expect(hook.result.current.isCurrent(first)).toBe(true);
    act(() => {
      second = hook.result.current.begin();
    });
    expect(hook.result.current.isCurrent(first)).toBe(false);
    expect(hook.result.current.isCurrent(second)).toBe(true);
  });

  it('run(begin:false) attaches to the open request and keeps its timer', async () => {
    const hook = setup();
    const d = deferred<string>();
    let handle: ReturnType<Hook['begin']> | undefined;

    act(() => {
      handle = hook.result.current.begin();
    });
    // The awaited resolution phase "takes" 5 seconds of wall time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    act(() => {
      hook.result.current.run(() => d.promise, { begin: false, onSuccess: () => ({ count: 1 }) });
    });
    await act(async () => {
      d.resolve('lines');
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.fetching).toBe(false);
    // begin() ran once, the attached run did not bump the generation: a
    // handle captured before run(begin:false) is still current.
    expect(hook.result.current.isCurrent(handle!)).toBe(true);
  });
});

  it('begin() clears a stale success toast before loading a new video', async () => {
    const hook = setup();

    // First request succeeds → success toast stays visible.
    act(() => {
      hook.result.current.run(() => Promise.resolve('ok'), { onSuccess: () => ({ count: 5 }) });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.fetchToast?.count).toBe(5);

    // A new load must wipe the old toast so it cannot sit beside the loading UI.
    act(() => {
      hook.result.current.begin();
    });
    expect(hook.result.current.fetching).toBe(true);
    expect(hook.result.current.fetchToast).toBeNull();
  });

describe('useCaptionRequest — error and toast controls', () => {
  it('clearError and clearFetchToast reset their respective state', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise);
    });
    await act(async () => {
      d.reject(new Error('boom'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.error).toBe('boom');
    act(() => {
      hook.result.current.clearError();
    });
    expect(hook.result.current.error).toBeNull();

    act(() => {
      hook.result.current.run(() => Promise.resolve('ok'), { onSuccess: () => ({ count: 2 }) });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.fetchToast).not.toBeNull();
    act(() => {
      hook.result.current.clearFetchToast();
    });
    expect(hook.result.current.fetchToast).toBeNull();
  });
});

describe('useCaptionRequest — elapsed ticker', () => {
  it('ticks elapsed seconds while fetching and resets when the request ends', async () => {
    const hook = setup();
    const d = deferred<unknown>();

    act(() => {
      hook.result.current.run(() => d.promise);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(hook.result.current.elapsed).toBe(3);

    await act(async () => {
      d.resolve('done');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.elapsed).toBe(0);
    expect(hook.result.current.fetching).toBe(false);
  });
});

// ── Regression: first-load race (Bug 1) ─────────────────────────────────────
// On the first load of an uncached video the backend may take 1–3 minutes to
// generate captions. The UI must stay in a consistent state: it must not show a
// stale "loaded" toast beside the loading spinner, and a late failure from an
// outdated request must never overwrite a successful result.

describe('useCaptionRequest — first-load race (regression)', () => {
  it('keeps loading state consistent while a slow request resolves (no stale toast)', async () => {
    const hook = setup();
    const d = deferred<{ lines: string[] }>();

    act(() => {
      hook.result.current.run(() => d.promise, { onSuccess: () => ({ count: 744 }) });
    });
    // Still pending → loading true, no toast yet.
    expect(hook.result.current.fetching).toBe(true);
    expect(hook.result.current.fetchToast).toBeNull();
    expect(hook.result.current.error).toBeNull();

    await act(async () => {
      d.resolve({ lines: ['a', 'b'] });
      await vi.advanceTimersByTimeAsync(0);
    });

    // Resolved: loading cleared, success toast present, no error.
    expect(hook.result.current.fetching).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.fetchToast?.count).toBe(744);
  });

  it('does not let a slow stale request overwrite a newer success', async () => {
    const hook = setup();
    const slow = deferred<{ lines: string[] }>();
    const fast = deferred<{ lines: string[] }>();

    // Req A starts and is slow/never resolves yet.
    act(() => {
      hook.result.current.run(() => slow.promise, { onSuccess: () => ({ count: 1 }) });
    });

    // begin() is called for a new load (e.g. user re-triggers / next step),
    // capturing a fresh id; the old request A is now stale.
    act(() => {
      hook.result.current.begin();
    });
    expect(hook.result.current.fetching).toBe(true);
    expect(hook.result.current.fetchToast).toBeNull();

    // Req B (the "current" one) resolves successfully.
    act(() => {
      hook.result.current.run(() => fast.promise, { onSuccess: () => ({ count: 99 }) });
    });
    await act(async () => {
      fast.resolve({ lines: ['x'] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.fetchToast?.count).toBe(99);
    expect(hook.result.current.error).toBeNull();

    // Req A finally rejects (late). It is stale → must NOT overwrite success.
    await act(async () => {
      slow.reject(new Error('timeout'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.fetchToast?.count).toBe(99);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.fetching).toBe(false);
  });
});
