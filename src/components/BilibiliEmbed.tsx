import { forwardRef, useImperativeHandle, useMemo } from 'react';
import type { PlayerHandle } from './YouTubeEmbed';
import { useI18n } from '../i18n/I18nContext';

interface BilibiliEmbedProps {
  bvid: string;
  page?: number;
  startTime?: number;
}

const BV_RE = /^BV[a-zA-Z0-9]{10}$/i;

/**
 * Bilibili's player is a cross-origin iframe. Unlike YouTube it has no
 * supported browser API for play, pause, seeking, or reading current time.
 *
 * This component is deliberately native-only. Caption sync must use the
 * extracted AudioPlayer, whose HTMLAudioElement provides a real clock. Trying
 * to fake sync by reloading this iframe on every play/seek is unreliable on
 * mobile and can leave the player blank or restart it from the beginning.
 */
const BilibiliEmbed = forwardRef<PlayerHandle, BilibiliEmbedProps>(
  ({ bvid, page, startTime }, ref) => {
    const { t } = useI18n();
    const embedUrl = useMemo(() => {
      const params = new URLSearchParams({
        bvid,
        high_quality: '1',
        danmaku: '0',
        autoplay: '0',
        page: String(page && page > 0 ? page : 1),
      });
      if (startTime && startTime > 0) params.set('t', String(Math.floor(startTime)));
      return `https://player.bilibili.com/player.html?${params.toString()}`;
    }, [bvid, page, startTime]);

    // Keep the shared player shape for callers such as the sleep timer, but do
    // not claim that these methods control Bilibili's cross-origin iframe.
    useImperativeHandle(ref, () => ({
      playVideo() {},
      pauseVideo() {},
      seekTo() {},
      getCurrentTime() { return 0; },
      setPlaybackRate() {},
      getPlaybackRate() { return 1; },
    }), []);

    if (!BV_RE.test(bvid)) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl bg-black px-4 py-8 text-center">
          <p className="text-sm text-white/80 mb-1">{t('study.biliInvalidId')}</p>
          <p className="text-xs text-white/50">{bvid || '(empty)'}</p>
        </div>
      );
    }

    return (
      <div className="w-full">
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            src={embedUrl}
            className="absolute inset-0 h-full w-full rounded-xl bg-black"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            scrolling="no"
            frameBorder="0"
            referrerPolicy="origin"
            title="Bilibili video player"
          />
        </div>
        <p className="mt-2 px-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">
          {t('study.biliNativeOnlyHint')}
        </p>
      </div>
    );
  },
);

BilibiliEmbed.displayName = 'BilibiliEmbed';
export default BilibiliEmbed;
