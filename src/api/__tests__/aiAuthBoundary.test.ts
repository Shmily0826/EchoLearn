/**
 * /api/ai authentication trust boundary — real verifier end-to-end.
 *
 * These tests exercise the actual `verifyFirebaseIdToken` implementation
 * (signature verification against a stubbed Google JWKS endpoint, plus the
 * Firebase claim checks) through the Node handler. The invariant under test:
 *
 *   an unauthenticated request NEVER reaches the provider call.
 *
 * The provider (@google/genai) is mocked so no real AI traffic can occur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

// Must run before api/_shared/firebaseAuth.ts is imported (ESM import
// hoisting evaluates module constants first).
vi.hoisted(() => {
  process.env.FIREBASE_PROJECT_ID = 'echolearn-test-project';
});

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
import { clearJwksCacheForTests } from '../../../api/_shared/firebaseAuth';

const PROJECT_ID = 'echolearn-test-project';

// ── RSA test keypairs + JWKS stub ─────────────────────────────

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const roguePair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwkFor(key: crypto.KeyObject, kid: string) {
  const jwk = key.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return { kid, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function makeIdToken(claims: Record<string, unknown>, signingKey: crypto.KeyObject = privateKey, kid = 'test-kid'): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signingKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'firebase-user-42',
    auth_time: now - 10,
    iat: now - 10,
    exp: now + 3000,
    ...overrides,
  };
}

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

describe('/api/ai authentication boundary (real verifier)', () => {
  beforeEach(() => {
    clearJwksCacheForTests();
    providerMocks.generateContent.mockReset();
    providerMocks.generateContentStream.mockReset();
    providerMocks.generateContent.mockResolvedValue({ text: 'provider reached' });
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.DEEPSEEK_API_KEY;
    // Stub ONLY the JWKS endpoint; any other outbound fetch is a test failure.
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('service_accounts/v1/jwk/securetoken')) {
        return new Response(
          JSON.stringify({ keys: [jwkFor(publicKey, 'test-kid')] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected outbound fetch in test: ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.FIREBASE_PROJECT_ID;
  });

  async function expectRejected(request: { method: string; url: string; headers: Record<string, string>; body: unknown }) {
    const response = makeResponse();
    await handler(request, response);
    expect(response.statusCode).toBe(401);
    expect(responseText(response)).toContain('Authentication required');
    expect(providerMocks.generateContent).not.toHaveBeenCalled();
    expect(providerMocks.generateContentStream).not.toHaveBeenCalled();
  }

  it('AC4/AC5: anonymous request → 401, provider fetch never happens', async () => {
    await expectRejected(makeRequest(normalBody));
  });

  it('malformed Authorization header → 401, provider untouched', async () => {
    await expectRejected(makeRequest(normalBody, { authorization: 'Bearer' }));
    await expectRejected(makeRequest(normalBody, { authorization: 'Basic dXNlcjpwYXNz' }));
    await expectRejected(makeRequest(normalBody, { authorization: 'Bearer not-a-jwt' }));
  });

  it('signature from an unknown key → 401, provider untouched', async () => {
    const token = makeIdToken(validClaims(), roguePair.privateKey, 'rogue-kid');
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${token}` }));
  });

  it('expired token → 401, provider untouched', async () => {
    const token = makeIdToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${token}` }));
  });

  it('wrong issuer or audience → 401, provider untouched', async () => {
    const wrongIss = makeIdToken(validClaims({ iss: 'https://securetoken.google.com/other-project' }));
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${wrongIss}` }));
    const wrongAud = makeIdToken(validClaims({ aud: 'other-project' }));
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${wrongAud}` }));
  });

  it('missing auth_time → 401, provider untouched', async () => {
    const claims = validClaims();
    delete claims.auth_time;
    const token = makeIdToken(claims);
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${token}` }));
  });

  it('non-numeric auth_time → 401, provider untouched', async () => {
    const asString = makeIdToken(validClaims({ auth_time: 'yesterday' }));
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${asString}` }));
    const asFloatInfinity = makeIdToken(validClaims({ auth_time: Number.POSITIVE_INFINITY }));
    // JSON.stringify drops Infinity → payload has no valid finite number either way.
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${asFloatInfinity}` }));
  });

  it('future auth_time → 401, provider untouched', async () => {
    const token = makeIdToken(validClaims({ auth_time: Math.floor(Date.now() / 1000) + 600 }));
    await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${token}` }));
  });

  it('AC6: valid authenticated token passes the gate and reaches the provider', async () => {
    const token = makeIdToken(validClaims());
    const response = makeResponse();
    await handler(makeRequest(normalBody, { authorization: `Bearer ${token}` }), response);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(responseText(response)).choices[0].message.content).toBe('provider reached');
    expect(providerMocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it('expired JWKS cache + refresh failure → rejected, no stale-key trust', async () => {
    // Fill the cache with a real successful verification.
    const token = makeIdToken(validClaims());
    const ok = makeResponse();
    await handler(makeRequest(normalBody, { authorization: `Bearer ${token}` }), ok);
    expect(ok.statusCode).toBe(200);

    // Advance past the 1h TTL and make Google unreachable.
    vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000 });
    // Only the post-expiry window is under assertion: clear the count from
    // the initial successful (cache-filling) verification.
    providerMocks.generateContent.mockClear();
    try {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('service_accounts/v1/jwk/securetoken')) {
          throw new Error('google unreachable');
        }
        throw new Error(`unexpected outbound fetch in test: ${url}`);
      });
      const stillValidClaims = validClaims({
        iat: Math.floor(Date.now() / 1000) - 10,
        auth_time: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3000,
      });
      const refreshedToken = makeIdToken(stillValidClaims);
      await expectRejected(makeRequest(normalBody, { authorization: `Bearer ${refreshedToken}` }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('expired JWKS cache + successful refresh → replaced cache and accepted', async () => {
    const token = makeIdToken(validClaims());
    const ok = makeResponse();
    await handler(makeRequest(normalBody, { authorization: `Bearer ${token}` }), ok);
    expect(ok.statusCode).toBe(200);

    vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000 });
    try {
      // Fresh claims stamped at the new "now"; the JWKS stub returns the same key.
      const now = Math.floor(Date.now() / 1000);
      const refreshedToken = makeIdToken(validClaims({ iat: now - 10, auth_time: now - 10, exp: now + 3000 }));
      const response = makeResponse();
      await handler(makeRequest(normalBody, { authorization: `Bearer ${refreshedToken}` }), response);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(responseText(response)).choices[0].message.content).toBe('provider reached');
    } finally {
      vi.useRealTimers();
    }
  });
});
