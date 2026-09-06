import { describe, expect, it } from 'vitest';
import youtubeTranscriptSource from '../youtubeTranscript.ts?raw';
import bilibiliTranscriptSource from '../bilibiliTranscript.ts?raw';
import apiTranscriptSource from '../../../api/transcript.ts?raw';
import apiBilibiliSource from '../../../api/bilibili.ts?raw';
import workerSource from '../../../cf-worker/src/index.js?raw';
import vpsSource from '../../../vps-ytdlp/main.py?raw';
import {
  CAPTION_ERROR_CODE_LIST,
  CAPTION_ERROR_DESCRIPTORS,
  isCaptionErrorCode,
} from '../captionErrorContract';

/**
 * Drift guard for the caption error-code contract (docs/CAPTION_ERROR_CONTRACT.md).
 *
 * The wire vocabulary is defined independently in four runtimes (client TS,
 * Vercel TS, CF Worker JS, VPS Python). These tests pin every definition site
 * against the canonical module so a code added or renamed on one surface
 * without updating the contract fails here.
 */

/** Resolves `const NAME = 'value';` string constants declared in a file. */
function resolveFileConstants(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/const ([A-Z_0-9]+) = '([a-z_0-9]+)';/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

/**
 * Extracts the string values of a `const NAME = { ... } as const;` block,
 * resolving values that reference file-level constants (e.g.
 * `ACQUISITION_BLOCKED: YOUTUBE_ACQUISITION_BLOCKED`).
 */
function extractObjectValues(source: string, objectName: string): string[] {
  const start = source.indexOf(`const ${objectName} = {`);
  expect(start, `definition of ${objectName} found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('} as const', start);
  expect(end, `closing of ${objectName} found`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const constants = resolveFileConstants(source);
  const values: string[] = [];
  for (const match of body.matchAll(/'([a-z_0-9]+)'/g)) {
    values.push(match[1]);
  }
  for (const match of body.matchAll(/:\s*([A-Z_0-9]+)\s*[,}]/g)) {
    const resolved = constants.get(match[1]);
    if (resolved) values.push(resolved);
  }
  return values;
}

function expectSameMembers(actual: string[], expected: string[], label: string): void {
  expect([...actual].sort(), label).toEqual([...expected].sort());
}

const WIRE = {
  captions_not_found: 'captions_not_found',
  provider_timeout: 'provider_timeout',
  provider_failure: 'provider_failure',
  youtube_acquisition_blocked: 'youtube_acquisition_blocked',
  transcript_disabled: 'transcript_disabled',
  asr_required: 'asr_required',
  rate_limit: 'rate_limit',
  invalid_request: 'invalid_request',
  client_disconnected: 'client_disconnected',
} as const;

describe('caption error code contract module', () => {
  it('has a unique descriptor entry for every code', () => {
    const codes = CAPTION_ERROR_CODE_LIST;
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      const descriptor = CAPTION_ERROR_DESCRIPTORS[code];
      expect(descriptor.code).toBe(code);
      expect(Number.isInteger(descriptor.defaultStatus)).toBe(true);
      expect(['definitive', 'transport']).toContain(descriptor.semantics);
      expect(descriptor.surfaces.length).toBeGreaterThan(0);
    }
  });

  it('maps only contract codes with isCaptionErrorCode', () => {
    expect(isCaptionErrorCode('provider_timeout')).toBe(true);
    expect(isCaptionErrorCode('not_a_code')).toBe(false);
    expect(isCaptionErrorCode(null)).toBe(false);
  });
});

describe('client definition sites', () => {
  it('youtubeTranscript TRANSCRIPT_ERROR_CODES matches the contract subset', () => {
    const values = extractObjectValues(
      youtubeTranscriptSource,
      'TRANSCRIPT_ERROR_CODES',
    );
    expectSameMembers(values, [
      WIRE.captions_not_found,
      WIRE.youtube_acquisition_blocked,
      WIRE.provider_timeout,
      WIRE.transcript_disabled,
      WIRE.asr_required,
    ], 'client YouTube codes');
    for (const value of values) {
      expect(isCaptionErrorCode(value), `${value} is a contract code`).toBe(true);
    }
  });

  it('bilibiliTranscript BILIBILI_ERROR_CODES matches the contract subset', () => {
    const values = extractObjectValues(
      bilibiliTranscriptSource,
      'BILIBILI_ERROR_CODES',
    );
    expectSameMembers(values, [
      WIRE.captions_not_found,
      WIRE.asr_required,
      WIRE.provider_timeout,
      WIRE.provider_failure,
      WIRE.rate_limit,
      WIRE.invalid_request,
    ], 'client Bilibili codes');
  });
});

describe('Vercel definition sites', () => {
  it('api/transcript TRANSCRIPT_FAILURE_CODES matches the contract subset', () => {
    const values = extractObjectValues(
      apiTranscriptSource,
      'TRANSCRIPT_FAILURE_CODES',
    );
    expectSameMembers(values, [
      WIRE.captions_not_found,
      WIRE.youtube_acquisition_blocked,
      WIRE.provider_timeout,
      WIRE.transcript_disabled,
      WIRE.asr_required,
      WIRE.provider_failure,
    ], 'Vercel transcript codes');
  });

  it('api/bilibili BILIBILI_ERROR_CODES matches the contract subset', () => {
    const start = apiBilibiliSource.indexOf('const BILIBILI_ERROR_CODES = new Set([');
    expect(start, 'Vercel Bilibili Set found').toBeGreaterThanOrEqual(0);
    const end = apiBilibiliSource.indexOf(']);', start);
    expect(end).toBeGreaterThan(start);
    const values = [...apiBilibiliSource.slice(start, end).matchAll(/'([a-z_0-9]+)'/g)]
      .map((match) => match[1]);
    expectSameMembers(values, [
      WIRE.captions_not_found,
      WIRE.asr_required,
      WIRE.provider_timeout,
      WIRE.provider_failure,
      WIRE.rate_limit,
    ], 'Vercel Bilibili codes');
  });
});

describe('CF Worker definition site (plain JS; pinned by presence)', () => {
  it('emits every YouTube wire code it owns', () => {
    for (const code of [
      WIRE.captions_not_found,
      WIRE.provider_timeout,
      WIRE.provider_failure,
      WIRE.asr_required,
      WIRE.youtube_acquisition_blocked,
    ]) {
      expect(workerSource.includes(`'${code}'`), `Worker emits ${code}`).toBe(true);
    }
  });

  it('emits every Bilibili wire code it owns', () => {
    for (const code of [
      WIRE.captions_not_found,
      WIRE.asr_required,
      WIRE.provider_timeout,
      WIRE.provider_failure,
      WIRE.rate_limit,
      WIRE.invalid_request,
    ]) {
      expect(workerSource.includes(`'${code}'`), `Worker emits ${code}`).toBe(true);
    }
  });
});

describe('VPS definition site (Python; pinned by presence)', () => {
  it('emits every wire code it owns', () => {
    for (const code of [
      WIRE.captions_not_found,
      WIRE.provider_timeout,
      WIRE.provider_failure,
      WIRE.client_disconnected,
      WIRE.youtube_acquisition_blocked,
    ]) {
      expect(vpsSource.includes(`"${code}"`), `VPS emits ${code}`).toBe(true);
    }
  });
});

describe('measurement vocabulary (archived)', () => {
  // The transcriptOutcomeMeasurement module was archived on
  // research/architecture-consolidation-archive (commit b5cf7bd) because it
  // has no production consumer. When a reliability-baseline runner revives
  // it, this suite must be extended to pin its vocabulary against the
  // contract again.
  it('keeps measurement-only codes out of the wire contract', () => {
    for (const code of ['success', 'cancelled', 'invalid_input', 'auth_failure', 'rate_limited']) {
      expect(isCaptionErrorCode(code), `${code} is not a wire code`).toBe(false);
    }
  });
});
