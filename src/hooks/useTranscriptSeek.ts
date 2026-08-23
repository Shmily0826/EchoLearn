import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { TranscriptLine } from '../types';
import type { PlayerHandle } from '../components/YouTubeEmbed';
import { SEEK_REQUEST_EVENT, type SeekRequestDetail } from '../utils/jumpToSource';

interface TranscriptSeekOptions {
  playerRef: RefObject<PlayerHandle | null>;
  videoId: string | null;
  pathname: string;
  currentTime: number;
  displayLines: TranscriptLine[];
}

/** Owns transcript line activation and cross-page/deep-link seeking. */
export function useTranscriptSeek({
  playerRef,
  videoId,
  pathname,
  currentTime,
  displayLines,
}: TranscriptSeekOptions) {
  const pendingSeekRef = useRef<SeekRequestDetail | null>(null);

  useEffect(() => {
    const handleSeekRequest = (event: Event) => {
      const detail = (event as CustomEvent<SeekRequestDetail>).detail;
      if (detail?.videoId) pendingSeekRef.current = detail;
    };
    window.addEventListener(SEEK_REQUEST_EVENT, handleSeekRequest);
    return () => window.removeEventListener(SEEK_REQUEST_EVENT, handleSeekRequest);
  }, []);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const pending = pendingSeekRef.current;
      if (pending?.videoId === videoId && playerRef.current) {
        playerRef.current.seekTo(pending.seconds);
        playerRef.current.playVideo();
        pendingSeekRef.current = null;
        return;
      }
      if (++attempts < 40) {
        window.setTimeout(tick, 150);
      } else if (pending?.videoId === videoId) {
        pendingSeekRef.current = null;
      }
    };
    const id = window.setTimeout(tick, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [pathname, playerRef, videoId]);

  const activeLineIndex = useMemo(() => {
    for (let i = 0; i < displayLines.length; i++) {
      if (currentTime >= displayLines[i].start && currentTime < displayLines[i].end) return i;
    }
    return -1;
  }, [currentTime, displayLines]);

  const seekTo = useCallback((seconds: number, scrollTranscript = false) => {
    playerRef.current?.seekTo(seconds);
    playerRef.current?.playVideo();
    if (!scrollTranscript) return;
    const index = displayLines.findIndex((line) => seconds >= line.start && seconds < line.end);
    const target = index >= 0 ? index : displayLines.findIndex((line) => line.start >= seconds);
    if (target < 0) return;
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-transcript-line="${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, [displayLines, playerRef]);

  return { activeLineIndex, seekTo };
}
