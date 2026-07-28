import { track } from '@vercel/analytics';

/**
 * Centralized, best-effort product analytics built on Vercel Web Analytics.
 *
 * `track()` only sends in production builds, so these calls are harmless in dev.
 * Beyond page views we log a few anonymous product-usage events so we can see
 * real learning behaviour (not just traffic):
 *   - pwa_install            : the user added the PWA to their home screen
 *   - pwa_installed_session  : a session opened from an already-installed PWA
 *   - video_studied          : a new study session was started
 *   - word_saved             : a vocabulary item was saved
 *   - sentence_saved         : a sentence was saved
 *   - ai_analysis_used       : an AI transcript analysis completed
 */
export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  try {
    track(name, props);
  } catch {
    /* analytics is non-critical; never let it break the app */
  }
}
