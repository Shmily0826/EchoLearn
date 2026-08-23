import type { TranscriptLine, VideoPlatform, VideoStudySession } from '../types';
import { extractUrl } from './urlExtract';

export interface FreshStudySessionInput {
  id: string;
  now: number;
  videoId: string;
  url: string;
  platform: VideoPlatform;
  biliPage?: number;
}

/** Normalize pasted share text without touching persistence or browser state. */
export function normalizeStudyUrl(url: string): string {
  return extractUrl(url) ?? url;
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
): VideoStudySession {
  return {
    ...session,
    transcriptLines: [...rawBlocks],
    transcriptData: {
      rawBlocks: [...rawBlocks],
      sentenceLines: [...sentenceLines],
    },
    updatedAt,
  };
}
