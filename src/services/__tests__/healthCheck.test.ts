import { describe, expect, it, vi } from 'vitest';

// The monitor is an executable .mjs module; its main loop is guarded so these
// tests exercise only its response validator and one-check contract.
import {
  classifyTranscriptAcquisition,
  runCheck,
  validateCaptionResponse,
// @ts-expect-error The monitor is plain JavaScript; this import is test-only.
} from '../../../scripts/health-check.mjs';
// @ts-expect-error The guard is plain JavaScript; this import is test-only.
import { createPaidProviderGuard, resolvePaidProviderPolicy } from '../../../scripts/paid-provider-guard.mjs';

describe('caption pipeline health check', () => {
  it('blocks the paid-capable Vercel check by default before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await runCheck({
        url: 'https://app.test/api/transcript?videoId=control',
        paidProvider: true,
        retries: 0,
      });
      expect(result).toEqual({ ok: false, reason: 'paid provider blocked: explicit opt-in and max-invocations cap are required' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the explicit paid cap and stops before a second request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'provider_timeout' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const guard = createPaidProviderGuard(resolvePaidProviderPolicy({
        ECHOLEARN_ALLOW_PAID_PROVIDER: '1',
        ECHOLEARN_PAID_MAX_INVOCATIONS: '1',
      }));
      const check = {
        url: 'https://app.test/api/transcript?videoId=control',
        paidProvider: true,
        retries: 1,
        validate: validateCaptionResponse,
      };
      const result = await runCheck(check, { paidProviderGuard: guard });
      expect(result).toEqual({ ok: false, reason: 'paid provider invocation cap exceeded (1)' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('requires a non-empty transcript lines array', () => {
    expect(validateCaptionResponse(JSON.stringify({ error: 'provider_timeout' }))).toBe('response has no transcript lines');
    expect(validateCaptionResponse(JSON.stringify({ lines: [] }))).toBe('response has no transcript lines');
    expect(validateCaptionResponse(JSON.stringify({ lines: [{ text: 'caption' }] }))).toBeNull();
  });

  it('does not treat HTTP 200 JSON errors as healthy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'provider_timeout' }), { status: 200 })));
    const result = await runCheck({
      url: 'https://worker.test/api/transcript?videoId=control',
      timeoutMs: 1000,
      retries: 0,
      validate: validateCaptionResponse,
    });
    expect(result).toEqual({ ok: false, reason: 'response has no transcript lines' });
    vi.unstubAllGlobals();
  });

  it('requires exactly HTTP 200 even when the body has lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ lines: [{ text: 'caption' }] }), { status: 201 })));
    const result = await runCheck({
      url: 'https://worker.test/api/transcript?videoId=control',
      timeoutMs: 1000,
      retries: 0,
      validate: validateCaptionResponse,
    });
    expect(result).toEqual({ ok: false, reason: 'HTTP 201' });
    vi.unstubAllGlobals();
  });

  it.each([
    ['HIT', { cacheState: 'HIT', acquisitionEvidence: 'cache_hit' }],
    ['MISS', { cacheState: 'MISS', acquisitionEvidence: 'cache_miss_before_acquisition' }],
    ['BYPASS', { cacheState: 'BYPASS', acquisitionEvidence: 'cache_bypassed' }],
    [undefined, { cacheState: 'UNKNOWN', acquisitionEvidence: 'not_observable' }],
    ['invalid', { cacheState: 'UNKNOWN', acquisitionEvidence: 'not_observable' }],
  ])('keeps cache/acquisition evidence bounded for %s', (header, expected) => {
    expect(classifyTranscriptAcquisition(header)).toEqual(expected);
  });

  it('reports a Worker cache miss as acquisition evidence without retaining the URL or body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      lines: [{ text: 'caption' }],
    }), {
      status: 200,
      headers: { 'X-EchoLearn-Transcript-Cache': 'MISS' },
    })));

    try {
      const result = await runCheck({
        url: 'https://worker.test/api/transcript?videoId=synthetic-control',
        timeoutMs: 1000,
        retries: 0,
        transcript: true,
        validate: validateCaptionResponse,
      });

      expect(result).toMatchObject({
        ok: true,
        attempt: 1,
        cacheState: 'MISS',
        acquisitionEvidence: 'cache_miss_before_acquisition',
      });
      expect(result).not.toHaveProperty('url');
      expect(JSON.stringify(result)).not.toContain('caption');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('labels a fixed successful control with no cache header as not observable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      lines: [{ text: 'caption' }],
    }), { status: 200 })));

    try {
      const result = await runCheck({
        url: 'https://worker.test/api/transcript?videoId=synthetic-fixed-control',
        timeoutMs: 1000,
        retries: 0,
        transcript: true,
        validate: validateCaptionResponse,
      });

      expect(result).toMatchObject({
        ok: true,
        cacheState: 'UNKNOWN',
        acquisitionEvidence: 'not_observable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
