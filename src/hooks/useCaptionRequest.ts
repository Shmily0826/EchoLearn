import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptRecovery } from '../services/youtubeTranscript';

/**
 * Caption request lifecycle for the Study page.
 *
 * Owns the generic request machinery shared by every caption-fetch path
 * (session restore, dashboard navigation, load video, reload, Bilibili part
 * switch): request generation, latest-request-wins semantics, stale-result
 * rejection, the fetching flag, the error message, the live elapsed-seconds
 * ticker, and the success toast (count + elapsed time + source label).
 *
 * It deliberately knows NOTHING about Study persistence: the caller decides
 * what a successful transcript means (and reports back a toast payload),
 * while the hook guarantees only the LATEST request may touch that state.
 *
 * Race guarantees (identical to the previous inline transcriptRequestRef
 * guards, now enforced in exactly one place):
 *   1. A starts → B starts → B resolves → A resolves ⇒ A's result/error is
 *      discarded (A is stale).
 *   2. A starts → invalidate() (clear session / switch video) → A resolves ⇒
 *      A's result is discarded.
 */

export interface CaptionHandle {
  readonly id: number;
}

/** Report payload returned from onSuccess to drive the success toast. */
export interface CaptionSuccessReport {
  count: number;
  source?: string | null;
}

export interface FetchToast {
  count: number;
  /** Elapsed wait in whole seconds (formatted by the caller for i18n). */
  seconds: number;
  source: string | null;
}

export interface CaptionRunOptions<T> {
  /**
   * Apply a successful result (persist transcript, update session…).
   * Only invoked when this request is still the latest one. Return a
   * report to show the success toast; return nothing for no toast.
   */
  onSuccess?: (result: T) => CaptionSuccessReport | void;
  /** Map a failure to the user-visible message (default: err.message). */
  errorMessage?: (err: unknown) => string;
  /**
   * false = attach to the request already begun by begin() (keeps the
   * elapsed timer running from the original start) instead of starting a
   * fresh request. Used by the Bilibili short-link flow, which awaits the
   * link resolution before kicking off the transcript fetch.
   */
  begin?: boolean;
}

function recoveryOf(err: unknown): TranscriptRecovery | null {
  if (!err || typeof err !== 'object' || !('recovery' in err)) return null;
  const recovery = (err as { recovery?: unknown }).recovery;
  return recovery && typeof recovery === 'object'
    && (recovery as { canAsr?: unknown }).canAsr === true
    && (recovery as { requiresExplicitOptIn?: unknown }).requiresExplicitOptIn === true
    ? { canAsr: true, requiresExplicitOptIn: true }
    : null;
}

function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function useCaptionRequest() {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<TranscriptRecovery | null>(null);
  const [fetchToast, setFetchToast] = useState<FetchToast | null>(null);
  // Live "elapsed wait" seconds shown during the (often multi-minute) fetch.
  const [elapsed, setElapsed] = useState(0);

  const idRef = useRef(0);
  const startRef = useRef(0);
  const resultRef = useRef<number | null>(null);
  const sourceRef = useRef<string | null>(null);
  const tickRef = useRef<number | null>(null);

  const notifyFetchSuccess = useCallback((count: number, source: string | null = null) => {
    const totalSec = Math.max(0, Math.round((Date.now() - startRef.current) / 1000));
    // Persistent toast: user closes it via the ✕ button (no auto-dismiss).
    // We store the elapsed seconds as a number and let the component localize
    // the duration string, so the English UI never shows "分/秒".
    setFetchToast({ count, seconds: totalSec, source });
  }, []);

  // Live "elapsed wait" ticker: start when a fetch begins, stop + reset when
  // it ends, so the user sees progress instead of a frozen spinner during the
  // (often 1–3 min) transcript fetch.
  useEffect(() => {
    if (!fetching) {
      // Reset the external request timer when its lifecycle ends.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsed(0);
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [fetching]);

  /** Start a new request: bumps the generation, resets timing, clears error. */
  const begin = useCallback((): CaptionHandle => {
    idRef.current += 1;
    startRef.current = Date.now();
    resultRef.current = null;
    sourceRef.current = null;
    // Clear any lingering success banner from a previous (different) video so a
    // stale "Subtitles loaded" toast can never sit alongside a new fetch's
    // spinner / loading button. This is the directly-observed inconsistency:
    // fresh load → old toast remains → button shows "loading" + old banner.
    setFetchToast(null);
    setFetching(true);
    setError(null);
    setErrorCode(null);
    setRecovery(null);
    return { id: idRef.current };
  }, []);

  const isCurrent = useCallback((handle: CaptionHandle) => handle.id === idRef.current, []);

  /**
   * End the active request: stop the fetching flag and, when a success was
   * reported, fire the toast. Stale handles are ignored.
   */
  const end = useCallback(
    (handle?: CaptionHandle) => {
      if (handle && handle.id !== idRef.current) return;
      setFetching(false);
      if (resultRef.current != null) {
        notifyFetchSuccess(resultRef.current, sourceRef.current);
        resultRef.current = null;
        sourceRef.current = null;
      }
    },
    [notifyFetchSuccess],
  );

  /**
   * Run a caption fetch under latest-request-wins semantics. All state
   * transitions (success apply, error, end + toast) are skipped when a newer
   * request has started in the meantime.
   */
  const run = useCallback(
    <T,>(fetcher: () => Promise<T>, opts: CaptionRunOptions<T> = {}) => {
      const handle = opts.begin === false ? { id: idRef.current } : begin();
      fetcher()
        .then((result) => {
          if (handle.id !== idRef.current) return;
          const reported = opts.onSuccess?.(result);
          if (reported) {
            resultRef.current = reported.count;
            sourceRef.current = reported.source ?? null;
          }
        })
        .catch((err: unknown) => {
          if (handle.id !== idRef.current) return;
          setError(
            opts.errorMessage
              ? opts.errorMessage(err)
              : err instanceof Error
                ? err.message
                : 'Unknown error fetching captions',
          );
          setErrorCode(errorCodeOf(err));
          setRecovery(recoveryOf(err));
        })
        .finally(() => end(handle));
    },
    [begin, end],
  );

  /**
   * Fail the active request with a user-visible message (e.g. short-link
   * resolution failed). Without a handle it acts unconditionally, matching
   * the pre-refactor UI-error paths that run before any request starts.
   */
  const fail = useCallback(
    (message: string, handle?: CaptionHandle) => {
      if (handle && handle.id !== idRef.current) return;
      setError(message);
      setErrorCode(null);
      setRecovery(null);
      setFetching(false);
    },
    [],
  );

  /** Invalidate every in-flight request without touching visible state. */
  const invalidate = useCallback(() => {
    idRef.current += 1;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setRecovery(null);
  }, []);
  const clearFetchToast = useCallback(() => setFetchToast(null), []);

  return {
    fetching,
    error,
    errorCode,
    recovery,
    setError,
    clearError,
    elapsed,
    fetchToast,
    clearFetchToast,
    begin,
    run,
    isCurrent,
    end,
    fail,
    invalidate,
  };
}
