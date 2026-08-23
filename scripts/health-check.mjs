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

const APP_BASE = 'https://echo-learn.uk';
const WORKER_BASE = 'https://yt-transcript-proxy.rng2018520.workers.dev';

// A stable Bilibili video with known BV id (used in the repo's own code
// examples) and a stable YouTube video with English captions.
const BILI_FULL_URL = 'https://www.bilibili.com/video/BV1xx411c7mD';
const YT_VIDEO_ID = 'dQw4w9WgXcQ';

/**
 * @typedef {Object} Check
 * @property {string} name
 * @property {string} url
 * @property {number} [timeoutMs]   per-attempt timeout (default 30s)
 * @property {number} [retries]     extra attempts after a failure (default 1)
 * @property {(bodyText: string) => string | null} [validate]
 *          returns null when OK, or a reason string when the response body
 *          is not what the app depends on.
 */

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
          : `response has no bvid: ${body.slice(0, 120)}`;
      } catch {
        return `not JSON: ${body.slice(0, 120)}`;
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
          : `response has no bvid: ${body.slice(0, 120)}`;
      } catch {
        return `not JSON: ${body.slice(0, 120)}`;
      }
    },
  },
  {
    name: 'Worker serves YouTube transcripts',
    url: `${WORKER_BASE}/api/transcript?videoId=${YT_VIDEO_ID}&lang=en`,
    timeoutMs: 45000,
    validate: (body) => {
      try {
        JSON.parse(body);
        return null;
      } catch {
        return `not JSON: ${body.slice(0, 120)}`;
      }
    },
  },
  {
    name: 'Vercel YouTube transcript fallback works',
    url: `${APP_BASE}/api/transcript?videoId=${YT_VIDEO_ID}&lang=en`,
    timeoutMs: 45000,
    validate: (body) => {
      try {
        const data = JSON.parse(body);
        // The endpoint returns lines directly or wrapped in a container.
        const lines = Array.isArray(data) ? data : data?.lines;
        return Array.isArray(lines) && lines.length > 0
          ? null
          : `no transcript lines: ${body.slice(0, 120)}`;
      } catch {
        return `not JSON: ${body.slice(0, 120)}`;
      }
    },
  },
];

async function runCheck(check) {
  const attempts = 1 + (check.retries ?? 1);
  let lastReason = 'unknown failure';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await fetch(check.url, { signal: AbortSignal.timeout(check.timeoutMs ?? 30000) });
      const body = await res.text();
      const elapsed = Date.now() - startedAt;
      if (!res.ok) {
        lastReason = `HTTP ${res.status} — ${body.slice(0, 120)}`;
        continue;
      }
      if (check.validate) {
        const reason = check.validate(body);
        if (reason) {
          lastReason = reason;
          continue;
        }
      }
      return { ok: true, ms: elapsed, attempt };
    } catch (err) {
      lastReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }
  return { ok: false, reason: lastReason };
}

console.log(`EchoLearn caption-pipeline health check — ${new Date().toISOString()}`);
console.log('='.repeat(72));

let failures = 0;
for (const check of CHECKS) {
  const result = await runCheck(check);
  if (result.ok) {
    console.log(`PASS  ${check.name} (${result.ms}ms)`);
  } else {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ↳ ${result.reason}`);
  }
}

console.log('='.repeat(72));
if (failures > 0) {
  console.log(`${failures}/${CHECKS.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${CHECKS.length} checks passed`);
