import { useEffect, useRef, useState, type RefObject } from 'react';
import type { VideoPlatform } from '../types';
import type { PlayerHandle } from '../components/YouTubeEmbed';
export interface PlaybackPositionOptions {
  playerRef: RefObject<PlayerHandle | null>;
  videoId: string | null;
  platform: VideoPlatform;
  audioMode: boolean;
  onPositionChange: (position: number) => void;
}

/** Owns the player clock, resume persistence, and playback-rate preference. */
export function usePlaybackPosition({
  playerRef,
  videoId,
  platform,
  audioMode,
  onPositionChange,
}: PlaybackPositionOptions) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(
    () => Number(localStorage.getItem('echolearn_playback_rate')) || 1,
  );
  const [speedToast, setSpeedToast] = useState(false);
  const lastPosSaveRef = useRef(0);
  const speedToastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Bilibili's native iframe exposes no trustworthy playback clock. Audio
    // mode is its only supported caption-sync transport.
    //
    // The player handle is deliberately NOT part of the guard: on a restored
    // session the source (a blob URL, or an extracted audio stream) resolves
    // after this effect first runs, so requiring the handle here started the
    // clock never — currentTime stayed 0, no line was highlighted, and the
    // transcript stopped scrolling for the whole lesson. The tick below skips
    // its own beat until the handle exists.
    if (!videoId || (platform === 'bilibili' && !audioMode)) return;
    const id = setInterval(() => {
      if (!playerRef.current) return;
      try {
        const time = playerRef.current.getCurrentTime();
        setCurrentTime(time);
        if (Date.now() - lastPosSaveRef.current > 5000 && time > 0) {
          lastPosSaveRef.current = Date.now();
          onPositionChange(Math.floor(time));
        }
      } catch {
        // Player can be destroyed while an iframe is switching videos.
      }
    }, 100);
    return () => clearInterval(id);
  }, [audioMode, onPositionChange, platform, playerRef, videoId]);

  useEffect(() => {
    try {
      playerRef.current?.setPlaybackRate(playbackRate);
    } catch {
      // Player may not be ready yet; the player component reapplies the rate.
    }
    localStorage.setItem('echolearn_playback_rate', String(playbackRate));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeedToast(true);
    if (speedToastTimer.current) clearTimeout(speedToastTimer.current);
    speedToastTimer.current = setTimeout(() => setSpeedToast(false), 1200);
    return () => {
      if (speedToastTimer.current) clearTimeout(speedToastTimer.current);
    };
  }, [playbackRate, playerRef]);

  return { currentTime, playbackRate, setPlaybackRate, speedToast };
}
