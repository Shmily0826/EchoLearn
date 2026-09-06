/**
 * Worker-only attribution window tool (Reliability roadmap Phase 1).
 *
 * Goal: answer whether the Worker's 0/12 baseline is a whole-layer
 * cloud-egress problem or driven by specific cascade stages (InnerTube
 * clients / webpage / Invidious / Piped). Uses the Worker's sanitized
 * debug channel (`debug=1`, gated by ALLOW_DEBUG) which returns the
 * per-stage `log()` messages in `_debug`. Caption-only: `allowAsr` is
 * never sent, so no ASR path can start; debug responses BYPASS the
 * transcript cache, so no cache pollution.
 *
 * Privacy: rows keep only typed outcomes, stage names, HTTP statuses, and
 * truncated provider messages (hostnames / playability reasons). Transcript
 * text, upstream payloads, and URLs beyond the video ID are never retained.
 */

import { BASELINE_MATRIX } from './matrix.mjs';
import { bucketLatency, WIRE_CODES } from './attribution.mjs';

const WORKER_BASE = process.env.BASELINE_WORKER_BASE ?? 'https://yt-transcript-proxy.rng2018520.workers.dev';
const PROBE_TIMEOUT_MS = 14000; // worker caption deadline 11 s + margin
const INTER_CALL_PAUSE_MS = 3000;

function classifyStageMessage(message) {
  let match;
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+): LOGIN_REQUIRED/))) {
    return { stage: 'innertube', instance: match[1], outcome: 'login_required' };
  }
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+): HTTP (\d+)/))) {
    return { stage: 'innertube', instance: match[1], outcome: 'http_error', status: Number(match[2]) };
  }
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+): OK but no caption tracks/))) {
    return { stage: 'innertube', instance: match[1], outcome: 'no_tracks' };
  }
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+): found (\d+) caption track/))) {
    return { stage: 'innertube', instance: match[1], outcome: 'success', count: Number(match[2]) };
  }
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+) error: /))) {
    return { stage: 'innertube', instance: match[1], outcome: 'error' };
  }
  if ((match = message.match(/^InnerTube ([A-Z_0-9]+): ERROR — /))) {
    return { stage: 'innertube', instance: match[1], outcome: 'client_unsupported' };
  }
  if ((match = message.match(/^\[scrape:([a-z]+)→([^\]]+)\]/))) {
    return { stage: 'scrape_gateway', instance: match[1], outcome: 'attempted' };
  }
  if ((match = message.match(/^\[scrape\] HTTP (\d+)/))) {
    return { stage: 'scrape_gateway', outcome: 'http_error', status: Number(match[1]) };
  }
  if (/^Web page: CAPTCHA/.test(message)) {
    return { stage: 'webpage', outcome: 'captcha' };
  }
  if ((match = message.match(/^Web page: HTTP (\d+)/))) {
    return { stage: 'webpage', outcome: 'http_error', status: Number(match[1]) };
  }
  if (/^Web page: player response has no caption tracks/.test(message)) {
    return { stage: 'webpage', outcome: 'no_tracks' };
  }
  if (/^Web page: (JSON extraction returned null|could not extract player response)/.test(message)) {
    return { stage: 'webpage', outcome: 'parse_failure' };
  }
  if (/^Invidious: all instances in cooldown/.test(message)) {
    return { stage: 'invidious', outcome: 'cooldown_skipped' };
  }
  if ((match = message.match(/^Invidious \(([^)]+)\): (.+)$/))) {
    return { stage: 'invidious', instance: match[1], outcome: classifyProviderDetail(match[2]) };
  }
  if (/^Piped: all instances in cooldown/.test(message)) {
    return { stage: 'piped', outcome: 'cooldown_skipped' };
  }
  if ((match = message.match(/^Piped \(([^)]+)\): (.+)$/))) {
    return { stage: 'piped', instance: match[1], outcome: classifyProviderDetail(match[2]) };
  }
  return { stage: 'unknown', outcome: 'other' };
}

function classifyProviderDetail(detail) {
  if (/^HTTP \d+/.test(detail)) return 'http_error';
  if (detail === 'invalid JSON response') return 'malformed';
  if (detail === 'no captions' || detail === 'no subtitles') return 'no_tracks';
  if (/^empty caption|^all formats returned empty/.test(detail)) return 'empty';
  if (/^got \d+ lines/.test(detail)) return 'success';
  if (/^\d+ caption\(s\) available|^\d+ subtitle\(s\)$/.test(detail)) return 'tracks_listed';
  if (/^no URL for subtitle/.test(detail)) return 'no_subtitle_url';
  return 'other';
}

/** Shapes one privacy-safe attribution row for one video probe. */
export function shapeAttributionRow({ videoId, status, typedCode, latencyMs, debugMessages }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId ?? ''))) {
    throw new Error('attribution row requires an 11-character videoId');
  }
  const stages = (debugMessages ?? []).map((message) => ({
    ...classifyStageMessage(String(message)),
    message: String(message).slice(0, 120),
  }));
  return {
    videoId,
    status: Number.isInteger(status) ? status : null,
    typedCode: WIRE_CODES.includes(typedCode) ? typedCode
      : (typedCode === 'network_error' ? 'network_error' : 'untyped'),
    latencyBucket: bucketLatency(latencyMs),
    stages,
  };
}

/** Aggregates stage outcomes across rows: per stage × outcome counts. */
export function aggregateStageOutcomes(rows) {
  const tally = {};
  for (const row of rows) {
    for (const stage of row.stages) {
      const key = `${stage.stage}${stage.instance ? `:${stage.instance}` : ''}`;
      tally[key] ??= {};
      tally[key][stage.outcome] = (tally[key][stage.outcome] ?? 0) + 1;
    }
  }
  return tally;
}

/** Per-window verdict: typed code distribution + stage outcome table. */
export function attributionVerdict(rows) {
  const byCode = rows.reduce((acc, row) => {
    acc[row.typedCode] = (acc[row.typedCode] ?? 0) + 1;
    return acc;
  }, {});
  return {
    videos: rows.length,
    byCode,
    stageOutcomes: aggregateStageOutcomes(rows),
  };
}

/** One probe against the Worker with debug enabled. Never sends allowAsr. */
export async function probeWorkerAttribution(videoId, { fetchImpl, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const url = `${WORKER_BASE}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=en&debug=1`;
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return shapeAttributionRow({
      videoId,
      typedCode: error?.name === 'TimeoutError' ? 'provider_timeout' : 'network_error',
      latencyMs: Date.now() - startedAt,
      debugMessages: [],
    });
  }
  const latencyMs = Date.now() - startedAt;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return shapeAttributionRow({
    videoId,
    status: response.status,
    typedCode: typeof payload?.error === 'string' ? payload.error : (response.ok ? 'untyped' : 'untyped'),
    latencyMs,
    debugMessages: Array.isArray(payload?._debug) ? payload._debug : [],
  });
}

/** Runs one attribution window over the frozen matrix, sequential one-shot. */
export async function runAttributionWindow({ matrix = BASELINE_MATRIX, fetchImpl = fetch, pauseMs = INTER_CALL_PAUSE_MS, sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const rows = [];
  for (const { videoId } of matrix) {
    rows.push(await probeWorkerAttribution(videoId, { fetchImpl }));
    await sleepImpl(pauseMs);
  }
  return { rows, verdict: attributionVerdict(rows) };
}
