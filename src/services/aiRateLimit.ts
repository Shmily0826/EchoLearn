/**
 * Client-side AI rate limiter — shared across analyze + translation + word
 * enrichment calls (DeepSeek on the server). Prevents accidental or intentional
 * abuse from rapid repeated clicks.
 * Server-side /api/ai also enforces its own per-IP limit as a backstop.
 *
 * Two sliding windows run in parallel:
 *  - per-minute: 10 calls / 60s   (short-burst protection)
 *  - per-hour:   100 calls / 1h   (overall daily protection)
 * A call is allowed only if it fits BOTH windows.
 */

const MINUTE_MS = 60_000;
const MAX_PER_MINUTE = 10;
const HOUR_MS = 3_600_000;
const MAX_PER_HOUR = 100;

const minuteTimestamps: number[] = [];
const hourTimestamps: number[] = [];

/** Human-readable limits (for UI messaging if needed). */
export const AI_RATE_LIMIT = { perMinute: MAX_PER_MINUTE, perHour: MAX_PER_HOUR };

function prune(now: number): void {
  while (minuteTimestamps.length > 0 && minuteTimestamps[0] <= now - MINUTE_MS) minuteTimestamps.shift();
  while (hourTimestamps.length > 0 && hourTimestamps[0] <= now - HOUR_MS) hourTimestamps.shift();
}

/**
 * Check whether an AI call is allowed under the rate limit.
 * Returns true if allowed (and records the call), false if rate-limited.
 */
export function checkAiRateLimit(): boolean {
  const now = Date.now();
  prune(now);
  if (minuteTimestamps.length >= MAX_PER_MINUTE) return false;
  if (hourTimestamps.length >= MAX_PER_HOUR) return false;
  minuteTimestamps.push(now);
  hourTimestamps.push(now);
  return true;
}

/** How many seconds until the next call is allowed (0 if not limited). */
export function rateLimitWaitSeconds(): number {
  const now = Date.now();
  let wait = 0;
  if (minuteTimestamps.length >= MAX_PER_MINUTE) {
    const oldest = minuteTimestamps[0];
    wait = Math.max(wait, Math.ceil((oldest + MINUTE_MS - now) / 1000));
  }
  if (hourTimestamps.length >= MAX_PER_HOUR) {
    const oldest = hourTimestamps[0];
    wait = Math.max(wait, Math.ceil((oldest + HOUR_MS - now) / 1000));
  }
  return wait;
}
