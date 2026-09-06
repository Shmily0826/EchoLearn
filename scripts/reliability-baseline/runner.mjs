/**
 * Reliability Baseline V1 runner (Mode A: API probes only).
 * Spec: docs/RELIABILITY_BASELINE_V1.md
 *
 * Sequential, one-shot per video per layer; ≥3 s inter-call pause; a failed
 * call stays failed for attribution. Live traffic is double-gated: this
 * script must be run with --execute AND BASELINE_ALLOW_LIVE=1, otherwise it
 * only prints the planned call plan (dry run).
 */

import { BASELINE_MATRIX } from './matrix.mjs';
import { shapeLayerRow, windowVerdict } from './attribution.mjs';

const L1_TIMEOUT_MS = 12000;
const L2_TIMEOUT_MS = 25000;
const INTER_CALL_PAUSE_MS = 3000;
const CACHE_VERIFY_PAUSE_MS = 4000;

const WORKER_BASE = process.env.BASELINE_WORKER_BASE ?? 'https://yt-transcript-proxy.rng2018520.workers.dev';
const APP_BASE = process.env.BASELINE_APP_BASE ?? 'https://echo-learn.uk';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One caption probe. Returns raw outcome metadata only; the transcript body
 * is reduced to a line count here and never retained.
 */
export async function probeEndpoint(baseUrl, videoId, { timeoutMs, layer, pass, fetchImpl }) {
  const url = `${baseUrl}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`;
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const code = error?.name === 'TimeoutError' ? 'provider_timeout' : 'network_error';
    return shapeLayerRow({ videoId, layer, pass, typedCode: code, cacheState: 'absent', latencyMs, lineCount: null });
  }
  const latencyMs = Date.now() - startedAt;
  const cacheState = typeof response.headers?.get === 'function'
    ? (response.headers.get('x-echolearn-transcript-cache') ?? 'absent')
    : 'absent';
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const typedCode = typeof payload?.code === 'string' ? payload.code
    : typeof payload?.error === 'string' ? payload.error
      : (response.ok ? 'untyped' : 'untyped');
  return shapeLayerRow({
    videoId,
    layer,
    pass,
    status: response.status,
    typedCode,
    source: typeof payload?.source === 'string' ? payload.source : null,
    cacheState,
    latencyMs,
    lineCount: response.ok ? lines.length : null,
  });
}

export function buildCallPlan({ matrix = BASELINE_MATRIX, workerBase = WORKER_BASE, appBase = APP_BASE, cacheVerify = true } = {}) {
  const plan = [];
  for (const { videoId } of matrix) {
    plan.push({ videoId, layer: 'L1-worker', url: `${workerBase}/api/transcript?videoId=${videoId}&lang=en`, timeoutMs: L1_TIMEOUT_MS, pass: 1 });
    plan.push({ videoId, layer: 'L2-vercel', url: `${appBase}/api/transcript?videoId=${videoId}&lang=en`, timeoutMs: L2_TIMEOUT_MS, pass: 1 });
    if (cacheVerify) {
      plan.push({ videoId, layer: 'L1-worker', url: `${workerBase}/api/transcript?videoId=${videoId}&lang=en`, timeoutMs: L1_TIMEOUT_MS, pass: 2 });
    }
  }
  return plan;
}

export async function runWindow({ matrix = BASELINE_MATRIX, fetchImpl = fetch, cacheVerify = true, pauseMs = INTER_CALL_PAUSE_MS, hitPauseMs = CACHE_VERIFY_PAUSE_MS, sleepImpl = sleep } = {}) {
  const rows = [];
  for (const { videoId } of matrix) {
    const l1 = await probeEndpoint(WORKER_BASE, videoId, { timeoutMs: L1_TIMEOUT_MS, layer: 'L1-worker', pass: 1, fetchImpl });
    rows.push(l1);
    await sleepImpl(pauseMs);
    const l2 = await probeEndpoint(APP_BASE, videoId, { timeoutMs: L2_TIMEOUT_MS, layer: 'L2-vercel', pass: 1, fetchImpl });
    rows.push(l2);
    if (cacheVerify) {
      await sleepImpl(hitPauseMs);
      rows.push(await probeEndpoint(WORKER_BASE, videoId, { timeoutMs: L1_TIMEOUT_MS, layer: 'L1-worker', pass: 2, fetchImpl }));
    }
    await sleepImpl(pauseMs);
  }
  return { rows, verdict: windowVerdict(rows, matrix.map((entry) => entry.videoId)) };
}

const isLive = process.argv.includes('--execute') && process.env.BASELINE_ALLOW_LIVE === '1';

const invokedAsScript = process.argv[1]?.endsWith('runner.mjs')
  && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (invokedAsScript) {
  const plan = buildCallPlan();
  console.log(`baseline plan: ${plan.length} calls across ${BASELINE_MATRIX.length} videos`);
  console.log(`mode: ${isLive ? 'LIVE (double gate open)' : 'DRY RUN (no traffic)'}`);
  for (const call of plan.slice(0, 4)) console.log(`  ${call.layer} pass=${call.pass} ${call.videoId}`);
  console.log('  …');
  if (!isLive) {
    console.log('dry run: no requests made. To execute: BASELINE_ALLOW_LIVE=1 node runner.mjs --execute');
  } else {
    const { rows, verdict } = await runWindow();
    console.log(JSON.stringify({ verdict, rows }, null, 2));
  }
}
