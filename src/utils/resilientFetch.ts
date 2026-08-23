/**
 * Resilient fetch helpers.
 *
 * The Cloudflare Worker is the preferred path (it has fallbacks and CORS is
 * pre-configured), but it can intermittently hang or fail from some networks.
 * These helpers provide bounded requests for the client-side resilience chain.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Fetch with a client-side timeout.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
