import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = providerMocks;
  },
}));

import handler from '../../../api/ai';

type MockResponse = {
  statusCode?: number;
  headers: Record<string, string>;
  writes: Uint8Array[];
  ended: boolean;
  setHeader(name: string, value: string): void;
  write(chunk: Uint8Array): boolean;
  end(chunk?: string | Uint8Array): void;
};

function makeResponse(): MockResponse {
  const response: MockResponse = {
    headers: {},
    writes: [],
    ended: false,
    setHeader(name, value) {
      response.headers[name.toLowerCase()] = value;
    },
    write(chunk) {
      response.writes.push(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) {
        response.writes.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      }
      response.ended = true;
    },
  };
  return response;
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    url: '/api/ai',
    headers: {
      host: 'echo-learn.uk',
      'content-type': 'application/json',
      origin: 'https://echo-learn.uk',
      ...headers,
    },
    body,
  };
}

function responseText(response: MockResponse): string {
  return new TextDecoder().decode(
    response.writes.reduce((all, chunk) => {
      const merged = new Uint8Array(all.length + chunk.length);
      merged.set(all);
      merged.set(chunk, all.length);
      return merged;
    }, new Uint8Array()),
  );
}

const normalBody = {
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Say hello' }],
  max_tokens: 32,
};

describe('/api/ai Node runtime boundary', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.DEEPSEEK_API_KEY;
    providerMocks.generateContent.mockReset();
    providerMocks.generateContentStream.mockReset();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    vi.unstubAllGlobals();
  });

  it('handles Node-style headers and writes a normal Gemini response', async () => {
    providerMocks.generateContent.mockResolvedValue({ text: 'hello from Gemini' });
    const response = makeResponse();

    await handler(makeRequest(normalBody, { 'x-forwarded-for': '203.0.113.10' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(response.headers['access-control-allow-origin']).toBe('https://echo-learn.uk');
    expect(JSON.parse(responseText(response)).choices[0].message.content).toBe('hello from Gemini');
    expect(response.ended).toBe(true);
  });

  it('preserves structured JSON output through the Node response boundary', async () => {
    providerMocks.generateContent.mockResolvedValue({ text: '{"ok":true,"word":"serendipity","level":"C1"}' });
    const response = makeResponse();

    await handler(makeRequest({ ...normalBody, response_format: { type: 'json_object' } }), response);

    const body = JSON.parse(responseText(response));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ ok: true, word: 'serendipity', level: 'C1' });
    expect(providerMocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ responseMimeType: 'application/json' }),
    }));
  });

  it('writes incremental SSE chunks and closes with DONE', async () => {
    providerMocks.generateContentStream.mockResolvedValue((async function* () {
      yield { text: 'hello ' };
      yield { text: 'stream' };
    })());
    const response = makeResponse();

    await handler(makeRequest({ ...normalBody, stream: true }), response);

    const body = responseText(response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(body).toContain('"content":"hello "');
    expect(body).toContain('"content":"stream"');
    expect(body).toContain('data: [DONE]');
    expect(response.writes.length).toBeGreaterThanOrEqual(3);
    expect(response.ended).toBe(true);
  });

  it('returns controlled errors for malformed and oversized Node bodies', async () => {
    const malformed = makeResponse();
    await handler(makeRequest('{not-json}'), malformed);
    expect(malformed.statusCode).toBe(400);

    const oversized = makeResponse();
    await handler(makeRequest('x'.repeat(100 * 1024 + 1)), oversized);
    expect(oversized.statusCode).toBe(413);
    expect(responseText(oversized)).toContain('Request body too large');
  });

  it('handles OPTIONS without requiring a provider key', async () => {
    delete process.env.GEMINI_API_KEY;
    const response = makeResponse();

    await handler({ method: 'OPTIONS', url: '/api/ai', headers: { origin: 'https://echo-learn.uk' } }, response);

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://echo-learn.uk');
    expect(response.ended).toBe(true);
  });

  it('requires only the selected provider key', async () => {
    providerMocks.generateContent.mockResolvedValue({ text: 'gemini works without DeepSeek' });
    const geminiResponse = makeResponse();
    await handler(makeRequest(normalBody), geminiResponse);
    expect(geminiResponse.statusCode).toBe(200);

    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const defaultResponse = makeResponse();
    await handler(makeRequest(normalBody, { 'x-forwarded-for': '203.0.113.11' }), defaultResponse);
    expect(defaultResponse.statusCode).toBe(500);
    expect(responseText(defaultResponse)).toContain('AI service not configured');

    process.env.AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'deepseek works' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const deepSeekResponse = makeResponse();
    await handler(makeRequest(normalBody, { 'x-forwarded-for': '203.0.113.12' }), deepSeekResponse);
    expect(deepSeekResponse.statusCode).toBe(200);
    expect(JSON.parse(responseText(deepSeekResponse)).choices[0].message.content).toBe('deepseek works');
    expect(providerMocks.generateContent).toHaveBeenCalledTimes(1);
  });
});
