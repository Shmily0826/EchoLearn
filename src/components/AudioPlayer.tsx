import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';

export type AudioStatus = 'loading' | 'ready' | 'error';

interface AudioPlayerProps {
  /** Audio stream URL (served by the CF Worker → VPS yt-dlp /api/audio). */
  src: string;
  startTime?: number;
  playbackRate?: number;
  /** Reports load state so the parent can show toasts / analytics. */
  onStatusChange?: (status: AudioStatus, error?: string) => void;
}

const fmtTime = (s: number) => {
  const total = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/**
 * Audio-only player used by the app's "audio mode" toggle.
 *
 * It implements the same PlayerHandle contract as YouTubeEmbed / BilibiliEmbed,
 * so the existing transcript-sync loop (StudyPage polls getCurrentTime() every
 * 100ms) works unchanged — the transcript scrolls in sync exactly like the
 * YouTube player, but with no iframe, no black-screen-on-control, and no dead
 * buttons. Seeking, playback rate, and play/pause all map directly onto the
 * native <audio> element.
 */
const AudioPlayer = forwardRef<PlayerHandle, AudioPlayerProps>(
  ({ src, startTime, playbackRate = 1, onStatusChange }, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [currentTime, setCurrentTime] = useState(startTime || 0);
    const [duration, setDuration] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [status, setStatus] = useState<AudioStatus>('loading');

    const setAudioStatus = useCallback(
      (s: AudioStatus, err?: string) => {
        setStatus(s);
        onStatusChange?.(s, err);
      },
      [onStatusChange],
    );

    // Reset state whenever the source changes (e.g. switching videos).
    useEffect(() => {
      setCurrentTime(startTime || 0);
      setDuration(0);
      setPlaying(false);
      setAudioStatus('loading');
    }, [src, startTime, setAudioStatus]);

    // Apply playback rate to the live element.
    useEffect(() => {
      const el = audioRef.current;
      if (el && playbackRate !== 1) el.playbackRate = playbackRate;
    }, [playbackRate]);

    const togglePlay = useCallback(() => {
      const el = audioRef.current;
      if (!el) return;
      if (el.paused) el.play().catch(() => { /* autoplay/network blocked — ignore */ });
      else el.pause();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        playVideo() {
          audioRef.current?.play().catch(() => { /* ignore */ });
        },
        pauseVideo() {
          audioRef.current?.pause();
        },
        seekTo(seconds: number) {
          const el = audioRef.current;
          if (el) el.currentTime = seconds;
        },
        getCurrentTime() {
          return audioRef.current?.currentTime ?? 0;
        },
        setPlaybackRate(rate: number) {
          const el = audioRef.current;
          if (el) el.playbackRate = rate;
        },
        getPlaybackRate() {
          return audioRef.current?.playbackRate ?? 1;
        },
      }),
      [],
    );

    // Retry: clear the element and force a reload by re-setting the src.
    const handleRetry = () => {
      const el = audioRef.current;
      if (el) {
        el.load();
      }
      setAudioStatus('loading');
    };

    return (
      <div className="w-full flex flex-col gap-3 rounded-xl bg-gradient-to-br from-indigo-50 to-white dark:from-slate-800 dark:to-slate-900 border border-indigo-100 dark:border-slate-700 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            disabled={status !== 'ready'}
            title={playing ? 'Pause' : 'Play'}
            className="flex items-center justify-center w-11 h-11 rounded-full bg-indigo-600 text-white shadow-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
          >
            {playing ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
              <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-3c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zM9 10l12-3" />
              </svg>
              Audio mode
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
              Listen only — transcript scrolls in sync
            </p>
          </div>

          {status === 'loading' && (
            <span className="ml-auto flex items-center gap-2 text-[11px] text-indigo-500 dark:text-indigo-300">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Preparing…
            </span>
          )}
        </div>

        {status === 'error' ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span className="flex-1">Audio failed to load.</span>
            <button
              type="button"
              onClick={handleRetry}
              className="px-2 py-0.5 text-xs rounded bg-red-200 dark:bg-red-800/50 text-red-800 dark:text-red-200 hover:bg-red-300 dark:hover:bg-red-700/60 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums w-10 text-right">
              {fmtTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCurrentTime(v);
                if (audioRef.current) audioRef.current.currentTime = v;
              }}
              className="flex-1 accent-indigo-500 cursor-pointer"
              aria-label="Seek audio"
            />
            <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums w-10">
              {fmtTime(duration)}
            </span>
          </div>
        )}

        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          className="hidden"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            setDuration(el.duration || 0);
            if (startTime && startTime > 0) {
              try { el.currentTime = startTime; } catch { /* ignore */ }
            }
            setCurrentTime(el.currentTime);
            setAudioStatus('ready');
          }}
          onCanPlay={() => setAudioStatus('ready')}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setAudioStatus('error', 'Audio failed to load')}
        />
      </div>
    );
  },
);

AudioPlayer.displayName = 'AudioPlayer';
export default AudioPlayer;
