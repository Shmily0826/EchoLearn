/**
 * Reliability Baseline V1 runner (Mode A: API probes only).
 * Spec: docs/RELIABILITY_BASELINE_V1.md
 *
 * Sequential, one-shot per video per layer; ≥3 s inter-call pause; a failed
 * call stays failed for attribution. Live traffic is double-gated: this
 * script must be run with --execute AND BASELINE_ALLOW_LIVE=1, otherwise it
 * only prints the planned call plan (dry run). The paid-capable L2 layer also
 * requires ECHOLEARN_ALLOW_PAID_PROVIDER=1 and a numeric invocation cap.
 */

import { BASELINE_MATRIX } from './matrix.mjs';
import { shapeLayerRow, windowVerdict } from './attribution.mjs';
import { createPaidProviderGuard, resolvePaidProviderPolicy } from '../paid-provider-guard.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const L2_TIMEOUT_MS = 25000;
const INTER_CALL_PAUSE_MS = 3000;

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
    if (error?.name === 'PaidProviderGuardError') throw error;
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

export function buildCallPlan({ matrix = BASELINE_MATRIX, appBase = APP_BASE } = {}) {
  const plan = [];
  for (const { videoId } of matrix) {
    plan.push({ videoId, layer: 'L2-vercel', url: `${appBase}/api/transcript?videoId=${videoId}&lang=en`, timeoutMs: L2_TIMEOUT_MS, pass: 1, paidProvider: true });
  }
  return plan;
}

export async function runWindow({ matrix = BASELINE_MATRIX, appBase = APP_BASE, fetchImpl = fetch, pauseMs = INTER_CALL_PAUSE_MS, sleepImpl = sleep, paidProviderPolicy = resolvePaidProviderPolicy() } = {}) {
  const rows = [];
  const paidProvider = createPaidProviderGuard(paidProviderPolicy);
  for (const { videoId } of matrix) {
    rows.push(await probeEndpoint(appBase, videoId, {
      timeoutMs: L2_TIMEOUT_MS,
      layer: 'L2-vercel',
      pass: 1,
      fetchImpl: (...args) => paidProvider.invoke(fetchImpl, ...args),
    }));
    await sleepImpl(pauseMs);
  }
  return { rows, verdict: windowVerdict(rows, matrix.map((entry) => entry.videoId)) };
}

const isLive = process.argv.includes('--execute') && process.env.BASELINE_ALLOW_LIVE === '1';

const invokedAsScript = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedAsScript) {
  try {
    const paidProviderPolicy = resolvePaidProviderPolicy();
    const plan = buildCallPlan();
    console.log(`baseline plan: ${plan.length} calls across ${BASELINE_MATRIX.length} videos`);
    console.log(`paid provider: ${paidProviderPolicy.enabled ? `ENABLED (cap ${paidProviderPolicy.maxInvocations})` : 'BLOCKED (default)'}`);
    console.log(`mode: ${isLive ? 'LIVE (double gate open)' : 'DRY RUN (no traffic)'}`);
    for (const call of plan.slice(0, 4)) console.log(`  ${call.layer} pass=${call.pass} ${call.videoId}`);
    console.log('  …');
    if (!isLive) {
      console.log('dry run: no requests made. To execute the Vercel caption path: ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=<n> BASELINE_ALLOW_LIVE=1 node runner.mjs --execute');
    } else {
      const { rows, verdict } = await runWindow({ paidProviderPolicy });
      console.log(JSON.stringify({ verdict, rows }, null, 2));
    }
  } catch (error) {
    console.error(`baseline blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
