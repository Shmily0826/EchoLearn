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
}

// ── YouTube IFrame API singleton loader ─────────────────────
let apiReady = false;
let apiLoading = false;
let apiLoadAttempts = 0;
const apiWaiters: Array<() => void> = [];

function loadYouTubeAPI(onReady: () => void): void {
  if (apiReady) { onReady(); return; }
  apiWaiters.push(onReady);
  if (apiLoading) return;

  apiLoading = true;
  apiLoadAttempts++;

  window.onYouTubeIframeAPIReady = () => {
    apiReady = true;
    apiLoading = false;
    const cbs = apiWaiters.splice(0);
    cbs.forEach((cb) => cb());
  };

  // Remove any stale script tags
  document
    .querySelectorAll('script[src*="youtube.com/iframe_api"]')
    .forEach((el) => el.remove());

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.async = true;

  tag.onerror = () => {
    apiLoading = false;
    if (apiLoadAttempts < 3) {
      setTimeout(() => {
        const cbs = apiWaiters.splice(0);
        cbs.forEach((cb) => loadYouTubeAPI(cb));
      }, 2000 * apiLoadAttempts);
    }
  };

  document.head.appendChild(tag);

  // Safety timeout — if API never calls onYouTubeIframeAPIReady
  setTimeout(() => {
    if (!apiReady && apiLoading) {
      apiLoading = false;
      if (apiLoadAttempts < 3) {
        setTimeout(() => {
          const cbs = apiWaiters.splice(0);
          cbs.forEach((cb) => loadYouTubeAPI(cb));
        }, 2000 * apiLoadAttempts);
      }
    }
  }, 15_000);
}

// ── Component ──────────────────────────────────────────────
const YouTubeEmbed = forwardRef<PlayerHandle, YouTubeEmbedProps>(
  ({ youtubeId, startTime }, ref) => {
    const containerId = useRef(`yt-${Math.random().toString(36).slice(2, 9)}`);
    const playerRef = useRef<YT.Player | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const statusRef = useRef(status);
    statusRef.current = status;
    const startTimeRef = useRef(startTime);
    startTimeRef.current = startTime;
    const retryCount = useRef(0);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Create the player — only depends on youtubeId (startTime read from ref)
    const initPlayer = useCallback(() => {
      if (playerRef.current) return;
      const el = document.getElementById(containerId.current);
      if (!el) return;

      try {
        playerRef.current = new YT.Player(el, {
          width: '100%',
          height: '100%',
          videoId: youtubeId,
          playerVars: {
            modestbranding: 1,
            rel: 0,
            cc_load_policy: 0,
            ...(startTimeRef.current !== undefined ? { start: startTimeRef.current } : {}),
          },
          events: {
            onReady: () => {
              // If we already gave up, destroy this late-arriving player
              if (statusRef.current === 'error') {
                try { playerRef.current?.destroy(); } catch { /* ignore */ }
                playerRef.current = null;
                return;
              }
              retryCount.current = 0;
              setStatus('ready');
            },
            onError: (e: { data: number }) => {
              // Error codes:
              //   2   = invalid videoId (usually permanent)
              //   5   = HTML5 player error (transient)
              //   100 = video not found (permanent)
              //   101/150 = embed not allowed (permanent)
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
                // Give up — make sure the player is destroyed so iframe stops
                if (playerRef.current) {
                  try { playerRef.current.destroy(); } catch { /* ignore */ }
                  playerRef.current = null;
                }
                setStatus('error');
              }
            },
          },
        });
      } catch {
        setStatus('error');
      }
    }, [youtubeId]);

    // Mount: load API → create player
    useEffect(() => {
      let cancelled = false;

      loadYouTubeAPI(() => {
        if (cancelled) return;
        initPlayer();
      });

      // Fallback: use ref to avoid stale closure — checks REAL current status
      const timer = setTimeout(() => {
        if (!cancelled && statusRef.current === 'loading') {
          setStatus('error');
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
          // Probe the player — if it throws or returns undefined, it's dead
          const state = playerRef.current.getPlayerState?.();
          if (state === undefined || state === -1) {
            // Player is dead — destroy and re-create
            try { playerRef.current.destroy(); } catch { /* ignore */ }
            playerRef.current = null;
            setStatus('loading');
            retryCount.current = 0;
            loadYouTubeAPI(() => initPlayer());
          }
        } catch {
          // Player threw — it's broken
          try { playerRef.current?.destroy(); } catch { /* ignore */ }
          playerRef.current = null;
          setStatus('loading');
          retryCount.current = 0;
          loadYouTubeAPI(() => initPlayer());
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [status, initPlayer]);

    // Load different video when youtubeId changes
    useEffect(() => {
      if (status !== 'ready' || !playerRef.current) return;
      if (startTime !== undefined) {
        playerRef.current.loadVideoById({
          videoId: youtubeId,
          startSeconds: startTime,
        });
      } else {
        playerRef.current.loadVideoById(youtubeId);
      }
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
      setStatus('loading');
      retryCount.current = 0;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      loadYouTubeAPI(() => initPlayer());
    };

    return (
      <div className="w-full aspect-video rounded-xl overflow-hidden shadow-md bg-black relative">
        <div id={containerId.current} className="w-full h-full" />

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
