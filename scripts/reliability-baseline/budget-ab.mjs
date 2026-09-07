/**
 * L1 budget A/B tool (Reliability roadmap Phase 2).
 *
 * Compares caption-only Worker budgets (12 s current, 5 s, 3 s) on the
 * frozen 12-video matrix. Each arm replays the production client cascade
 * sequentially: L1 Worker probe with the arm's budget, then (on failure)
 * the L2 Vercel probe. One-shot per video per layer per arm; no retries;
 * allowAsr never sent; raw latencies recorded (not just buckets).
 *
 * Acceptance metrics per arm: L1 successes, L1 typed failures, actual L1
 * elapsed, end-to-end time-to-caption, median, P90, L2/Supadata invocation
 * count, final source attribution. The 12 s arm measures the current
 * behavior under identical conditions rather than reusing earlier windows.
 *
 * Privacy: rows contain only outcome metadata and raw latency; the L2 body
 * is reduced to a line count and source string. No transcript text.
 */

import { BASELINE_MATRIX } from './matrix.mjs';
import { shapeLayerRow, windowVerdict } from './attribution.mjs';
import { createPaidProviderGuard, resolvePaidProviderPolicy } from '../paid-provider-guard.mjs';

const WORKER_BASE = process.env.BASELINE_WORKER_BASE ?? 'https://yt-transcript-proxy.rng2018520.workers.dev';
const APP_BASE = process.env.BASELINE_APP_BASE ?? 'https://echo-learn.uk';
const L2_TIMEOUT_MS = 25000;
const INTER_CALL_PAUSE_MS = 3000;

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

function median(values) {
  return percentile(values, 50);
}

export function summarizeArm(rows) {
  const l1Rows = rows.filter((row) => row.layer === 'L1-worker' && row.pass === 1);
  const l2Rows = rows.filter((row) => row.layer === 'L2-vercel' && row.pass === 1);
  const e2e = l1Rows
    .map((l1) => {
      const l2 = l2Rows.find((row) => row.videoId === l1.videoId);
      return l2 ? { videoId: l1.videoId, l1Ms: l1.latencyMs, l2Ms: l2.latencyMs, totalMs: l1.latencyMs + l2.latencyMs } : null;
    })
    .filter(Boolean);
  const totals = e2e.map((entry) => entry.totalMs).sort((a, b) => a - b);
  return {
    armRows: rows.length,
    l1Successes: l1Rows.filter((row) => row.lineBucket === 'usable').length,
    l1TypedFailures: l1Rows.reduce((acc, row) => {
      if (row.typedCode === 'provider_timeout' || row.typedCode === 'provider_failure' || row.typedCode === 'rate_limit') acc += 1;
      if (row.typedCode === 'asr_required') acc += 1;
      return acc;
    }, 0),
    l1ElapsedMs: l1Rows.map((row) => ({ videoId: row.videoId, latencyMs: row.latencyMs })),
    finalUsable: l2Rows.filter((row) => row.lineBucket === 'usable').length,
    supadataInvocations: l2Rows.filter((row) => row.source === 'supadata').length,
    bySource: l2Rows.reduce((acc, row) => {
      if (row.source) acc[row.source] = (acc[row.source] ?? 0) + 1;
      return acc;
    }, {}),
    timeToCaption: { medianMs: median(totals), p90Ms: percentile(totals, 90), perVideo: e2e },
  };
}

export async function runArm(budgetMs, { matrix = BASELINE_MATRIX, fetchImpl = fetch, pauseMs = INTER_CALL_PAUSE_MS, sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), workerBase = WORKER_BASE, appBase = APP_BASE, paidProviderPolicy = resolvePaidProviderPolicy() } = {}) {
  const rows = [];
  const paidProvider = createPaidProviderGuard(paidProviderPolicy);
  const rawLatency = new Map();
  for (const { videoId } of matrix) {
    const startedAt = Date.now();
    let l1;
    try {
      const response = await fetchImpl(`${workerBase}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`, { signal: AbortSignal.timeout(budgetMs) });
      const latencyMs = Date.now() - startedAt;
      rawLatency.set(videoId, latencyMs);
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      const lines = Array.isArray(payload?.lines) ? payload.lines : [];
      l1 = shapeLayerRow({
        videoId, layer: 'L1-worker', status: response.status,
        typedCode: typeof payload?.error === 'string' ? payload.error : 'untyped',
        source: typeof payload?.source === 'string' ? payload.source : null,
        cacheState: 'absent', latencyMs, lineCount: response.ok ? lines.length : null,
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      rawLatency.set(videoId, latencyMs);
      l1 = shapeLayerRow({
        videoId, layer: 'L1-worker',
        typedCode: error?.name === 'TimeoutError' ? 'provider_timeout' : 'network_error',
        cacheState: 'absent', latencyMs, lineCount: null,
      });
    }
    rows.push(l1);
    if (!paidProvider.enabled) continue;
    await sleepImpl(pauseMs);

    const l2StartedAt = Date.now();
    let l2;
    try {
      const response = await paidProvider.invoke(fetchImpl, `${appBase}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`, { signal: AbortSignal.timeout(L2_TIMEOUT_MS) });
      const latencyMs = Date.now() - l2StartedAt;
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      const lines = Array.isArray(payload?.lines) ? payload.lines : [];
      l2 = shapeLayerRow({
        videoId, layer: 'L2-vercel', status: response.status,
        typedCode: typeof payload?.error === 'string' ? payload.error : 'untyped',
        source: typeof payload?.source === 'string' ? payload.source : null,
        cacheState: 'absent', latencyMs, lineCount: response.ok ? lines.length : null,
      });
    } catch (error) {
      if (error?.name === 'PaidProviderGuardError') throw error;
      l2 = shapeLayerRow({
        videoId, layer: 'L2-vercel',
        typedCode: error?.name === 'TimeoutError' ? 'provider_timeout' : 'network_error',
        cacheState: 'absent', latencyMs: Date.now() - l2StartedAt, lineCount: null,
      });
    }
    rows.push(l2);
    await sleepImpl(pauseMs);
  }
  void rawLatency;
  return { budgetMs, rows, summary: summarizeArm(rows) };
}
