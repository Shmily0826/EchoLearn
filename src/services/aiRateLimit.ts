/**
 * Client-side AI rate limiter — shared across analyze + translation calls.
 * Prevents accidental or intentional abuse (e.g., rapid repeated clicks).
 * Server-side /api/ai also enforces its own per-IP limit as a backstop.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_CALLS = 10;

const timestamps: number[] = [];

/**
 * Check whether an AI call is allowed under the rate limit.
 * Returns true if allowed (and records the call), false if rate-limited.
 */
export function checkAiRateLimit(): boolean {
  const now = Date.now();
  // Prune timestamps outside the sliding window
  while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_CALLS) return false;
  timestamps.push(now);
  return true;
}

/** How many seconds until the next call is allowed (0 if not limited). */
export function rateLimitWaitSeconds(): number {
  if (timestamps.length < MAX_CALLS) return 0;
  const oldest = timestamps[0];
  return Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000);
}
