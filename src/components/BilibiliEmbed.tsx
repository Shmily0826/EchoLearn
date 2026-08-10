import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';

interface BilibiliEmbedProps {
  bvid: string;
  page?: number;
  startTime?: number;
  /** Total duration in seconds, used to size the sync scrubber. */
  duration?: number;
  playbackRate?: number;
}

const fmtTime = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/**
 * Bilibili player via the official embed iframe.
 *
 * Hard limits vs YouTube:
 *  1. No JS API → we cannot read the real playback position. So we run an
 *     internal "playback clock" that advances while playing, driving the
 *     transcript auto-scroll. It is an estimate (not frame-accurate) and can
 *     drift over long videos; seeking resyncs it.
 *  2. Clicking the iframe navigates the framed document to bilibili.com
 *     (sandbox cannot block iframe self-navigation). So we put a transparent
 *     click-capture layer OVER the iframe (and set pointer-events:none on it)
 *     — clicks never reach the iframe, so it never navigates away. All
 *     interaction goes through our own Play/Pause control + the scrubber.
 *
 * Play/Pause works by reloading the iframe with `autoplay=1|0` so the REAL
 * video starts/stops together with our clock (no "video paused but transcript
 * moving" mismatch).
 */
const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime, duration = 0, playbackRate = 1 }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [playing, setPlaying] = useState(false);
    const lastTickRef = useRef<number>(0);
    const rateRef = useRef(playbackRate);
    rateRef.current = playbackRate;

    const buildEmbedUrl = useCallback(
      (seekTo?: number, autoplay = 0) => {
        const params = new URLSearchParams({
          bvid,
          high_quality: '1',
          danmaku: '0',
          autoplay: String(autoplay),
        });
        if (page && page > 1) params.set('page', String(page));
        if (seekTo && seekTo > 0) params.set('t', String(Math.floor(seekTo)));
        return `https://player.bilibili.com/player.html?${params.toString()}`;
      },
      [bvid, page],
    );

    const [embedUrl, setEmbedUrl] = useState(() => buildEmbedUrl(startTime, 0));

    // Internal clock — advances `currentTime` while playing, driving the
    // transcript auto-scroll (Bilibili exposes no real time).
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

    // Reload the iframe when the video itself changes.
    useEffect(() => {
      setEmbedUrl(buildEmbedUrl(startTime, 0));
      setCurrentTime(startTime || 0);
      setPlaying(false);
    }, [bvid, startTime, buildEmbedUrl]);

    const togglePlay = useCallback(() => {
      const next = !playing;
      setPlaying(next);
      // Reload so the REAL video plays/pauses in sync with the clock.
      setEmbedUrl(buildEmbedUrl(currentTime, next ? 1 : 0));
    }, [playing, currentTime, buildEmbedUrl]);

    // Scrubber: live drag updates `currentTime` (transcript follows immediately).
    const handleScrub = (t: number) => setCurrentTime(t);
    // Scrubber release: actually seek the real iframe.
    const handleScrubCommit = (t: number) => {
      setCurrentTime(t);
      setEmbedUrl(buildEmbedUrl(t, playing ? 1 : 0));
    };

    useImperativeHandle(
      ref,
      () => ({
        playVideo() {
          setPlaying(true);
          setEmbedUrl(buildEmbedUrl(currentTime, 1));
        },
        pauseVideo() {
          setPlaying(false);
          setEmbedUrl(buildEmbedUrl(currentTime, 0));
        },
        seekTo(seconds: number) {
          setCurrentTime(seconds);
          setEmbedUrl(buildEmbedUrl(seconds, playing ? 1 : 0));
        },
        getCurrentTime() {
          return currentTime;
        },
        setPlaybackRate(_r: number) {
          /* not controllable on the Bilibili embed */
        },
        getPlaybackRate() {
          return playbackRate;
        },
      }),
      [currentTime, playing, buildEmbedUrl, playbackRate],
    );

    return (
      <div className="w-full">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="absolute inset-0 w-full h-full rounded-xl bg-black pointer-events-none"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-fullscreen allow-popups"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            scrolling="no"
            frameBorder="0"
            title="Bilibili video player"
          />
          {/* Click-capture layer: the iframe never receives clicks, so it
              cannot navigate away to bilibili.com. A single click toggles
              play/pause. */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            onClick={togglePlay}
            title={playing ? 'Pause' : 'Play (syncs transcript)'}
          />
          {/* Visible play/pause control — also drives transcript sync */}
          <button
            type="button"
            onClick={togglePlay}
            title={playing ? 'Pause' : 'Play (syncs transcript)'}
            className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-white text-xs font-medium shadow-lg backdrop-blur hover:bg-black/80 transition-colors cursor-pointer"
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
        </div>
        {duration > 0 && (
          <div className="mt-2 flex items-center gap-2 px-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums w-10 text-right">
              {fmtTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={1}
              value={Math.min(currentTime, duration)}
              onChange={(e) => handleScrub(Number(e.target.value))}
              onMouseUp={(e) => handleScrubCommit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => handleScrubCommit(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => handleScrubCommit(Number((e.target as HTMLInputElement).value))}
              className="flex-1 accent-indigo-500 cursor-pointer"
              aria-label="Drag to sync transcript with the video"
            />
            <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums w-10">
              {fmtTime(duration)}
            </span>
          </div>
        )}
      </div>
    );
  },
);

BilibiliEmbed.displayName = 'BilibiliEmbed';
export default BilibiliEmbed;
