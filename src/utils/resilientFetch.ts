/**
 * Resilient fetch helpers.
 *
 * The Cloudflare Worker is the preferred path (it has fallbacks and CORS is
 * pre-configured), but it can intermittently hang or fail from some networks.
 * These helpers add a client-side timeout and a direct VPS fallback so the app
 * keeps working when the Worker is flaky.
 */

export const VPS_API_URL = 'https://yt-api.echo-learn.uk';

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

/**
 * Try a CF Worker endpoint first; if it fails or times out, fall back to the
 * same endpoint on the VPS directly. The VPS has permissive CORS, so this
 * works from the browser as a last resort.
 *
 * @param workerUrl  Full URL on the CF Worker.
 * @param vpsPath    Path on the VPS (e.g. "/api/transcript").
 * @param timeoutMs  Per-attempt timeout (default 18s for Worker, 25s for VPS).
 */
export async function fetchWorkerThenVps(
  workerUrl: string,
  vpsPath: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 18000, ...rest } = options;

  // Try Worker first.
  try {
    const res = await fetchWithTimeout(workerUrl, { ...rest, timeoutMs });
    if (res.ok) return res;
    // If Worker returns an error body, we still return it; the caller decides.
    return res;
  } catch (err) {
    // Worker failed/timed out — fall through to direct VPS call.
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.warn(
      '[EchoLearn] Worker request failed, falling back to VPS:',
      isAbort ? 'timeout' : err instanceof Error ? err.message : err,
    );
  }

  // Build VPS URL: preserve query string from workerUrl.
  const worker = new URL(workerUrl);
  const vpsUrl = `${VPS_API_URL}${vpsPath}${worker.search}`;

  const vpsRes = await fetchWithTimeout(vpsUrl, { ...rest, timeoutMs: 25000 });
  return vpsRes;
}
