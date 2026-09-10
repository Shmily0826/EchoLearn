/**
 * Pure attribution logic for the reliability baseline rows.
 * Spec: docs/RELIABILITY_BASELINE_V1.md — privacy-safe by construction:
 * these functions accept only outcome metadata and never transcript text,
 * upstream payloads, URLs beyond the video ID, cookies, or tokens.
 */

export const WIRE_CODES = [
  'captions_not_found',
  'provider_timeout',
  'provider_failure',
  'youtube_acquisition_blocked',
  'transcript_disabled',
  'asr_required',
  'rate_limit',
  'invalid_request',
  'client_disconnected',
];

export const DEFINITIVE_NO_CAPTION_CODES = ['captions_not_found', 'transcript_disabled'];
export const TRANSPORT_FAILURE_CODES = ['provider_timeout', 'provider_failure', 'rate_limit'];

export const LATENCY_BUCKETS = ['lt_2s', '2s_8s', '8s_15s', '15s_25s', 'gt_25s'];

export function bucketLatency(latencyMs) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 'unknown';
  if (latencyMs < 2000) return 'lt_2s';
  if (latencyMs < 8000) return '2s_8s';
  if (latencyMs < 15000) return '8s_15s';
  if (latencyMs < 25000) return '15s_25s';
  return 'gt_25s';
}

export function bucketLines(lineCount) {
  if (!Number.isInteger(lineCount) || lineCount < 0) return 'unknown';
  if (lineCount === 0) return 'zero';
  if (lineCount <= 20) return 'small';
  return 'usable';
}

export const CACHE_STATES = ['HIT', 'MISS', 'BYPASS', 'absent', 'UNKNOWN'];

/**
 * Shapes one privacy-safe layer row. Unknown typed codes collapse to
 * 'untyped' so a new server code cannot silently widen the taxonomy without
 * this module noticing.
 */
export function shapeLayerRow(input) {
  const {
    videoId,
    layer,
    pass = 1,
    status = null,
    typedCode = null,
    source = null,
    cacheState = 'absent',
    latencyMs = null,
    lineCount = null,
  } = input ?? {};
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId ?? ''))) {
    throw new Error('baseline row requires an 11-character videoId');
  }
  const code = WIRE_CODES.includes(typedCode) ? typedCode
    : (typedCode === 'network_error' ? 'network_error' : 'untyped');
  return {
    videoId,
    layer,
    pass,
    status: Number.isInteger(status) ? status : null,
    typedCode: code,
    source: typeof source === 'string' && source.length > 0 ? source : null,
    cacheState: CACHE_STATES.includes(cacheState) ? cacheState : 'UNKNOWN',
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    latencyBucket: bucketLatency(latencyMs),
    lineBucket: bucketLines(lineCount),
  };
}

/** A discrepancy: a definitive no-caption/ASR outcome against a confirmed positive. */
export function isDiscrepancy(row) {
  if (row.typedCode === 'asr_required') return true;
  return DEFINITIVE_NO_CAPTION_CODES.includes(row.typedCode) && row.lineBucket !== 'usable';
}

export function isTransportFailure(row) {
  return TRANSPORT_FAILURE_CODES.includes(row.typedCode);
}

export function isLayerSuccess(row) {
  return row.lineBucket === 'usable';
}

/**
 * Aggregates rows into per-layer verdicts. First-pass rows (pass === 1) are
 * the window result; cache-HIT verification rows (pass === 2) are counted
 * separately and never merged into the first-pass result.
 */
export function windowVerdict(rows, matrixVideoIds) {
  const layers = ['L2-vercel'];
  const perLayer = {};
  for (const layer of layers) {
    const firstPass = rows.filter((row) => row.layer === layer && row.pass === 1);
    const hitPass = rows.filter((row) => row.layer === layer && row.pass === 2);
    const covered = new Set(firstPass.map((row) => row.videoId));
    perLayer[layer] = {
      requested: matrixVideoIds.length,
      covered: firstPass.length,
      missing: matrixVideoIds.filter((id) => !covered.has(id)),
      successes: firstPass.filter(isLayerSuccess).length,
      transportFailures: firstPass.filter(isTransportFailure).length,
      discrepancies: firstPass.filter(isDiscrepancy).length,
      networkErrors: firstPass.filter((row) => row.typedCode === 'network_error').length,
      cacheHitsObserved: hitPass.filter((row) => row.cacheState === 'HIT').length,
      byCode: firstPass.reduce((acc, row) => {
        acc[row.typedCode] = (acc[row.typedCode] ?? 0) + 1;
        return acc;
      }, {}),
      bySource: firstPass.reduce((acc, row) => {
        if (row.source) acc[row.source] = (acc[row.source] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }
  const dominantFailureLayer = layers
    .map((layer) => [layer, perLayer[layer].transportFailures + perLayer[layer].networkErrors])
    .sort((a, b) => b[1] - a[1])
    .find(([, failures]) => failures > 0)?.[0] ?? null;
  return { perLayer, dominantFailureLayer };
}
