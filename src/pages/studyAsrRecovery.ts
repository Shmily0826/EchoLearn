import { TRANSCRIPT_ERROR_CODES } from '../services/youtubeTranscript';
import type { TranscriptRecovery } from '../services/youtubeTranscript';

export function shouldOfferAsrRecovery(
  errorCode: string | null,
  asrRecoveryRequested: boolean,
  recovery: TranscriptRecovery | null = null,
): boolean {
  void asrRecoveryRequested;
  return errorCode === TRANSCRIPT_ERROR_CODES.ASR_REQUIRED
    || recovery?.canAsr === true;
}
