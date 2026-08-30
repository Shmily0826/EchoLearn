import { TRANSCRIPT_ERROR_CODES } from '../services/youtubeTranscript';

export function shouldOfferAsrRecovery(errorCode: string | null, asrRecoveryRequested: boolean): boolean {
  return errorCode === TRANSCRIPT_ERROR_CODES.ASR_REQUIRED || asrRecoveryRequested;
}
