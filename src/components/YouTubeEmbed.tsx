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
}

interface YouTubeEmbedProps {
  youtubeId: string;
  startTime?: number;
}

// ── YouTube IFrame API loader ──────────────────────────────
// Tracks whether the API script has been loaded or is loading.
let apiLoadState: 'unloaded' | 'loading' | 'ready' = 'unloaded';
const readyCallbacks: Array<() => void> = [];

function ensureYouTubeAPI(onReady: () => void): void {
  if (apiLoadState === 'ready') {
    onReady();
    return;
  }

  readyCallbacks.push(onReady);

  if (apiLoadState === 'loading') return; // already loading, callback queued

  apiLoadState = 'loading';

  // Set the global callback that YouTube IFrame API calls when ready
  const prevCallback = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (prevCallback) prevCallback();
    apiLoadState = 'ready';
    readyCallbacks.forEach((cb) => cb());
    readyCallbacks.length = 0;
  };

  // Check if the script tag already exists in the DOM
  const existingScript = document.querySelector(
    'script[src*="youtube.com/iframe_api"]',
  );
  if (existingScript) {
    // Script exists but may still be loading — the onYouTubeIframeAPIReady
    // callback will fire once the API finishes loading.
    return;
  }

  // Inject the script tag
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

// ── Component ──────────────────────────────────────────────
const YouTubeEmbed = forwardRef<PlayerHandle, YouTubeEmbedProps>(
  ({ youtubeId, startTime }, ref) => {
    const containerId = useRef(`yt-player-${Math.random().toString(36).slice(2, 9)}`);
    const playerRef = useRef<YT.Player | null>(null);
    const [playerReady, setPlayerReady] = useState(false);

    // Expose imperative methods
    useImperativeHandle(
      ref,
      () => ({
        playVideo: () => playerRef.current?.playVideo(),
        pauseVideo: () => playerRef.current?.pauseVideo(),
        seekTo: (seconds: number) => playerRef.current?.seekTo(seconds, true),
        getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      }),
      [],
    );

    // Create the player once the API is ready
    const createPlayer = useCallback(() => {
      if (playerRef.current) return;
      const el = document.getElementById(containerId.current);
      if (!el) return;

      const opts: YT.PlayerOptions = {
        width: '100%',
        height: '100%',
        videoId: youtubeId,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          ...(startTime !== undefined ? { start: startTime } : {}),
        },
        events: {
          onReady: () => setPlayerReady(true),
        },
      };

      playerRef.current = new YT.Player(el, opts);
    }, [youtubeId, startTime]);

    // Load the API and create the player
    useEffect(() => {
      ensureYouTubeAPI(() => createPlayer());
    }, [createPlayer]);

    // Load a different video when youtubeId changes
    useEffect(() => {
      if (!playerReady || !playerRef.current) return;
      if (startTime !== undefined) {
        playerRef.current.loadVideoById({
          videoId: youtubeId,
          startSeconds: startTime,
        });
      } else {
        playerRef.current.loadVideoById(youtubeId);
      }
    // Only react to youtubeId changes after initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [youtubeId]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
      };
    }, []);

    return (
      <div className="w-full aspect-video rounded-xl overflow-hidden shadow-md bg-black relative">
        <div id={containerId.current} className="w-full h-full" />
        {!playerReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex items-center gap-2 text-white/70 text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading player...
            </div>
          </div>
        )}
      </div>
    );
  },
);

YouTubeEmbed.displayName = 'YouTubeEmbed';

export default YouTubeEmbed;
