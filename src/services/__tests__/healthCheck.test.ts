import { describe, expect, it, vi } from 'vitest';

// The monitor is an executable .mjs module; its main loop is guarded so these
// tests exercise only its response validator and one-check contract.
import {
  classifyTranscriptAcquisition,
  runCheck,
  validateCaptionResponse,
// @ts-expect-error The monitor is plain JavaScript; this import is test-only.
} from '../../../scripts/health-check.mjs';

describe('caption pipeline health check', () => {
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
