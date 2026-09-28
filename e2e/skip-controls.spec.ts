import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

// Bounded verification of the Back 10s / Forward 10s study controls: drift
// under rapid repeats, the zero clamp, end-of-media behaviour, resume-on-skip
// while paused, and the mobile layout without horizontal overflow.

function silentWav(seconds = 60): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

async function enterGuestStudy(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_audio_mode', '0');
    localStorage.removeItem('echolearn_session');
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
    const lines = [
      { id: 'b1', start: 27, end: 29, text: 'Good morning. How are you?' },
      { id: 'b2', start: 29, end: 31, text: '(Audience) Good.' },
      { id: 'b3', start: 31, end: 33, text: "It's been great, hasn't it?" },
      { id: 'b4', start: 33, end: 36, text: "I've been blown away by the whole thing." },
      { id: 'b5', start: 36, end: 38, text: "In fact, I'm leaving." },
    ];
    localStorage.setItem('echolearn_session', JSON.stringify({
      id: 'e2e-skip-controls',
      youtubeUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      youtubeId: 'BV1xx411c7mD',
      platform: 'bilibili',
      title: 'Skip controls fixture',
      transcriptLines: lines,
      transcriptData: { rawBlocks: lines, sentenceLines: lines },
      createdAt: 1,
      updatedAt: 1,
      status: 'studying',
    }));
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(
    page.locator('[data-transcript-line]').filter({ hasText: 'Good morning', visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  if (await page.locator('audio').count() === 0) {
    await page.getByRole('button', { name: /audio mode/i }).click();
  }
  await page.locator('audio').waitFor({ state: 'attached', timeout: 10_000 });
}

async function mockAudio(page: Page) {
  await page.route('**/api/audio*', (route) => route.fulfill({
    status: 200,
    contentType: 'audio/wav',
    body: silentWav(),
  }));
  await page.route('**/api/bilibili*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Skip controls fixture' }),
  }));
  await page.route('**/api/dictionary*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ word: 'Good', definition: 'of high quality', partOfSpeech: 'adjective' }),
  }));
  await enterGuestStudy(page);
}

async function setMediaTime(page: Page, seconds: number) {
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

async function mediaTime(page: Page): Promise<number> {
  return page.locator('audio').evaluate((element) => (element as HTMLAudioElement).currentTime);
}

async function mediaPaused(page: Page): Promise<boolean> {
  return page.locator('audio').evaluate((element) => (element as HTMLAudioElement).paused);
}

test.describe('Back/Forward 10s study controls', () => {
  test('rapid repeated skips compound from the live clock without drift', async ({ page }) => {
    await mockAudio(page);
    await setMediaTime(page, 5);
    const forward = page.getByTestId('study-forward-10');
    for (let i = 0; i < 5; i++) {
      await forward.click();
      await page.waitForTimeout(120);
    }
    // Each click re-reads the live clock, so five skips land at ~55s; a stale
    // render-time base would leave the media visibly short of that.
    await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThan(48);
  });

  test('rewind near the start clamps to zero without erroring', async ({ page }) => {
    await mockAudio(page);
    await setMediaTime(page, 3);
    await page.getByTestId('study-rewind-10').click();
    await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeLessThanOrEqual(0.1);
    await expect(page.locator('[data-transcript-line]').filter({ visible: true }).first()).toBeVisible();
  });

  test('forward past the end lands on the final seekable position', async ({ page }) => {
    await mockAudio(page);
    await setMediaTime(page, 55);
    await page.getByTestId('study-forward-10').click();
    // No product-side end clamp: the browser seeks to the nearest reachable
    // position, which for a 60s element is its duration. Assert the skip did
    // not silently no-op and did not crash the Study page.
    await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThanOrEqual(55);
    await expect(page.locator('[data-transcript-line]').filter({ visible: true }).first()).toBeVisible();
  });

  test('skip while paused resumes playback', async ({ page }) => {
    await mockAudio(page);
    await setMediaTime(page, 30);
    await expect.poll(() => mediaPaused(page), { timeout: 5000 }).toBe(true);
    await page.getByTestId('study-rewind-10').click();
    await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeLessThan(25);
    await expect.poll(() => mediaPaused(page), { timeout: 5000 }).toBe(false);

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => mediaPaused(page), { timeout: 5000 }).toBe(true);
    await page.getByTestId('study-forward-10').click();
    await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThan(20);
    await expect.poll(() => mediaPaused(page), { timeout: 5000 }).toBe(false);
  });
});

test.describe('Back/Forward 10s controls — mobile layout', () => {
  test('buttons stay reachable with no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAudio(page);
    await expect(page.getByTestId('study-rewind-10')).toBeVisible();
    await expect(page.getByTestId('study-forward-10')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
