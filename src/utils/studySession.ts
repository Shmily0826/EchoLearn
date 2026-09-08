import type {
  CaptionDiagnostics,
  TranscriptLine,
  VideoPlatform,
  VideoStudySession,
} from '../types';
import { extractUrl } from './urlExtract';

export interface FreshStudySessionInput {
  id: string;
  now: number;
  videoId: string;
  url: string;
  platform: VideoPlatform;
  biliPage?: number;
}

export interface TranscriptProvenance {
  source?: string;
  diagnostics?: CaptionDiagnostics;
}

/** Normalize pasted share text without touching persistence or browser state. */
export function normalizeStudyUrl(url: string): string {
  return extractUrl(url) ?? url;
}

/** Only persisted transcript data with usable line content counts as restored. */
export function hasUsableTranscriptData(
  transcriptData: VideoStudySession['transcriptData'],
): boolean {
  return Boolean(
    transcriptData &&
      Array.isArray(transcriptData.rawBlocks) &&
      Array.isArray(transcriptData.sentenceLines) &&
      (transcriptData.rawBlocks.length > 0 || transcriptData.sentenceLines.length > 0),
  );
}

/** A session is safe to persist once it has at least one usable transcript line. */
export function hasUsableSessionTranscript(
  session: Pick<VideoStudySession, 'transcriptLines' | 'transcriptData'>,
): boolean {
  return (session.transcriptLines?.length ?? 0) > 0 || hasUsableTranscriptData(session.transcriptData);
}

/** Build a new empty session from already-parsed video identity data. */
export function createFreshStudySession({
  id,
  now,
  videoId,
  url,
  platform,
  biliPage,
}: FreshStudySessionInput): VideoStudySession {
  return {
    id,
    youtubeUrl: normalizeStudyUrl(url),
    youtubeId: videoId,
    platform,
    ...(biliPage !== undefined ? { biliPage } : {}),
    title: normalizeStudyUrl(url),
    transcriptLines: [],
    transcriptData: { rawBlocks: [], sentenceLines: [] },
    createdAt: now,
    updatedAt: now,
    status: 'studying',
    lastPosition: 0,
  };
}

/** Attach both current and legacy transcript representations immutably. */
export function attachTranscriptToSession(
  session: VideoStudySession,
  rawBlocks: TranscriptLine[],
  sentenceLines: TranscriptLine[],
  updatedAt: number,
  provenance?: TranscriptProvenance,
): VideoStudySession {
  return {
    ...session,
    transcriptLines: [...rawBlocks],
    transcriptData: {
      rawBlocks: [...rawBlocks],
      sentenceLines: [...sentenceLines],
    },
    captionSource: provenance?.source,
    captionDiagnostics: provenance?.diagnostics,
    updatedAt,
  };
}
