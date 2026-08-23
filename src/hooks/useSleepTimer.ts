import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sleep timer for the Study player.
 *
 * Owns the countdown state (minutes selected, seconds remaining, expiry
 * toast). The pause action is injected so the hook stays decoupled from the
 * concrete player implementation:
 *
 *   useSleepTimer({ onExpire: () => playerRef.current?.pauseVideo() })
 *
 * Semantics preserved from the original inline implementation:
 *   - selecting a duration restarts the countdown from that duration
 *   - 0 means "off" and clears the countdown
 *   - expiry fires onExpire (guarded), resets the selector, and shows a
 *     toast that auto-dismisses after 5s (also manually dismissable)
 */
export function useSleepTimer({ onExpire }: { onExpire: () => void }) {
  const [sleepMinutes, setSleepMinutes] = useState(0); // 0 = off
  const [sleepRemaining, setSleepRemaining] = useState(0); // seconds
  const [sleepToast, setSleepToast] = useState(false);

  // Keep the latest expire callback without re-subscribing the interval.
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (sleepMinutes <= 0) return;
    // A changed timer duration must restart the countdown from that duration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSleepRemaining(sleepMinutes * 60);
    setSleepToast(false);
  }, [sleepMinutes]);

  useEffect(() => {
    if (sleepRemaining <= 0) return;
    const id = setInterval(() => {
      setSleepRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          // Timer expired — pause playback via the injected action.
          try {
            expireRef.current();
          } catch {
            /* noop */
          }
          setSleepMinutes(0);
          setSleepToast(true);
          setTimeout(() => setSleepToast(false), 5000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // Re-subscribe only when the countdown starts/stops, like the original.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepRemaining > 0]);

  const dismissSleepToast = useCallback(() => setSleepToast(false), []);

  return {
    sleepMinutes,
    setSleepMinutes,
    sleepRemaining,
    setSleepRemaining,
    sleepToast,
    dismissSleepToast,
  };
}
