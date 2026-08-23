// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSleepTimer } from '../useSleepTimer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const onExpire = vi.fn();
  return { onExpire, ...renderHook(({ cb }) => useSleepTimer({ onExpire: cb }), {
    initialProps: { cb: onExpire as () => void },
  }) };
}

describe('useSleepTimer', () => {
  it('starts the countdown at the selected duration', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(2);
    });
    expect(t.result.current.sleepRemaining).toBe(120);
    expect(t.result.current.sleepMinutes).toBe(2);
  });

  it('ticks down once per second', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(1);
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(t.result.current.sleepRemaining).toBe(57);
  });

  it('expires: pauses via onExpire, resets the selector and shows the toast', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(1);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(t.result.current.sleepRemaining).toBe(0);
    expect(t.result.current.sleepMinutes).toBe(0);
    expect(t.onExpire).toHaveBeenCalledOnce();
    expect(t.result.current.sleepToast).toBe(true);
  });

  it('auto-dismisses the expiry toast after 5 seconds', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(1);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(t.result.current.sleepToast).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(t.result.current.sleepToast).toBe(false);
  });

  it('manually dismissing the toast works', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(1);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    act(() => {
      t.result.current.dismissSleepToast();
    });
    expect(t.result.current.sleepToast).toBe(false);
  });

  it('cancelling stops the countdown without expiring', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(5);
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      t.result.current.setSleepMinutes(0);
      t.result.current.setSleepRemaining(0);
    });
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(t.onExpire).not.toHaveBeenCalled();
    expect(t.result.current.sleepRemaining).toBe(0);
  });

  it('re-selecting a duration restarts the countdown from that duration', () => {
    const t = setup();
    act(() => {
      t.result.current.setSleepMinutes(5);
    });
    act(() => {
      vi.advanceTimersByTime(60_000); // 4 minutes left
    });
    act(() => {
      t.result.current.setSleepMinutes(1);
    });
    expect(t.result.current.sleepRemaining).toBe(60);
  });
});
