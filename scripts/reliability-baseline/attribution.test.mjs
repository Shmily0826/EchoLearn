import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  bucketLatency,
  bucketLines,
  isDiscrepancy,
  shapeLayerRow,
  windowVerdict,
} from './attribution.mjs';
import { buildCallPlan, probeEndpoint, runWindow } from './runner.mjs';
import { BASELINE_MATRIX } from './matrix.mjs';

test('runner direct invocation prints a paid-off dry-run plan', () => {
  const env = { ...process.env };
  delete env.ECHOLEARN_ALLOW_PAID_PROVIDER;
  delete env.ECHOLEARN_PAID_MAX_INVOCATIONS;
  delete env.BASELINE_ALLOW_LIVE;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./runner.mjs', import.meta.url))],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /baseline plan: 12 calls across 12 videos/);
  assert.match(result.stdout, /paid provider: BLOCKED \(default\)/);
  assert.match(result.stdout, /mode: DRY RUN \(no traffic\)/);
});

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
  assert.throws(() => shapeLayerRow({ videoId: 'short', layer: 'L2-vercel' }), /11-character/);
  const row = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'some_new_code', status: 503 });
  assert.equal(row.typedCode, 'untyped');
  assert.equal(row.status, 503);
});

test('success verdict uses sanitized lineBucket output, not lineCount', () => {
  const row = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'untyped', lineCount: 75 });
  assert.equal(row.lineCount, undefined);
  assert.equal(row.lineBucket, 'usable');
  assert.equal(windowVerdict([row], ['ZbZSe6N_BXs']).perLayer['L2-vercel'].successes, 1);
});

test('discrepancy detection distinguishes definitive outcomes from transport failures', () => {
  const notFound = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'captions_not_found', lineCount: null });
  const asrRequired = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'asr_required' });
  const timeout = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'provider_timeout' });
  const success = shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', typedCode: 'untyped', lineCount: 75 });
  assert.equal(isDiscrepancy(notFound), true);
  assert.equal(isDiscrepancy(asrRequired), true);
  assert.equal(isDiscrepancy(timeout), false);
  assert.equal(isDiscrepancy(success), false);
});

test('windowVerdict separates pass=1 from cache-verify pass=2 and finds dominant failure layer', () => {
  const rows = [];
  for (const { videoId } of BASELINE_MATRIX) {
    rows.push(shapeLayerRow({ videoId, layer: 'L2-vercel', pass: 1, typedCode: 'untyped', source: 'supadata', lineCount: 50 }));
  }
  const verdict = windowVerdict(rows, BASELINE_MATRIX.map((entry) => entry.videoId));
  assert.equal(verdict.perLayer['L2-vercel'].successes, 12);
  assert.equal(verdict.perLayer['L2-vercel'].bySource.supadata, 12);
  assert.equal(verdict.perLayer['L2-vercel'].cacheHitsObserved, 0);
  assert.equal(verdict.dominantFailureLayer, null);
});

test('windowVerdict counts asr_required against a confirmed positive as a discrepancy', () => {
  const rows = [
    shapeLayerRow({ videoId: 'ZbZSe6N_BXs', layer: 'L2-vercel', pass: 1, typedCode: 'asr_required' }),
  ];
  const verdict = windowVerdict(rows, ['ZbZSe6N_BXs']);
  assert.equal(verdict.perLayer['L2-vercel'].discrepancies, 1);
  assert.equal(verdict.perLayer['L2-vercel'].missing.length, 0);
  const verdictMissing = windowVerdict([], ['ZbZSe6N_BXs']);
  assert.equal(verdictMissing.perLayer['L2-vercel'].missing.length, 1);
});

test('buildCallPlan targets one sequential Vercel request per video', () => {
  const plan = buildCallPlan({ appBase: 'https://app.test' });
  assert.equal(plan.length, BASELINE_MATRIX.length);
  assert.equal(plan[0].layer, 'L2-vercel');
  assert.equal(plan[0].url, 'https://app.test/api/transcript?videoId=ZbZSe6N_BXs&lang=en');
  assert.equal(plan.every((call) => !call.url.includes('allowAsr=1')), true);
  assert.equal(plan.every((call) => !call.url.includes('workers.dev')), true);
});

test('probeEndpoint maps timeout, network error, success, and typed failures', async () => {
  const timeoutFetch = async () => {
    const error = new Error('aborted');
    error.name = 'TimeoutError';
    throw error;
  };
  const timeoutRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L2-vercel', pass: 1, fetchImpl: timeoutFetch });
  assert.equal(timeoutRow.typedCode, 'provider_timeout');

  const networkRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L2-vercel', pass: 1, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
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
  const failureRow = await probeEndpoint('https://example.test', 'ZbZSe6N_BXs', { timeoutMs: 10, layer: 'L2-vercel', pass: 1, fetchImpl: async () => errorResponse });
  assert.equal(failureRow.typedCode, 'provider_timeout');
  assert.equal(failureRow.lineBucket, 'unknown');
});

test('runWindow is one-shot and sequential on the Vercel path', async () => {
  const calls = [];
  let active = 0;
  const fetchImpl = async (url) => {
    calls.push(String(url));
    active += 1;
    assert.equal(active, 1);
    active -= 1;
    throw new Error('ECONNREFUSED');
  };
  const { rows, verdict } = await runWindow({
    matrix: BASELINE_MATRIX.slice(0, 2),
    appBase: 'https://app.test',
    fetchImpl,
    paidProviderPolicy: { enabled: true, maxInvocations: 10 },
    pauseMs: 0,
    sleepImpl: async () => {},
  });
  assert.equal(calls.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.layer === 'L2-vercel' && row.pass === 1), true);
  assert.equal(verdict.perLayer['L2-vercel'].covered, 2);
  assert.equal(verdict.perLayer['L2-vercel'].networkErrors, 2);
  assert.equal(calls.every((url) => url === 'https://app.test/api/transcript?videoId=ZbZSe6N_BXs&lang=en' || url === 'https://app.test/api/transcript?videoId=JGwWNGJdvx8&lang=en'), true);
});
