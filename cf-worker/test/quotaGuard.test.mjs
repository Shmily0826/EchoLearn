import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// /api/audio always takes the guest branch of paidRouteGuard (media elements
// cannot send an Authorization header), which makes it the cheapest way in.
const AUDIO = 'https://worker.test/api/audio';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** Minimal KV stub. `gets` can throw to simulate an outage. */
function kvStub({ value = '0', throws = false, onPut } = {}) {
  return {
    get: async () => {
      if (throws) throw new Error('KV unavailable');
      return value;
    },
    put: async (key, next) => { onPut?.(key, next); },
  };
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('fails closed when the QUOTAS binding is missing', async () => {
  const response = await worker.fetch(new Request(AUDIO), {});
  assert.equal(response.status, 503);
  assert.equal((await readJson(response)).error, 'quota_unavailable');
});

test('fails closed when the KV read throws', async () => {
  const response = await worker.fetch(new Request(AUDIO), { QUOTAS: kvStub({ throws: true }) });
  assert.equal(response.status, 503);
  assert.equal((await readJson(response)).error, 'quota_unavailable');
});

test('rejects with 429 only when the counter is genuinely over the limit', async () => {
  const response = await worker.fetch(new Request(AUDIO), { QUOTAS: kvStub({ value: '3' }) });
  assert.equal(response.status, 429);
  assert.equal((await readJson(response)).error, 'quota_exceeded');
});

test('increments the bucket and proceeds while under the limit', async () => {
  let written;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ lines: [] });
  try {
    const response = await worker.fetch(new Request(AUDIO), {
      QUOTAS: kvStub({ value: '1', onPut: (key, next) => { written = [key, next]; } }),
    });
    // Whatever the downstream audio handler answers, it must not be a quota
    // rejection — the gate let this request through and counted it.
    assert.ok(!['quota_unavailable', 'quota_exceeded'].includes((await readJson(response)).error ?? ''));
    assert.equal(written[1], '2');
    assert.match(written[0], /^asr:guest:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
