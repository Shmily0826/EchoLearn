import { track } from '@vercel/analytics';
import {
  getAnalytics,
  isSupported,
  logEvent as fbLogEvent,
  type Analytics,
} from 'firebase/analytics';
import app from '../lib/firebase';

/**
 * Centralized, best-effort product analytics.
 *
 * Every event is reported to TWO destinations:
 *   1. Vercel Web Analytics — anonymous traffic + behaviour (no PII)
 *   2. Firebase Analytics    — user-level behaviour tied to the signed-in
 *      account (sign_up / login / what they actually studied & saved)
 *
 * `track()` / `logEvent()` only do real work in production builds, so these
 * calls are harmless in dev. Analytics is non-critical: a failure must never
 * break the app.
 *
 * Events we emit today:
 *   - sign_up               : a new account was created (email or google)
 *   - login                 : a successful sign-in (email or google)
 *   - pwa_install           : the user added the PWA to their home screen
 *   - pwa_installed_session : a session opened from an already-installed PWA
 *   - video_studied         : a new study session was started
 *   - word_saved            : a vocabulary item was saved
 *   - sentence_saved        : a sentence was saved
 *   - ai_analysis_used      : an AI transcript analysis completed
 */

type EventParams = Record<string, string | number | boolean>;

let fbAnalyticsPromise: Promise<Analytics | null> | null = null;

/**
 * Lazily initialise Firebase Analytics. Returns null when unsupported
 * (e.g. SSR, ad-blocked) or not in production, so callers can no-op safely.
 */
function getFbAnalytics(): Promise<Analytics | null> {
  if (!fbAnalyticsPromise) {
    fbAnalyticsPromise = (async () => {
      if (!import.meta.env.PROD) return null;
      try {
        if (!(await isSupported())) return null;
        return getAnalytics(app);
      } catch {
        return null;
      }
    })();
  }
  return fbAnalyticsPromise;
}

export function trackEvent(name: string, props?: EventParams): void {
  // 1. Vercel Web Analytics (anonymous reach + behaviour)
  try {
    track(name, props);
  } catch {
    /* analytics is non-critical; never let it break the app */
  }

  // 2. Firebase Analytics (user-level behaviour)
  try {
    void getFbAnalytics().then((analytics) => {
      if (analytics) fbLogEvent(analytics, name, props ?? {});
    });
  } catch {
    /* analytics is non-critical; never let it break the app */
  }
}
