import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { YTDLP_API_URL: 'https://vps.test', YTDLP_API_KEY: 'server-key' };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('local audio forwards multipart to VPS with only the server key', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://vps.test/api/audio-transcribe');
    assert.equal(init.headers['X-Api-Key'], 'server-key');
    forwarded = init.body.get('file');
    return json({ lines: [{ start: 0, end: 1, text: 'hello' }] });
  };
  try {
    const form = new FormData();
    form.append('file', new File(['RIFF'], 'lesson.wav', { type: 'audio/wav' }));
    const response = await worker.fetch(new Request('https://worker.test/api/audio-transcribe', {
      method: 'POST', body: form, headers: { 'X-Api-Key': 'browser-key' },
    }), env);
    assert.equal(response.status, 200);
    assert.equal(forwarded.name, 'lesson.wav');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local audio rejects unsupported files before contacting VPS', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not call VPS'); };
  try {
    const form = new FormData();
    form.append('file', new File(['text'], 'lesson.txt', { type: 'text/plain' }));
    const response = await worker.fetch(new Request('https://worker.test/api/audio-transcribe', { method: 'POST', body: form }), env);
    assert.equal(response.status, 415);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
