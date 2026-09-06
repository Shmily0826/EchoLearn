import { BILIBILI_ERROR_CODES } from '../services/bilibiliTranscript';
import { TRANSCRIPT_ERROR_CODES } from '../services/youtubeTranscript';

/**
 * Classify only an explicit no-caption outcome as "no captions" in Study.
 * Legacy message matching is retained for older untyped Bilibili paths.
 */
export function isNoCaptionsError(
  captionErrorCode: string | null,
  captionError: string | null,
): boolean {
  return (
    captionErrorCode === TRANSCRIPT_ERROR_CODES.CAPTIONS_NOT_FOUND ||
    captionErrorCode === BILIBILI_ERROR_CODES.CAPTIONS_NOT_FOUND ||
    (!captionErrorCode && /^No captions\/subtitles available/i.test(captionError?.trim() ?? ''))
  );
}
