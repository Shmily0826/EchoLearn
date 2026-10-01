import { track } from '@vercel/analytics';
import {
  getAnalytics,
  isSupported,
  logEvent as fbLogEvent,
  type Analytics,
} from 'firebase/analytics';
import app from '../lib/firebase';
import { isAnalyticsSuppressed } from '../utils/analyticsSuppression';

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
 *
 * Funnel events (2026-10 audit P0) — answer what the set above could not:
 *   - session_start         : app opened, with anon_id + days_since_first
 *   - first_video_loaded    : the device's very first video import
 *   - caption_failed        : the caption pipeline failed for this load
 *   - first_item_saved      : the device's very first vocabulary/sentence save
 *   - review_completed      : a Review session finished (cards, accuracy)
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
  if (isAnalyticsSuppressed()) return;

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

// ── Funnel events (2026-10 audit P0) ──────────────────────────
// These answer three questions the original event set could not: does the
// caption pipeline work for real users, do they reach their first save, and
// do they come back to review. All identifiers are anonymous device ids.

const ANON_ID_KEY = 'echolearn_anon_id';
const FIRST_SEEN_KEY = 'echolearn_first_seen_ms';

/** Stable per-device anonymous id — never a user id, never carries PII. */
export function getAnonId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon-unavailable';
  }
}

/** Emits once per app mount: the return-cohort signal (days since first seen). */
export function trackSessionStart(): void {
  let firstSeen = 0;
  try {
    firstSeen = Number(localStorage.getItem(FIRST_SEEN_KEY)) || 0;
    if (!firstSeen) {
      firstSeen = Date.now();
      localStorage.setItem(FIRST_SEEN_KEY, String(firstSeen));
    }
  } catch {
    /* storage unavailable — still emit, cohort just stays 0 */
  }
  trackEvent('session_start', {
    anon_id: getAnonId(),
    days_since_first: firstSeen ? Math.floor((Date.now() - firstSeen) / 86_400_000) : 0,
  });
}

/** First-ever one-shot events, deduped by a localStorage flag. */
function trackFirstEver(flagKey: string, event: string): void {
  try {
    if (localStorage.getItem(flagKey)) return;
    localStorage.setItem(flagKey, '1');
  } catch {
    return; // cannot dedupe → do not spam the funnel on every load
  }
  trackEvent(event);
}

export function trackFirstVideoLoaded(): void {
  trackFirstEver('echolearn_funnel_first_video', 'first_video_loaded');
}

export function trackFirstItemSaved(): void {
  trackFirstEver('echolearn_funnel_first_save', 'first_item_saved');
}

export function trackCaptionFailed(props?: EventParams): void {
  trackEvent('caption_failed', props);
}

export function trackReviewCompleted(props?: EventParams): void {
  trackEvent('review_completed', props);
}
