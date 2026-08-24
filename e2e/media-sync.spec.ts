import { test, expect, type Page } from '@playwright/test';

const SAMPLE_FIRST = /Good morning/i;
const SAMPLE_SECOND = /Audience.*Good/i;
const SAMPLE_THIRD = /It's been great/i;
const SAMPLE_FIFTH = /I'm leaving/i;

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
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without login' }).click();
  for (let i = 0; i < 6; i++) {
    const english = page.getByRole('button', { name: 'English', exact: true });
    if (await english.isVisible().catch(() => false)) { await english.click(); await page.waitForTimeout(300); continue; }
    const close = page.getByRole('button', { name: 'Close', exact: true });
    if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(300); continue; }
    break;
  }
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByText('good', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /audio mode/i }).click();
  await page.locator('audio').waitFor({ state: 'attached', timeout: 10_000 });
}

async function setControlledMediaTime(page: Page, seconds: number) {
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

async function mockAudioAndStart(page: Page) {
  await page.route('**/api/audio*', (route) => route.fulfill({
    status: 200,
    contentType: 'audio/wav',
    body: silentWav(),
  }));
  await enterGuestStudy(page);
}

function activeLine(page: Page, text: RegExp) {
  return page.locator('[data-transcript-line]').filter({ hasText: text, visible: true }).first();
}

test.describe('Batch 4 — media synchronization', () => {
  test('time advance changes the active transcript line', async ({ page }) => {
    await mockAudioAndStart(page);
    await setControlledMediaTime(page, 27.5);
    await expect(activeLine(page, SAMPLE_FIRST)).toHaveClass(/bg-indigo-50/);
    await setControlledMediaTime(page, 30.2);
    await expect(activeLine(page, SAMPLE_SECOND)).toHaveClass(/bg-indigo-50/);
  });

  test('pause keeps the active line tied to media time', async ({ page }) => {
    await mockAudioAndStart(page);
    await setControlledMediaTime(page, 31.5);
    const line = activeLine(page, SAMPLE_THIRD);
    await expect(line).toHaveClass(/bg-indigo-50/);
    await page.locator('audio').dispatchEvent('pause');
    await page.waitForTimeout(500);
    await expect(line).toHaveClass(/bg-indigo-50/);
  });

  test('seek forward and backward updates the active line', async ({ page }) => {
    await mockAudioAndStart(page);
    await setControlledMediaTime(page, 36);
    await expect(activeLine(page, SAMPLE_FIFTH)).toHaveClass(/bg-indigo-50/);
    await setControlledMediaTime(page, 28);
    await expect(activeLine(page, SAMPLE_FIRST)).toHaveClass(/bg-indigo-50/);
  });

  test('playback rate changes do not replace media-time synchronization', async ({ page }) => {
    await mockAudioAndStart(page);
    await page.getByRole('button', { name: '2x', exact: true }).click();
    await setControlledMediaTime(page, 31.5);
    await expect(activeLine(page, SAMPLE_THIRD)).toHaveClass(/bg-indigo-50/);
  });
});
