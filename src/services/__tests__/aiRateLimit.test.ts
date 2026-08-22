import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// The limiter keeps module-level state, so each test re-imports a fresh copy.
type RateLimitModule = typeof import('../aiRateLimit');

async function freshModule(): Promise<RateLimitModule> {
  vi.resetModules();
  return import('../aiRateLimit');
}

const T0 = new Date('2026-01-01T00:00:00Z');

describe('aiRateLimit', () => {
  let mod: RateLimitModule;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mod = await freshModule();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('exposes the documented limits', () => {
    expect(mod.AI_RATE_LIMIT).toEqual({ perMinute: 10, perHour: 100 });
  });

  it('allows the first 10 calls within one minute', () => {
    for (let i = 0; i < 10; i++) {
      expect(mod.checkAiRateLimit()).toBe(true);
    }
  });

  it('blocks the 11th call within the same minute', () => {
    for (let i = 0; i < 10; i++) mod.checkAiRateLimit();
    expect(mod.checkAiRateLimit()).toBe(false);
  });

  it('reports roughly 60s of wait while the minute window is saturated', () => {
    for (let i = 0; i < 10; i++) mod.checkAiRateLimit();
    const wait = mod.rateLimitWaitSeconds();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it('reports 0 wait when not rate-limited', () => {
    expect(mod.rateLimitWaitSeconds()).toBe(0);
    mod.checkAiRateLimit();
    expect(mod.rateLimitWaitSeconds()).toBe(0);
  });

  it('allows calls again after the minute window slides past the oldest entry', () => {
    for (let i = 0; i < 10; i++) mod.checkAiRateLimit();
    expect(mod.checkAiRateLimit()).toBe(false);
    vi.setSystemTime(T0.getTime() + 60_001);
    expect(mod.checkAiRateLimit()).toBe(true);
  });

  it('stays blocked on immediate retry and reports wait from the oldest call', () => {
    for (let i = 0; i < 10; i++) mod.checkAiRateLimit();
    expect(mod.checkAiRateLimit()).toBe(false);
    vi.setSystemTime(T0.getTime() + 500);
    expect(mod.checkAiRateLimit()).toBe(false); // minute window still saturated
    const wait = mod.rateLimitWaitSeconds(); // oldest call was at T0
    expect(wait).toBeGreaterThan(59);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it('enforces the hourly cap independently of the minute cap', () => {
    // 10 batches of 10 calls, 61s apart: every batch passes the minute
    // window (previous batch already pruned) but the hour window fills up.
    for (let batch = 0; batch < 10; batch++) {
      vi.setSystemTime(T0.getTime() + batch * 61_000);
      for (let i = 0; i < 10; i++) {
        expect(mod.checkAiRateLimit()).toBe(true);
      }
    }
    // 100 calls recorded — the 101st is blocked by the hour window even
    // though the minute window has room.
    vi.setSystemTime(T0.getTime() + 10 * 61_000);
    expect(mod.checkAiRateLimit()).toBe(false);
    // Waiting slides the minute window, but the hour cap still blocks.
    vi.setSystemTime(T0.getTime() + 10 * 61_000 + 120_000);
    expect(mod.checkAiRateLimit()).toBe(false);
    // Once the OLDEST call falls out of the hour window, calls resume.
    vi.setSystemTime(T0.getTime() + 3_600_001);
    expect(mod.checkAiRateLimit()).toBe(true);
  });
});
