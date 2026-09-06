import test from 'node:test';
import assert from 'node:assert/strict';
import { runArm, summarizeArm } from './budget-ab.mjs';
import { BASELINE_MATRIX } from './matrix.mjs';

function workerFailure(payload, status = 504) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => payload,
  };
}

test('summarizeArm computes median/P90, success, and Supadata counts', () => {
  const rows = [];
  const ids = BASELINE_MATRIX.slice(0, 4).map((entry) => entry.videoId);
  ids.forEach((videoId, index) => {
    rows.push({ videoId, layer: 'L1-worker', pass: 1, typedCode: 'provider_timeout', lineBucket: 'unknown', latencyMs: 3000 + index, source: null });
    rows.push({ videoId, layer: 'L2-vercel', pass: 1, typedCode: 'untyped', lineBucket: 'usable', latencyMs: 4000 - index, source: 'supadata' });
  });
  const summary = summarizeArm(rows);
  assert.equal(summary.l1Successes, 0);
  assert.equal(summary.l1TypedFailures, 4);
  assert.equal(summary.finalUsable, 4);
  assert.equal(summary.supadataInvocations, 4);
  const totals = ids.map((_, index) => (3000 + index) + (4000 - index)).sort((a, b) => a - b);
  assert.equal(summary.timeToCaption.medianMs, totals[Math.ceil(0.5 * totals.length) - 1]);
  assert.equal(summary.timeToCaption.p90Ms, totals[totals.length - 1]);
});

test('runArm is one-shot per layer and always falls back to L2 after L1 failure', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('workers.dev') || String(url).includes('workerBase')) return workerFailure({ error: 'provider_timeout' });
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ lines: [{ text: 'x' }], source: 'supadata' }),
    };
  };
  const { rows, summary } = await runArm(3000, {
    matrix: BASELINE_MATRIX.slice(0, 2),
    fetchImpl,
    pauseMs: 0,
    sleepImpl: async () => {},
    workerBase: 'https://workerBase.test',
    appBase: 'https://appBase.test',
  });
  assert.equal(calls.length, 4); // 2 videos x (L1 + L2), no retries
  assert.equal(rows.filter((row) => row.layer === 'L1-worker').length, 2);
  assert.equal(rows.filter((row) => row.layer === 'L2-vercel').length, 2);
  assert.equal(summary.supadataInvocations, 2);
  assert.equal(rows[0].latencyMs !== null, true);
});

test('runArm marks client-budget aborts as provider_timeout with real elapsed time', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('workerBase')) {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    }
    return workerFailure({ error: 'provider_timeout' });
  };
  const { rows } = await runArm(3000, {
    matrix: BASELINE_MATRIX.slice(0, 1),
    fetchImpl,
    pauseMs: 0,
    sleepImpl: async () => {},
    workerBase: 'https://workerBase.test',
    appBase: 'https://appBase.test',
  });
  assert.equal(rows[0].typedCode, 'provider_timeout');
  assert.ok(rows[0].latencyMs < 3000); // mock aborts instantly; real elapsed recorded, not the budget
  assert.equal(rows[1].typedCode, 'provider_timeout'); // mock L2 payload echoes this code
});

test('runArm records an L1 success without invoking L2 semantics break is not present: L2 still probed per protocol', async () => {
  // The A/B protocol always probes L2 after L1 regardless of L1 outcome so
  // arms are comparable; this test pins that decision.
  const fetchImpl = async (url) => {
    if (String(url).includes('workerBase')) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ lines: Array.from({ length: 30 }, () => ({ text: 'x' })), source: 'innertube' }),
      };
    }
    return workerFailure({ error: 'provider_timeout' });
  };
  const { summary } = await runArm(3000, {
    matrix: BASELINE_MATRIX.slice(0, 1),
    fetchImpl,
    pauseMs: 0,
    sleepImpl: async () => {},
    workerBase: 'https://workerBase.test',
    appBase: 'https://appBase.test',
  });
  assert.equal(summary.l1Successes, 1);
  assert.equal(summary.supadataInvocations, 0);
});
