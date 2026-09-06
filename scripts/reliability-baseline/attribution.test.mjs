import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketLatency,
  bucketLines,
  isDiscrepancy,
  shapeLayerRow,
  windowVerdict,
} from './attribution.mjs';
import { buildCallPlan, probeEndpoint, runWindow } from './runner.mjs';
import { BASELINE_MATRIX } from './matrix.mjs';

test('latency and line bucketing', () => {
  assert.equal(bucketLatency(1999), 'lt_2s');
  assert.equal(bucketLatency(2000), '2s_8s');
  assert.equal(bucketLatency(14352), '8s_15s');
  assert.equal(bucketLatency(16000), '15s_25s');
  assert.equal(bucketLatency(30000), 'gt_25s');
  assert.equal(bucketLatency(-1), 'unknown');
  assert.equal(bucketLines(0), 'zero');
  assert.equal(bucketLines(75), 'usable');
  assert.equal(bucketLines(20), 'small');
  assert.equal(bucketLines(undefined), 'unknown');
});

test('shapeLayerRow rejects malformed videoId and collapses unknown codes', () => {
  assert.throws(() => shapeLayerRow({ videoId: 'short', layer: 'L1-worker' }), /11-character/);
  const row = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L1-worker', typedCode: 'some_new_code', status: 503 });
  assert.equal(row.typedCode, 'untyped');
  assert.equal(row.status, 503);
});

test('discrepancy detection distinguishes definitive outcomes from transport failures', () => {
  const notFound = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L1-worker', typedCode: 'captions_not_found', lineCount: null });
  const asrRequired = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L1-worker', typedCode: 'asr_required' });
  const timeout = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L1-worker', typedCode: 'provider_timeout' });
  const success = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L1-worker', typedCode: 'untyped', lineCount: 75 });
  assert.equal(isDiscrepancy(notFound), true);
  assert.equal(isDiscrepancy(asrRequired), true);
  assert.equal(isDiscrepancy(timeout), false);
  assert.equal(isDiscrepancy(success), false);
});

test('windowVerdict separates pass=1 from cache-verify pass=2 and finds dominant failure layer', () => {
  const rows = [];
  for (const { videoId } of BASELINE_MATRIX) {
    rows.push(shapeLayerRow({ videoId, layer: 'L1-worker', pass: 1, typedCode: 'provider_timeout' }));
    rows.push(shapeLayerRow({ videoId, layer: 'L2-vercel', pass: 1, typedCode: 'untyped', source: 'supadata', lineCount: 50 }));
    rows.push(shapeLayerRow({ videoId, layer: 'L1-worker', pass: 2, cacheState: 'HIT', lineCount: 50 }));
  }
  const verdict = windowVerdict(rows, BASELINE_MATRIX.map((entry) => entry.videoId));
  assert.equal(verdict.perLayer['L1-worker'].transportFailures, 12);
  assert.equal(verdict.perLayer['L1-worker'].successes, 0);
  assert.equal(verdict.perLayer['L1-worker'].discrepancies, 0);
  assert.equal(verdict.perLayer['L1-worker'].cacheHitsObserved, 12);
  assert.equal(verdict.perLayer['L2-vercel'].successes, 12);
  assert.equal(verdict.perLayer['L2-vercel'].bySource.supadata, 12);
  assert.equal(verdict.dominantFailureLayer, 'L1-worker');
});

test('windowVerdict counts asr_required against a confirmed positive as a discrepancy', () => {
  const rows = [
    shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', pass: 1, typedCode: 'asr_required' }),
  ];
  const verdict = windowVerdict(rows, ['ZbZSe6N_BXs']);
  assert.equal(verdict.perLayer['L2-vercel'].discrepancies, 1);
  assert.equal(verdict.perLayer['L2-vercel'].missing.length, 0);
  const verdictMissing = windowVerdict([], ['ZbZSe6N_BXs']);
  assert.equal(verdictMissing.perLayer['L1-worker'].missing.length, 1);
});

test('buildCallPlan orders L1, L2, cache-verify for every video', () => {
  const plan = buildCallPlan();
  assert.equal(plan.length, BASELINE_MATRIX.length * 3);
  assert.equal(plan[0].layer, 'L1-worker');
  assert.equal(plan[1].layer, 'L2-vercel');
  assert.equal(plan[2].layer, 'L1-worker');
  assert.equal(plan[2].pass, 2);
});

test('probeEndpoint maps timeout, network error, success, and typed failures', async () => {
  const timeoutFetch = async () => {
    const error = new Error('aborted');
    error.name = 'TimeoutError';
    throw error;
  };
  const timeoutRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L1-worker', pass: 1, fetchImpl: timeoutFetch });
  assert.equal(timeoutRow.typedCode, 'provider_timeout');

  const networkRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L1-worker', pass: 1, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(networkRow.typedCode, 'network_error');

  const okResponse = {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'x-echolearn-transcript-cache' ? 'MISS' : null) },
    json: async () => ({ lines: Array.from({ length: 30 }, () => ({ text: 'x' })), source: 'supadata' }),
  };
  const successRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L2-vercel', pass: 1, fetchImpl: async () => okResponse });
  assert.equal(successRow.cacheState, 'MISS');
  assert.equal(successRow.source, 'supadata');
  assert.equal(successRow.lineBucket, 'usable');

  const errorResponse = {
    ok: false,
    status: 504,
    headers: { get: () => null },
    json: async () => ({ error: 'provider_timeout' }),
  };
  const failureRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L1-worker', pass: 1, fetchImpl: async () => errorResponse });
  assert.equal(failureRow.typedCode, 'provider_timeout');
  assert.equal(failureRow.lineBucket, 'unknown');
});

test('runWindow is one-shot: a failing endpoint is probed exactly once per pass and L2 still runs', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('ECONNREFUSED');
  };
  const { rows, verdict } = await runWindow({
    matrix: BASELINE_MATRIX.slice(0, 2),
    fetchImpl,
    cacheVerify: true,
    pauseMs: 0,
    hitPauseMs: 0,
    sleepImpl: async () => {},
  });
  // 2 videos x (L1 pass1 + L2 pass1 + L1 pass2) = 6 calls, no retries.
  assert.equal(calls, 6);
  assert.equal(rows.length, 6);
  assert.equal(verdict.perLayer['L2-vercel'].covered, 2);
  assert.equal(verdict.perLayer['L2-vercel'].networkErrors, 2);
});
