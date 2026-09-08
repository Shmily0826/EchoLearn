import { useEffect, useMemo, useState } from 'react';
import { extractUrl } from '../utils/urlExtract';
import { CF_WORKER_URL } from '../services/youtubeTranscript';
import type { VideoPlatform, VideoStudySession } from '../types';

/**
 * Audio-mode domain for the Study page.
 *
 * Owns:
 *   - the persisted audioMode preference (localStorage)
 *   - the derived canonical watch URL (`videoUrl`) the audio endpoints need
 *   - the extracted-audio URLs for Bilibili
 *
 * Bilibili audio URLs are derived only when audioMode is explicitly or
 * persistently enabled; AudioPlayer owns requests and lifecycle.
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
  // Audio mode — persisted presentation preference. Bilibili uses extracted
  // audio for reliable sync only when this mode is enabled.
  const [audioMode, setAudioMode] = useState<boolean>(
    () => localStorage.getItem('echolearn_audio_mode') === '1',
  );
  useEffect(() => {
    localStorage.setItem('echolearn_audio_mode', audioMode ? '1' : '0');
  }, [audioMode]);

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

  // Audio requests are intentionally owned by AudioPlayer, which mounts only
  // when the user explicitly enables Bilibili audio mode.
  return { audioMode, setAudioMode, videoUrl, audioSrc, audioFallbackSrc };
}
