// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaptionRequest } from '../useCaptionRequest';

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
    expect(hook.result.current.fetchToast).toEqual({ count: 12, time: '0秒', source: 'Worker' });
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
