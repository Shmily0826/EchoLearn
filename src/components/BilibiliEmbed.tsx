import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';

interface BilibiliEmbedProps {
  bvid: string;
  page?: number;
  startTime?: number;
  playbackRate?: number;
}

/**
 * Bilibili video player using the official embed iframe.
 *
 * Limitations vs YouTube:
 * - The Bilibili embed iframe has no JS API, so we cannot read the real
 *   playback position. To keep the transcript auto-scroll in sync we run an
 *   internal "playback clock" that advances while the user is playing (driven
 *   by the play/pause control rendered below). It is an estimate — not
 *   frame-accurate — and pauses when the user seeks or presses pause.
 * - seekTo reloads the iframe with a new `t` parameter.
 */
const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime, playbackRate = 1 }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [playing, setPlaying] = useState(false);
    const lastTickRef = useRef<number>(0);
    const rateRef = useRef(playbackRate);
    rateRef.current = playbackRate;

    const buildEmbedUrl = useCallback((seekTo?: number) => {
      const params = new URLSearchParams({
        bvid,
        high_quality: '1',
        danmaku: '0',
        autoplay: '0',
      });
      if (page && page > 1) params.set('page', String(page));
      if (seekTo && seekTo > 0) params.set('t', String(Math.floor(seekTo)));
      return `https://player.bilibili.com/player.html?${params.toString()}`;
    }, [bvid, page]);

    const [embedUrl, setEmbedUrl] = useState(() => buildEmbedUrl(startTime));

    const postToIframe = useCallback((msg: object) => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), '*');
    }, []);

    // Internal playback clock — advances `currentTime` in real time (scaled by
    // playback rate) while "playing". This is what drives the transcript
    // auto-scroll, since the iframe gives us no real time updates.
    useEffect(() => {
      if (!playing) return;
      lastTickRef.current = Date.now();
      const id = setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        setCurrentTime((prev) => prev + delta * rateRef.current);
      }, 250);
      return () => clearInterval(id);
    }, [playing]);

    // When bvid changes, reload the iframe
    useEffect(() => {
      setEmbedUrl(buildEmbedUrl(startTime));
      setCurrentTime(startTime || 0);
      setPlaying(false);
    }, [bvid, startTime, buildEmbedUrl]);

    const togglePlay = useCallback(() => {
      setPlaying((p) => {
        const next = !p;
        postToIframe({ type: next ? 'play' : 'pause' });
        return next;
      });
    }, [postToIframe]);

    useImperativeHandle(ref, () => ({
      playVideo() {
        setPlaying(true);
        postToIframe({ type: 'play' });
      },
      pauseVideo() {
        setPlaying(false);
        postToIframe({ type: 'pause' });
      },
      seekTo(seconds: number) {
        // keep the current play state across the reload
        setCurrentTime(seconds);
        setEmbedUrl(buildEmbedUrl(seconds));
      },
      getCurrentTime() {
        return currentTime;
      },
      setPlaybackRate(_rate: number) {
        // applied via the playbackRate prop (rateRef) for the clock only
      },
      getPlaybackRate() {
        return rateRef.current;
      },
    }), [currentTime, buildEmbedUrl, postToIframe]);

    return (
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          ref={iframeRef}
          src={embedUrl}
          className="absolute inset-0 w-full h-full rounded-xl"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          scrolling="no"
          frameBorder="0"
          title="Bilibili video player"
        />
        {/* Play/pause control — also drives transcript auto-scroll sync */}
        <button
          type="button"
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play (syncs the transcript)'}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-white text-xs font-medium shadow-lg backdrop-blur hover:bg-black/80 transition-colors cursor-pointer"
        >
          {playing ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {playing ? 'Pause' : 'Play'}
        </button>
        {!playing && (
          <span className="absolute bottom-4 left-24 z-10 text-[11px] text-white/80 bg-black/50 rounded px-2 py-0.5 pointer-events-none">
            Tap Play to sync transcript
          </span>
        )}
      </div>
    );
  },
);

BilibiliEmbed.displayName = 'BilibiliEmbed';
export default BilibiliEmbed;
