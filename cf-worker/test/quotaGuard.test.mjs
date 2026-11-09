import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const AUDIO = 'https://worker.test/api/audio?url=https%3A%2F%2Fyoutu.be%2Fexample1234';
const VPS_ENV = { YTDLP_API_URL: 'https://vps.test' };
const AUDIO_BYTES = [10, 20, 30, 40, 50, 60];

function audioResponse() {
  return new Response(Uint8Array.from(AUDIO_BYTES), { headers: { 'Content-Type': 'audio/mpeg' } });
}

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
  const upstream = t.mock.method(globalThis, 'fetch', async () => audioResponse());
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

test('concurrent cold ranges share one origin fetch and one quota debit', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => {
    await new Promise(setImmediate);
    return audioResponse();
  });
  const put = t.mock.fn(async () => {});
  const env = { ...VPS_ENV, QUOTAS: { get: async () => '0', put } };

  const responses = await Promise.all(['bytes=0-1', 'bytes=4-5'].map((Range) =>
    worker.fetch(new Request(AUDIO, { headers: { Range } }), env)));

  assert.equal(upstream.mock.callCount(), 1);
  assert.equal(put.mock.callCount(), 1);
  assert.deepEqual(responses.map((res) => res.status), [206, 206]);
  assert.deepEqual(responses.map((res) => res.headers.get('X-Cache')).sort(), ['COALESCED', 'MISS']);
  assert.deepEqual(responses.map((res) => res.headers.get('Content-Range')), ['bytes 0-1/6', 'bytes 4-5/6']);
  assert.deepEqual(await Promise.all(responses.map(async (res) => [...new Uint8Array(await res.arrayBuffer())])),
    [[10, 20], [50, 60]]);
});

test('a concurrent caller can load audio when the first caller is out of quota', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => audioResponse());
  const put = t.mock.fn(async () => {});
  const env = { ...VPS_ENV, QUOTAS: {
    get: async (key) => key.includes('192.0.2.1:') ? '3' : '0',
    put,
  } };
  const [denied, allowed] = await Promise.all(['192.0.2.1', '192.0.2.2'].map((ip) =>
    worker.fetch(new Request(AUDIO, { headers: { 'cf-connecting-ip': ip } }), env)));

  assert.equal(denied.status, 429);
  assert.equal(allowed.status, 200);
  assert.deepEqual([...new Uint8Array(await allowed.arrayBuffer())], AUDIO_BYTES);
  assert.equal(upstream.mock.callCount(), 1);
  assert.equal(put.mock.callCount(), 1);
});

test('a failed origin fetch releases the audio key for a later retry', async (t) => {
  mockAudioCache(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => audioResponse());
  upstream.mock.mockImplementationOnce(async () => new Response('unavailable', { status: 503 }));
  const env = { ...VPS_ENV, QUOTAS: { get: async () => '0', put: async () => {} } };

  const failed = await worker.fetch(new Request(AUDIO), env);
  assert.equal(failed.status, 502);
  const retried = await worker.fetch(new Request(AUDIO), env);
  assert.equal(retried.status, 200);
  assert.deepEqual([...new Uint8Array(await retried.arrayBuffer())], AUDIO_BYTES);
  assert.equal(upstream.mock.callCount(), 2);
});

for (const { name, ranges } of [
  { name: 'suffix ranges', ranges: [
    ['bytes=-2', 'bytes 4-5/6', [50, 60]],
    ['bytes=-999999999999999999999', 'bytes 0-5/6', AUDIO_BYTES],
  ] },
  { name: 'ranges extending beyond EOF', ranges: [
    ['bytes=4-99', 'bytes 4-5/6', [50, 60]],
    ['bytes=4-', 'bytes 4-5/6', [50, 60]],
  ] },
]) {
  test(`serves the requested bytes for ${name}`, async (t) => {
    mockAudioCache(t);
    const upstream = t.mock.method(globalThis, 'fetch', async () => audioResponse());
    const env = { ...VPS_ENV, QUOTAS: { get: async () => '0', put: async () => {} } };

    for (const [Range, contentRange, bytes] of ranges) {
      const response = await worker.fetch(new Request(AUDIO, { headers: { Range } }), env);
      assert.equal(response.status, 206, Range);
      assert.equal(response.headers.get('Content-Range'), contentRange);
      assert.equal(response.headers.get('Content-Length'), String(bytes.length));
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], bytes);
    }
    for (const Range of ['bytes=6-', 'bytes=-0']) {
      const response = await worker.fetch(new Request(AUDIO, { headers: { Range } }), env);
      assert.equal(response.status, 416, Range);
      assert.equal(response.headers.get('Content-Range'), 'bytes */6');
    }
    assert.equal(upstream.mock.callCount(), 1);
  });
}
