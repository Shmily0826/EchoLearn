/**
 * Single normative vocabulary for wire-level caption/transcript error codes.
 *
 * The same codes are currently (re-)defined independently in the client
 * services, the Vercel handlers, the CF Worker, and the VPS. This module is
 * the in-repo source of truth for the client/Vercel side; the CF Worker
 * (plain JS) and the VPS (Python) cannot import it, so
 * `src/services/__tests__/captionErrorContract.test.ts` pins all definition
 * sites against this list.
 *
 * Normative document: docs/CAPTION_ERROR_CONTRACT.md.
 */

export const CAPTION_ERROR_CODES = {
  CAPTIONS_NOT_FOUND: 'captions_not_found',
  PROVIDER_TIMEOUT: 'provider_timeout',
  PROVIDER_FAILURE: 'provider_failure',
  YOUTUBE_ACQUISITION_BLOCKED: 'youtube_acquisition_blocked',
  TRANSCRIPT_DISABLED: 'transcript_disabled',
  ASR_REQUIRED: 'asr_required',
  RATE_LIMIT: 'rate_limit',
  INVALID_REQUEST: 'invalid_request',
  CLIENT_DISCONNECTED: 'client_disconnected',
} as const;

export type CaptionErrorCode =
  (typeof CAPTION_ERROR_CODES)[keyof typeof CAPTION_ERROR_CODES];

/**
 * Definitive outcomes mean "no captions exist / request is invalid" and must
 * not trigger further fallbacks or ASR offers. Transport outcomes mean "this
 * attempt failed but an independent route may still succeed".
 */
export type CaptionErrorSemantics = 'definitive' | 'transport';

export interface CaptionErrorDescriptor {
  code: CaptionErrorCode;
  /** Conventional HTTP status when a code must be surfaced with one. */
  defaultStatus: number;
  semantics: CaptionErrorSemantics;
  /** Surfaces that may emit this code on the wire. */
  surfaces: ReadonlyArray<'youtube' | 'bilibili' | 'asr'>;
}

export const CAPTION_ERROR_DESCRIPTORS: Readonly<
  Record<CaptionErrorCode, CaptionErrorDescriptor>
> = {
  [CAPTION_ERROR_CODES.CAPTIONS_NOT_FOUND]: {
    code: 'captions_not_found',
    defaultStatus: 404,
    semantics: 'definitive',
    surfaces: ['youtube', 'bilibili', 'asr'],
  },
  [CAPTION_ERROR_CODES.PROVIDER_TIMEOUT]: {
    code: 'provider_timeout',
    defaultStatus: 504,
    semantics: 'transport',
    surfaces: ['youtube', 'bilibili', 'asr'],
  },
  [CAPTION_ERROR_CODES.PROVIDER_FAILURE]: {
    code: 'provider_failure',
    defaultStatus: 502,
    semantics: 'transport',
    surfaces: ['youtube', 'bilibili', 'asr'],
  },
  [CAPTION_ERROR_CODES.YOUTUBE_ACQUISITION_BLOCKED]: {
    code: 'youtube_acquisition_blocked',
    defaultStatus: 403,
    semantics: 'definitive',
    surfaces: ['youtube', 'asr'],
  },
  [CAPTION_ERROR_CODES.TRANSCRIPT_DISABLED]: {
    code: 'transcript_disabled',
    defaultStatus: 404,
    semantics: 'definitive',
    surfaces: ['youtube'],
  },
  [CAPTION_ERROR_CODES.ASR_REQUIRED]: {
    code: 'asr_required',
    defaultStatus: 409,
    semantics: 'transport',
    surfaces: ['youtube', 'bilibili', 'asr'],
  },
  [CAPTION_ERROR_CODES.RATE_LIMIT]: {
    code: 'rate_limit',
    defaultStatus: 429,
    semantics: 'transport',
    surfaces: ['bilibili'],
  },
  [CAPTION_ERROR_CODES.INVALID_REQUEST]: {
    code: 'invalid_request',
    defaultStatus: 400,
    semantics: 'definitive',
    surfaces: ['bilibili'],
  },
  [CAPTION_ERROR_CODES.CLIENT_DISCONNECTED]: {
    code: 'client_disconnected',
    defaultStatus: 499,
    semantics: 'transport',
    surfaces: ['youtube', 'bilibili', 'asr'],
  },
};

export const CAPTION_ERROR_CODE_LIST: readonly CaptionErrorCode[] = Object.values(
  CAPTION_ERROR_CODES,
);

export function isCaptionErrorCode(value: unknown): value is CaptionErrorCode {
  return (
    typeof value === 'string'
    && (CAPTION_ERROR_CODE_LIST as readonly string[]).includes(value)
  );
}
