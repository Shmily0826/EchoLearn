import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';

// ── Public handle exposed via ref ──────────────────────────
export interface PlayerHandle {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
}

interface YouTubeEmbedProps {
  youtubeId: string;
  startTime?: number;
  playbackRate?: number;
}

// ── YouTube IFrame API singleton loader ─────────────────────
let apiReady = false;
let apiLoading = false;
let apiLoadAttempts = 0;
let apiFailed = false;
const apiWaiters: Array<(ok: boolean) => void> = [];

function loadYouTubeAPI(onReady: (ok: boolean) => void): void {
  if (apiReady) { onReady(true); return; }
  if (apiFailed) { onReady(false); return; }
  apiWaiters.push(onReady);
  if (apiLoading) return;

  apiLoading = true;
  apiLoadAttempts++;

  window.onYouTubeIframeAPIReady = () => {
    apiReady = true;
    apiLoading = false;
    const cbs = apiWaiters.splice(0);
    cbs.forEach((cb) => cb(true));
  };

  // Remove any stale script tags
  document
    .querySelectorAll('script[src*="youtube.com/iframe_api"]')
    .forEach((el) => el.remove());

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.async = true;

  const failWaiters = () => {
    apiLoading = false;
    if (apiLoadAttempts >= 3) {
      apiFailed = true;
      const cbs = apiWaiters.splice(0);
      cbs.forEach((cb) => cb(false));
      return;
    }
    setTimeout(() => {
      const cbs = apiWaiters.splice(0);
      cbs.forEach((cb) => loadYouTubeAPI(cb));
    }, 2000 * apiLoadAttempts);
  };

  tag.onerror = () => failWaiters();

  document.head.appendChild(tag);

  // Safety timeout — if API never calls onYouTubeIframeAPIReady
  setTimeout(() => {
    if (!apiReady && apiLoading) {
      failWaiters();
    }
  }, 15_000);
}

// Reset API state for full retry
function resetAPIState(): void {
  apiReady = false;
  apiLoading = false;
  apiLoadAttempts = 0;
  apiFailed = false;
}

// ── Component ──────────────────────────────────────────────
const YouTubeEmbed = forwardRef<PlayerHandle, YouTubeEmbedProps>(
  ({ youtubeId, startTime, playbackRate }, ref) => {
    const containerId = useRef(`yt-${Math.random().toString(36).slice(2, 9)}`);
    const playerRef = useRef<YT.Player | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'fallback'>('loading');
    const statusRef = useRef(status);
    statusRef.current = status;
    const startTimeRef = useRef(startTime);
    startTimeRef.current = startTime;
    const playbackRateRef = useRef(playbackRate ?? 1);
    playbackRateRef.current = playbackRate ?? 1;
    const retryCount = useRef(0);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Capture the initial videoId in a ref so initPlayer doesn't depend on it
    const initialVideoIdRef = useRef(youtubeId);

    useImperativeHandle(
      ref,
      () => ({
        playVideo: () => { try { playerRef.current?.playVideo(); } catch { /* noop */ } },
        pauseVideo: () => { try { playerRef.current?.pauseVideo(); } catch { /* noop */ } },
        seekTo: (seconds: number) => { try { playerRef.current?.seekTo(seconds, true); } catch { /* noop */ } },
        getCurrentTime: () => { try { return playerRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; } },
        setPlaybackRate: (rate: number) => {
          try { (playerRef.current as any)?.setPlaybackRate?.(rate); } catch { /* noop */ }
        },
        getPlaybackRate: () => {
          try { return (playerRef.current as any)?.getPlaybackRate?.() ?? 1; } catch { return 1; }
        },
      }),
      [],
    );

    // Create the player — only runs once (initial videoId from ref)
    const initPlayer = useCallback(() => {
      if (playerRef.current) return;
      const el = document.getElementById(containerId.current);
      if (!el) return;

      try {
        playerRef.current = new YT.Player(el, {
          width: '100%',
          height: '100%',
          videoId: initialVideoIdRef.current,
          playerVars: {
            modestbranding: 1,
            rel: 0,
            cc_load_policy: 0,
            ...(startTimeRef.current !== undefined ? { start: startTimeRef.current } : {}),
          },
          events: {
            onReady: () => {
              if (statusRef.current === 'error' || statusRef.current === 'fallback') {
                try { playerRef.current?.destroy(); } catch { /* ignore */ }
                playerRef.current = null;
                return;
              }
              retryCount.current = 0;
              // Apply saved playback rate now that the player is ready
              try {
                const rate = playbackRateRef.current;
                if (rate !== 1) {
                  (playerRef.current as any)?.setPlaybackRate?.(rate);
                }
              } catch { /* noop */ }
              setStatus('ready');
            },
            onError: (e: { data: number }) => {
              const isPermanent = [2, 100, 101, 150].includes(e.data);
              if (!isPermanent && retryCount.current < 3) {
                retryCount.current++;
                if (playerRef.current) {
                  try { playerRef.current.destroy(); } catch { /* ignore */ }
                  playerRef.current = null;
                }
                retryTimer.current = setTimeout(() => {
                  initPlayer();
                }, 2000 * retryCount.current);
              } else {
                if (playerRef.current) {
                  try { playerRef.current.destroy(); } catch { /* ignore */ }
                  playerRef.current = null;
                }
                setStatus('fallback');
              }
            },
          },
        });
      } catch {
        setStatus('fallback');
      }
    }, []);

    // Mount: load API → create player or fallback
    useEffect(() => {
      let cancelled = false;

      loadYouTubeAPI((ok) => {
        if (cancelled) return;
        if (ok) {
          initPlayer();
        } else {
          setStatus('fallback');
        }
      });

      const timer = setTimeout(() => {
        if (!cancelled && statusRef.current === 'loading') {
          setStatus('fallback');
        }
      }, 30_000);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        // Destroy old player so initPlayer() can create a new one on re-mount
        if (playerRef.current) {
          try { playerRef.current.destroy(); } catch { /* ignore */ }
          playerRef.current = null;
        }
      };
    }, [initPlayer]);

    // ── Visibility change recovery ─────────────────────────────
    // When the tab becomes visible again after being hidden (e.g. user
    // switched tabs, computer woke from sleep), check if the player is
    // still responsive. If not, auto-retry.
    useEffect(() => {
      const handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return;
        if (status !== 'ready' || !playerRef.current) return;

        try {
          const state = playerRef.current.getPlayerState?.();
          if (state === undefined || state === -1) {
            try { playerRef.current.destroy(); } catch { /* ignore */ }
            playerRef.current = null;
            setStatus('loading');
            retryCount.current = 0;
            loadYouTubeAPI((ok) => { if (ok) initPlayer(); else setStatus('fallback'); });
          }
        } catch {
          try { playerRef.current?.destroy(); } catch { /* ignore */ }
          playerRef.current = null;
          setStatus('loading');
          retryCount.current = 0;
          loadYouTubeAPI((ok) => { if (ok) initPlayer(); else setStatus('fallback'); });
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [status, initPlayer]);

    // Load different video when youtubeId changes (player already created)
    useEffect(() => {
      if (status !== 'ready' || !playerRef.current) return;
      if (typeof playerRef.current.loadVideoById !== 'function') return;
      try {
        if (startTime !== undefined) {
          playerRef.current.loadVideoById({
            videoId: youtubeId,
            startSeconds: startTime,
          });
        } else {
          playerRef.current.loadVideoById(youtubeId);
        }
      } catch { /* player not ready — noop */ }
      // Re-apply playback rate after loadVideoById (YouTube resets it)
      setTimeout(() => {
        try {
          const rate = playbackRateRef.current;
          if (rate !== 1) {
            (playerRef.current as any)?.setPlaybackRate?.(rate);
          }
        } catch { /* noop */ }
      }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [youtubeId]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        if (playerRef.current) {
          try { playerRef.current.destroy(); } catch { /* ignore */ }
          playerRef.current = null;
        }
      };
    }, []);

    const handleRetry = () => {
      resetAPIState();
      setStatus('loading');
      retryCount.current = 0;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      loadYouTubeAPI((ok) => { if (ok) initPlayer(); else setStatus('fallback'); });
    };

    // Build fallback iframe URL
    const fallbackSrc = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1${
      startTime !== undefined ? `&start=${Math.floor(startTime)}` : ''
    }`;

    return (
      <div className="w-full aspect-video rounded-xl overflow-hidden shadow-md bg-black relative">
        {status !== 'fallback' && (
          <div id={containerId.current} className="w-full h-full" />
        )}

        {status === 'fallback' && (
          <iframe
            src={fallbackSrc}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube video player"
          />
        )}

        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
            <svg className="animate-spin h-5 w-5 text-white/60" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-white/60 text-sm">Loading player...</span>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-white/70 text-sm">Failed to load YouTube player.</p>
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 text-sm bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  },
);

YouTubeEmbed.displayName = 'YouTubeEmbed';

export default YouTubeEmbed;
