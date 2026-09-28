import type { Page } from '@playwright/test';

/**
 * Drive the shared media clock to an exact timestamp without touching the
 * media stack. A Playwright `route.fulfill` response never becomes seekable —
 * Chromium keeps `seekable` at [0, 0] even with Content-Length and
 * Accept-Ranges — so the app's own `seekTo` silently restarts such media at
 * zero. Overriding the element's `currentTime` property and dispatching
 * `timeupdate` bypasses the media stack entirely: every consumer that reads
 * the element (`getCurrentTime`, the timeupdate listeners) sees the value.
 */
export async function setControlledMediaTime(page: Page, seconds: number) {
  await page.locator('audio').evaluate((element, value) => {
    const audio = element as HTMLAudioElement & { __testTime?: number };
    if (!Object.prototype.hasOwnProperty.call(audio, '__testTime')) {
      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        get: () => audio.__testTime ?? 0,
        set: (next: number) => { audio.__testTime = next; },
      });
    }
    audio.__testTime = value;
    audio.dispatchEvent(new Event('timeupdate', { bubbles: true }));
  }, seconds);
}
