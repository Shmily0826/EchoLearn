import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';

interface BilibiliEmbedProps {
  bvid: string;
  page?: number;
  startTime?: number;
}

/**
 * Bilibili video player using the official embed iframe.
 *
 * Limitations vs YouTube:
 * - No real-time currentTime polling (Bilibili iframe has no JS API)
 * - seekTo reloads the iframe with a new `t` parameter
 * - Auto-scroll transcript sync does not work; user clicks timestamps to seek
 */
const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [playing, setPlaying] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Build the embed URL
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

    // Approximate timer while "playing" (incremental — not real playback time)
    useEffect(() => {
      if (playing) {
        timerRef.current = setInterval(() => {
          setCurrentTime((prev) => prev + 1);
        }, 1000);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
      }
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [playing]);

    // When bvid changes, reload the iframe
    useEffect(() => {
      setEmbedUrl(buildEmbedUrl(startTime));
      setCurrentTime(startTime || 0);
      setPlaying(false);
    }, [bvid, startTime, buildEmbedUrl]);

    useImperativeHandle(ref, () => ({
      playVideo() {
        setPlaying(true);
        // Try postMessage play command (may not work on all Bilibili player versions)
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ type: 'play' }),
          '*',
        );
      },
      pauseVideo() {
        setPlaying(false);
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ type: 'pause' }),
          '*',
        );
      },
      seekTo(seconds: number) {
        setPlaying(false);
        setCurrentTime(seconds);
        // Reload iframe with the new seek time
        setEmbedUrl(buildEmbedUrl(seconds));
      },
      getCurrentTime() {
        return currentTime;
      },
    }), [currentTime, buildEmbedUrl]);

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
      </div>
    );
  },
);

BilibiliEmbed.displayName = 'BilibiliEmbed';
export default BilibiliEmbed;
