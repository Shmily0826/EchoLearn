import { describe, expect, it } from 'vitest';
import { BILIBILI_ERROR_CODES } from '../../services/bilibiliTranscript';
import { TRANSCRIPT_ERROR_CODES } from '../../services/youtubeTranscript';
import { isNoCaptionsError } from '../studyCaptionError';

describe('Study caption error classification', () => {
  it('recognises typed YouTube and Bilibili no-caption outcomes', () => {
    expect(isNoCaptionsError(TRANSCRIPT_ERROR_CODES.CAPTIONS_NOT_FOUND, 'provider text')).toBe(true);
    expect(isNoCaptionsError(BILIBILI_ERROR_CODES.CAPTIONS_NOT_FOUND, 'provider text')).toBe(true);
  });

  it('does not relabel typed provider failures or timeouts as no captions', () => {
    expect(isNoCaptionsError(BILIBILI_ERROR_CODES.PROVIDER_FAILURE, 'No captions/subtitles available')).toBe(false);
    expect(isNoCaptionsError(TRANSCRIPT_ERROR_CODES.PROVIDER_TIMEOUT, 'No captions/subtitles available')).toBe(false);
  });

  it('keeps the legacy message fallback only when no typed code exists', () => {
    expect(isNoCaptionsError(null, 'No captions/subtitles available for this video')).toBe(true);
    expect(isNoCaptionsError(null, 'Unable to fetch captions for this video')).toBe(false);
  });
});
