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
 * Hard limits vs YouTube: the Bilibili embed has no JS API, so we cannot read
 * the real playback position, and clicking the iframe can navigate the tab
 * away to bilibili.com. Two consequences:
 *
 *  1. We do NOT run a fake "playback clock" — that was the old approach and it
 *     drifted / desynced (video paused but transcript kept moving). Instead the
 *     user syncs transcript ↔ video with the scrubber rendered below the
 *     player: dragging it updates `currentTime` (drives the transcript
 *     highlight/scroll) AND seeks the real iframe (debounced reload with `t=`).
 *     Both are always driven by the same value, so they never drift apart.
 *  2. The iframe is sandboxed WITHOUT top-navigation, so clicking it no longer
 *     jumps to bilibili.com while native play/pause/seek/volume controls still
 *     work.
 */
const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime, duration = 0, playbackRate = 1 }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

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

    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [embedUrl, setEmbedUrl] = useState(() => buildEmbedUrl(startTime));

    // Reload the iframe when the video itself changes.
    useEffect(() => {
      setEmbedUrl(buildEmbedUrl(startTime));
      setCurrentTime(startTime || 0);
    }, [bvid, startTime, buildEmbedUrl]);

    // Scrubber: live drag updates `currentTime` (transcript follows immediately).
    const handleScrub = (t: number) => setCurrentTime(t);
    // Scrubber release: actually seek the real iframe by reloading with `t=`.
    const handleScrubCommit = (t: number) => {
      setCurrentTime(t);
      setEmbedUrl(buildEmbedUrl(t));
    };

    useImperativeHandle(
      ref,
      () => ({
        // Native Bilibili controls handle actual playback; these are no-ops.
        playVideo() {},
        pauseVideo() {},
        seekTo(seconds: number) {
          setCurrentTime(seconds);
          setEmbedUrl(buildEmbedUrl(seconds));
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
      [currentTime, buildEmbedUrl, playbackRate],
    );

    return (
      <div className="w-full">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="absolute inset-0 w-full h-full rounded-xl bg-black"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-fullscreen allow-popups"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            scrolling="no"
            frameBorder="0"
            title="Bilibili video player"
          />
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
