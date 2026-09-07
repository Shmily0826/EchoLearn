/**
 * Synthetic health check for EchoLearn's caption pipeline.
 *
 * Deliberately hits LIVE services (unlike the vitest suite, which always
 * mocks the network). This is monitoring, not testing: it answers "is the
 * Worker / Vercel fallback alive RIGHT NOW" — the class of outage that
 * unit tests can never catch (e.g. the b23.tv short-link incident).
 *
 * Usage:
 *   node scripts/health-check.mjs          # run all checks once
 *   npm run health
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 * Designed to run from GitHub Actions on a schedule (see
 * .github/workflows/uptime-monitor.yml); failures there trigger GitHub's
 * workflow-failure email notifications.
 */

import { fileURLToPath } from 'node:url';
import { createPaidProviderGuard, invokePaidProvider, resolvePaidProviderPolicy } from './paid-provider-guard.mjs';

const APP_BASE = 'https://echo-learn.uk';
const WORKER_BASE = 'https://yt-transcript-proxy.rng2018520.workers.dev';
const TRANSCRIPT_CACHE_HEADER = 'X-EchoLearn-Transcript-Cache';

// A stable Bilibili video with known BV id (used in the repo's own code
// examples) and a stable YouTube video with English captions.
const BILI_FULL_URL = 'https://www.bilibili.com/video/BV1xx411c7mD';
const YOUTUBE_CAPTION_CONTROLS = [
  {
    name: 'Worker serves YouTube captions (control dQ)',
    url: `${WORKER_BASE}/api/transcript?videoId=dQw4w9WgXcQ&lang=en`,
    timeoutMs: 45000,
    retries: 0,
    transcript: true,
    paidProvider: true,
    validate: validateCaptionResponse,
  },
  {
    name: 'Worker serves YouTube captions (control iG9)',
    url: `${WORKER_BASE}/api/transcript?videoId=iG9CE55wbtY&lang=en`,
    timeoutMs: 45000,
    retries: 0,
    transcript: true,
    validate: validateCaptionResponse,
  },
  {
    name: 'Vercel YouTube caption fallback (control M7)',
    url: `${APP_BASE}/api/transcript?videoId=M7lc1UVf-VE&lang=en`,
    timeoutMs: 45000,
    retries: 0,
    transcript: true,
    validate: validateCaptionResponse,
  },
];

/**
 * @typedef {Object} Check
 * @property {string} name
 * @property {string} url
 * @property {number} [timeoutMs]   per-attempt timeout (default 30s)
 * @property {number} [retries]     extra attempts after a failure (default 1)
 * @property {boolean} [transcript] whether to report cache/acquisition evidence
 * @property {(bodyText: string) => string | null} [validate]
 *          returns null when OK, or a reason string when the response body
 *          is not what the app depends on.
 */

/**
 * Classify only the bounded cache marker. A missing or invalid marker stays
 * UNKNOWN, so a healthy response is never presented as fresh-acquisition
 * evidence by assumption.
 */
export function classifyTranscriptAcquisition(cacheHeader) {
  const value = typeof cacheHeader === 'string' ? cacheHeader.trim().toUpperCase() : '';
  const cacheState = ['HIT', 'MISS', 'BYPASS'].includes(value) ? value : 'UNKNOWN';
  const acquisitionEvidence = {
    HIT: 'cache_hit',
    MISS: 'cache_miss_before_acquisition',
    BYPASS: 'cache_bypassed',
    UNKNOWN: 'not_observable',
  }[cacheState];
  return { cacheState, acquisitionEvidence };
}

/** @type {Check[]} */
const CHECKS = [
  {
    name: 'Web app is up',
    url: `${APP_BASE}/`,
    timeoutMs: 15000,
    // The SPA shell must serve HTML, not a CDN/proxy error page. Match on
    // the attribute (not exact tag formatting) — build plugins may inject
    // extra attributes onto the root div.
    validate: (body) => (body.includes('id="root"') ? null : 'HTML shell missing #root'),
  },
  {
    name: 'Worker resolves Bilibili info (short-link chain)',
    url: `${WORKER_BASE}/api/info?url=${encodeURIComponent(BILI_FULL_URL)}`,
    timeoutMs: 30000,
    // The same Worker -> VPS chain that b23.tv short links depend on.
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        return typeof data.bvid === 'string' && data.bvid.startsWith('BV')
          ? null
          : 'response has no bvid';
      } catch {
        return 'not JSON';
      }
    },
  },
  {
    name: 'Vercel Bilibili fallback is configured (YTDLP_API_KEY)',
    url: `${APP_BASE}/api/bilibili?info=1&url=${encodeURIComponent(BILI_FULL_URL)}`,
    timeoutMs: 30000,
    // 503 here means the fallback endpoint exists but the VPS key is not
    // configured on Vercel — the exact misconfiguration that would silently
    // disable the whole resilience chain.
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        return typeof data.bvid === 'string' && data.bvid.startsWith('BV')
          ? null
          : 'response has no bvid';
      } catch {
        return 'not JSON';
      }
    },
  },
  ...YOUTUBE_CAPTION_CONTROLS,
];

export function validateCaptionResponse(body) {
  try {
    const data = JSON.parse(body);
    // The endpoint returns lines directly or wrapped in a container.
    const lines = Array.isArray(data) ? data : data?.lines;
    return Array.isArray(lines) && lines.length > 0
      ? null
      : 'response has no transcript lines';
  } catch {
    return 'not JSON';
  }
}

export async function runCheck(check, { paidProviderGuard } = {}) {
  if (check.paidProvider && !paidProviderGuard) {
    return { ok: false, reason: 'paid provider blocked: explicit opt-in and max-invocations cap are required' };
  }
  const attempts = 1 + (check.retries ?? 1);
  let lastReason = 'unknown failure';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const fetchImpl = check.paidProvider
        ? (...args) => invokePaidProvider(paidProviderGuard, fetch, ...args)
        : fetch;
      const res = await fetchImpl(check.url, { signal: AbortSignal.timeout(check.timeoutMs ?? 30000) });
      const body = await res.text();
      const elapsed = Date.now() - startedAt;
      if (res.status !== 200) {
        lastReason = `HTTP ${res.status}`;
        continue;
      }
      if (check.validate) {
        const reason = check.validate(body);
        if (reason) {
          lastReason = reason;
          continue;
        }
      }
      const evidence = check.transcript
        ? classifyTranscriptAcquisition(res.headers.get(TRANSCRIPT_CACHE_HEADER))
        : undefined;
      return {
        ok: true,
        ms: elapsed,
        attempt,
        ...(evidence ?? {}),
      };
    } catch (err) {
      if (err?.name === 'PaidProviderGuardError') return { ok: false, reason: err.message };
      lastReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }
  return { ok: false, reason: lastReason };
}

export async function main() {
let policy;
try {
  policy = resolvePaidProviderPolicy();
} catch (error) {
  console.log(`CONFIG BLOCKED  ${error instanceof Error ? error.message : String(error)}`);
  return 1;
}
const paidProviderGuard = createPaidProviderGuard(policy);
let failures = 0;
for (const check of CHECKS) {
  if (check.paidProvider && !policy.enabled) {
    console.log(`BLOCKED  ${check.name} (paid provider opt-in/cap not configured)`);
    continue;
  }
  const result = await runCheck(check, { paidProviderGuard });
  if (result.ok) {
    const evidence = result.acquisitionEvidence
      ? ` [cache=${result.cacheState}; acquisition=${result.acquisitionEvidence}]`
      : '';
    console.log(`PASS  ${check.name} (${result.ms}ms)${evidence}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ↳ ${result.reason}`);
  }
}

console.log('='.repeat(72));
if (failures > 0) {
  console.log(`${failures}/${CHECKS.length} checks FAILED`);
  return 1;
}
console.log(`All ${CHECKS.length} checks passed`);
return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
