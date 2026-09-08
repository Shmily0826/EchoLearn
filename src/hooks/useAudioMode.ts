import { useEffect, useMemo, useState } from 'react';
import { extractUrl } from '../utils/urlExtract';
import { CF_WORKER_URL } from '../services/youtubeTranscript';
import type { VideoPlatform, VideoStudySession } from '../types';

/**
 * Audio-mode domain for the Study page.
 *
 * Owns:
 *   - the persisted audioMode preference (localStorage)
 *   - the Bilibili platform rule (native extracted audio is the only
 *     dependable transport there, so audio mode auto-enables)
 *   - the derived canonical watch URL (`videoUrl`) the audio endpoints need
 *   - the extracted-audio URLs and cache pre-warm loop for Bilibili
 *
 * YouTube keeps its official iframe/player transport in all modes. Bilibili
 * uses extracted native audio because its iframe does not expose a reliable
 * playback clock or control API.
 */
export function useAudioMode({
  session,
  platform,
  videoId,
  biliPage,
}: {
  session: VideoStudySession | null;
  platform: VideoPlatform;
  videoId: string | null;
  biliPage?: number;
}) {
  // Audio mode — persisted presentation preference. YouTube keeps its visible
  // official player; Bilibili uses extracted audio for reliable sync.
  const [audioMode, setAudioMode] = useState<boolean>(
    () => localStorage.getItem('echolearn_audio_mode') === '1',
  );
  useEffect(() => {
    localStorage.setItem('echolearn_audio_mode', audioMode ? '1' : '0');
  }, [audioMode]);

  // Bilibili's cross-origin iframe does not expose a reliable playback clock
  // or programmatic play/pause API on mobile. Use the extracted native audio
  // element as the synced transport by default; users can turn this off to
  // use Bilibili's native video controls instead.
  useEffect(() => {
    if (platform === 'bilibili') {
      // Bilibili cannot expose a dependable playback clock, so its transport
      // must switch to native audio as soon as the external platform changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudioMode(true);
    }
  }, [platform]);

  // Build the original watch URL (yt-dlp can consume it directly). Prefer the
  // session's pasted URL; otherwise reconstruct from platform + id.
  // Share text often includes a title before the URL, so extract the last
  // http(s) URL defensively — otherwise /api/audio receives the whole string
  // and the VPS returns 400 Bad Request.
  const videoUrl = useMemo(() => {
    if (session?.youtubeUrl) {
      // A plain BV id is valid input, but it is not a URL that /api/audio can
      // hand to Bilibili. Only preserve the saved value when it actually
      // contains an http(s) URL (including a b23.tv short link); otherwise
      // fall through to the canonical platform URL below.
      const extracted = extractUrl(session.youtubeUrl);
      if (extracted) return extracted;
    }
    if (platform === 'bilibili') {
      let u = `https://www.bilibili.com/video/${videoId}`;
      if (biliPage && biliPage > 1) u += `?p=${biliPage}`;
      return u;
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  }, [session, platform, videoId, biliPage]);

  // Extracted audio is only used for Bilibili. YouTube stays on YouTubeEmbed.
  const audioSrc = useMemo(() => {
    if (platform !== 'bilibili' || !audioMode || !videoId) return null;
    return `${CF_WORKER_URL}/api/audio?url=${encodeURIComponent(videoUrl)}`;
  }, [audioMode, platform, videoId, videoUrl]);

  // Bilibili fallback stays same-origin; YouTube has no extracted-audio path.
  const audioFallbackSrc = useMemo(() => {
    if (platform !== 'bilibili' || !audioMode || !videoUrl) return null;
    return `/api/bilibili?audio=1&url=${encodeURIComponent(videoUrl)}`;
  }, [audioMode, platform, videoUrl]);

  // ── Pre-warm audio cache (with auto-retry) ─────────────────
  // Bilibili audio extraction is slow and the upstream residential proxy is
  // flaky, so the first request often 502s / times out / returns an empty body.
  // Kick off the extraction as soon as a video is loaded with HIGH priority, so
  // it runs in parallel with the transcript fetch and is usually ready by the
  // time the user finishes reading — and retry with backoff until REAL audio
  // (content-type audio/*) is cached, so toggling audio mode later is instant
  // instead of hitting the same bad proxy window. We only count it as success
  // when the response is actually audio: the VPS sometimes returns HTTP 200 with
  // an error JSON body or 0 bytes, which must not be mistaken for a warm cache.
  // Retries abort if the video changes or the user enters audio mode (the
  // AudioPlayer then drives the single extraction itself).
  useEffect(() => {
    if (platform !== 'bilibili' || !videoId || !videoUrl || audioMode) return;
    const controller = new AbortController();
    const audioUrl = `${CF_WORKER_URL}/api/audio?url=${encodeURIComponent(videoUrl)}`;
    const MAX_ATTEMPTS = 5;
    let attempt = 0;
    let cancelled = false;

    const warm = async () => {
      while (!cancelled && attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
          const res = await fetch(audioUrl, {
            method: 'GET',
            signal: controller.signal,
            priority: 'high' as RequestPriority,
          });
          const ct = res.headers.get('content-type') || '';
          const len = res.headers.get('content-length');
          const hasBytes = len === null || len === '' || Number(len) > 0;
          const isRealAudio =
            res.ok && ct.includes('audio') && hasBytes;
          if (isRealAudio) return; // cached/extracted successfully — stop retrying
          if (controller.signal.aborted) return;
        } catch {
          if (controller.signal.aborted) return;
        }
        // Backoff before the next attempt (2.5s, 5s, 7.5s, 10s).
        if (attempt < MAX_ATTEMPTS && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 2500 * attempt));
        }
      }
    };
    void warm();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [videoId, videoUrl, audioMode, platform]);

  return { audioMode, setAudioMode, videoUrl, audioSrc, audioFallbackSrc };
}
