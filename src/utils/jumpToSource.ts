/**
 * "Jump back to where I learned this" — shared by the Vocabulary and Sentences
 * pages.
 *
 * Every saved word/sentence already records `sourceVideoId` and the transcript
 * line's start time, so we have everything needed to send the user back to the
 * exact moment in the video.
 *
 * Two cases have to be handled, because all pages stay mounted (display:none)
 * and StudyPage only reloads when the *session id* changes:
 *
 *   1. A different video → write it as the current session (with lastPosition
 *      set to our timestamp) and navigate; StudyPage's existing restore path
 *      picks it up.
 *   2. The same video is already open → no session change, so StudyPage would
 *      ignore it. We emit SEEK_REQUEST_EVENT and StudyPage seeks the live
 *      player directly.
 *
 * We always emit the event: StudyPage keeps it as a pending seek and applies it
 * once the player for that video is ready, which also covers timestamps under
 * the 10s threshold the resume logic ignores.
 */
import type { VideoStudySession } from '../types';
import { loadAllSessions, saveCurrentSession } from './storage';

export const SEEK_REQUEST_EVENT = 'echolearn:seek-request';

export interface SeekRequestDetail {
  videoId: string;
  seconds: number;
}

/** mm:ss for display next to a source label. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Direct YouTube link at a timestamp — used when the session no longer exists. */
export function youtubeUrlAt(videoId: string, seconds?: number): string {
  const t = Math.max(0, Math.floor(seconds ?? 0));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${t > 0 ? `&t=${t}s` : ''}`;
}

export interface JumpResult {
  /** false when the study session was deleted, so the caller can offer YouTube. */
  ok: boolean;
}

/**
 * Open `videoId` in the study page at `seconds`.
 *
 * Returns `{ ok: false }` when no saved session matches the video (the user
 * deleted it); the caller should fall back to `youtubeUrlAt`.
 */
export function jumpToSource(
  videoId: string,
  seconds: number | undefined,
  navigate: (path: string) => void,
): JumpResult {
  if (!videoId) return { ok: false };

  const sessions: VideoStudySession[] = loadAllSessions();
  const session = sessions.find((s) => s.youtubeId === videoId);
  if (!session) return { ok: false };

  const target = Math.max(0, Math.floor(seconds ?? 0));

  // Persist the position so a fresh StudyPage mount resumes at the right spot.
  saveCurrentSession({ ...session, lastPosition: target });

  navigate('/study');

  // Let StudyPage finish switching before we ask the player to seek. The event
  // is also stored as a pending seek there, so an early dispatch is harmless.
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent<SeekRequestDetail>(SEEK_REQUEST_EVENT, {
        detail: { videoId, seconds: target },
      }),
    );
  }, 60);

  return { ok: true };
}
