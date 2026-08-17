import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';
import { useI18n } from '../i18n/I18nContext';

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
 *     (sandbox cannot block iframe self-navigation). So by default we put a
 *     transparent click-capture layer OVER the iframe — clicks never reach it,
 *     so it never navigates away. Our own Play/Pause + scrubber drive playback.
 *
 * Native controls (volume / 倍速 / 清晰度 / 全屏): because the capture layer
 * blocks every click, the real control bar is visible but untouchable — most
 * painfully, a muted-by-default video can never be unmuted. To fix that the
 * user can toggle "控制条" (top-right): the capture layer drops away and the
 * real bar becomes fully clickable; tap again ("完成") to re-lock. While
 * unlocked, native play/seek would desync our clock, so the hint steers the
 * user back to the synced controls. The lock state resets on every video
 * change and on reload (Bilibili remembers the unmuted volume per-browser, so
 * unmuting once sticks).
 *
 * Play/Pause works by reloading the iframe with `autoplay=1|0` so the REAL
 * video starts/stops together with our clock (no "video paused but transcript
 * moving" mismatch).
 */
const BV_RE = /^BV[a-zA-Z0-9]{10}$/i;

const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime, duration = 0, playbackRate = 1 }, ref) => {
    const { t } = useI18n();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [playing, setPlaying] = useState(false);
    // When true, the click-capture layer is lifted so the native Bilibili
    // control bar (volume/speed/quality/fullscreen) is clickable.
    const [controlsUnlocked, setControlsUnlocked] = useState(false);
    const [showCoach, setShowCoach] = useState(false);
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
        // Always pass the part number; for multi-part videos the embed can
        // fail to resolve the right page if p is omitted.
        params.set('page', String(page && page > 0 ? page : 1));
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
      setControlsUnlocked(false);
    }, [bvid, startTime, buildEmbedUrl]);

    // ── Visibility recovery ───────────────────────────────────
    // When the app/tab returns to the foreground (user switched away and back,
    // or the phone woke from sleep), the cross-origin Bilibili player iframe is
    // often left blank/frozen by the OS (especially iOS WKWebView). Reload it at
    // the current position so the video reappears instead of staying invisible.
    useEffect(() => {
      const handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return;
        setEmbedUrl((prev) => {
          // Rebuild to force a fresh iframe load; bumping the URL query ensures
          // the browser doesn't serve a stale/blank frame from cache.
          const reloaded = buildEmbedUrl(currentTime, playing ? 1 : 0);
          return prev === reloaded ? `${reloaded}&_v=${Date.now()}` : reloaded;
        });
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [currentTime, playing, buildEmbedUrl]);

    // First-time coachmark: nudge users toward the Native mode once.
    useEffect(() => {
      try {
        if (!localStorage.getItem('echolearn_bili_coach_v1')) setShowCoach(true);
      } catch {}
    }, []);
    const dismissCoach = useCallback(() => {
      setShowCoach(false);
      try { localStorage.setItem('echolearn_bili_coach_v1', '1'); } catch {}
    }, []);

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

    const bvidValid = BV_RE.test(bvid);

    return (
      <div className="w-full">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          {bvidValid ? (
            <iframe
              ref={iframeRef}
              src={embedUrl}
              className={`absolute inset-0 w-full h-full rounded-xl bg-black ${controlsUnlocked ? '' : 'pointer-events-none'}`}
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              scrolling="no"
              frameBorder="0"
              referrerPolicy="origin"
              title="Bilibili video player"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-black text-center px-4">
              <p className="text-sm text-white/80 mb-1">{t('study.biliInvalidId')}</p>
              <p className="text-xs text-white/50">{bvid || '(empty)'}</p>
            </div>
          )}
          {/* Click-capture layer (locked mode): the iframe never receives
              clicks, so it cannot navigate away to bilibili.com. A single
              click toggles our synced play/pause. Removed while unlocked so
              the native control bar becomes usable. */}
          {!controlsUnlocked && (
            <div
              className="absolute inset-0 z-10 cursor-pointer"
              onClick={togglePlay}
              title={playing ? 'Pause' : 'Play (syncs transcript)'}
            />
          )}
          {/* Visible play/pause control — also drives transcript sync. Hidden
              while unlocked so it doesn't cover the native bar. */}
          {!controlsUnlocked && (
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
          )}
          {/* Mode switch — Sync (EchoLearn-synced, locked) vs Native (Bilibili
              bar, unlocked). Always on top so the active mode is never ambiguous. */}
          <div className="absolute top-2.5 right-2.5 z-30 flex rounded-full bg-black/70 p-0.5 text-[11px] font-medium shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={() => setControlsUnlocked(false)}
              aria-pressed={!controlsUnlocked}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                !controlsUnlocked ? 'bg-indigo-600 text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              {t('study.biliModeSync')}
            </button>
            <button
              type="button"
              onClick={() => setControlsUnlocked(true)}
              aria-pressed={controlsUnlocked}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                controlsUnlocked ? 'bg-indigo-600 text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              {t('study.biliModeNative')}
            </button>
          </div>
          {/* First-time coachmark: point users to Native mode once. */}
          {showCoach && (
            <div className="absolute top-12 right-2.5 z-40 max-w-[210px] rounded-lg bg-indigo-600 px-3 py-2 text-[11px] leading-snug text-white shadow-xl">
              {t('study.biliCoachmark')}
              <button
                type="button"
                onClick={dismissCoach}
                className="mt-1 block text-white/90 underline underline-offset-2"
              >
                {t('study.biliCoachOk')}
              </button>
            </div>
          )}
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
        <p className="mt-1 px-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">
          {t('study.biliControlsHint')}
        </p>
      </div>
    );
  },
);

BilibiliEmbed.displayName = 'BilibiliEmbed';
export default BilibiliEmbed;
