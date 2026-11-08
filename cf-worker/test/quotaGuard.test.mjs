import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const AUDIO = 'https://worker.test/api/audio?url=https%3A%2F%2Fyoutu.be%2Fexample1234';
const VPS_ENV = { YTDLP_API_URL: 'https://vps.test' };

function mockAudioCache(t) {
  const entries = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => { entries.set(key.url, response.clone()); },
  } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'caches', original);
    else delete globalThis.caches;
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('fails closed on an audio cache miss when the QUOTAS binding is missing', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected VPS call'); });
  const response = await worker.fetch(new Request(AUDIO), VPS_ENV);
  assert.equal(response.status, 503);
  assert.equal((await readJson(response)).error, 'quota_unavailable');
  assert.equal(upstream.mock.callCount(), 0);
});

test('fails closed on an audio cache miss when the KV read throws', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected VPS call'); });
  const response = await worker.fetch(new Request(AUDIO), {
    ...VPS_ENV,
    QUOTAS: { get: async () => { throw new Error('KV unavailable'); } },
  });
  assert.equal(response.status, 503);
  assert.equal((await readJson(response)).error, 'quota_unavailable');
  assert.equal(upstream.mock.callCount(), 0);
});

test('charges an audio cache miss once and serves later byte ranges even at the daily limit', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () =>
    new Response(Uint8Array.from([10, 20, 30, 40, 50, 60]), { headers: { 'Content-Type': 'audio/mpeg' } }));
  const writes = [];
  let quota = '2';
  const quotaRead = t.mock.fn(async () => quota);
  const env = { ...VPS_ENV, QUOTAS: {
    get: quotaRead,
    put: async (key, next) => { writes.push([key, next]); quota = next; },
  } };

  for (const [index, start] of [0, 2, 4, 0].entries()) {
    const end = start + 1;
    const response = await worker.fetch(new Request(AUDIO, { headers: { Range: `bytes=${start}-${end}` } }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/6`);
    assert.equal(response.headers.get('X-Cache'), index === 0 ? 'MISS' : 'HIT');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [(start + 1) * 10, (end + 1) * 10]);
  }
  assert.equal(quotaRead.mock.callCount(), 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /^asr:guest:/);
  assert.equal(writes[0][1], '3');
  assert.equal(upstream.mock.callCount(), 1);

  const uncached = await worker.fetch(new Request(AUDIO.replace('example1234', 'another1234')), env);
  assert.equal(uncached.status, 429);
  assert.equal((await readJson(uncached)).error, 'quota_exceeded');
  assert.equal(upstream.mock.callCount(), 1);
  assert.equal(writes.length, 1);
});
