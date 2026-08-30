import { describe, expect, it } from 'vitest';
import { shouldOfferAsrRecovery } from '../studyAsrRecovery';

describe('Study explicit ASR recovery contract', () => {
  it('offers ASR for a structured recoverable timeout without relabeling it', () => {
    expect(shouldOfferAsrRecovery('asr_required', false)).toBe(true);
    expect(shouldOfferAsrRecovery('provider_timeout', false, { canAsr: true, requiresExplicitOptIn: true })).toBe(true);
    expect(shouldOfferAsrRecovery('provider_timeout', false)).toBe(false);
    expect(shouldOfferAsrRecovery('captions_not_found', false)).toBe(false);
    expect(shouldOfferAsrRecovery('transcript_disabled', false)).toBe(false);
  });

  it('keeps the explicit ASR action available after an ASR failure', () => {
    expect(shouldOfferAsrRecovery('provider_timeout', true, { canAsr: true, requiresExplicitOptIn: true })).toBe(true);
    expect(shouldOfferAsrRecovery(null, true)).toBe(false);
  });

  it('does not offer ASR after a normal caption retry or dismissal', () => {
    expect(shouldOfferAsrRecovery(null, false)).toBe(false);
    expect(shouldOfferAsrRecovery('provider_timeout', false)).toBe(false);
  });
});
