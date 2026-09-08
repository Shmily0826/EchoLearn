import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

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

async function enterGuestStudy(page: Page, platform: 'youtube' | 'bilibili' = 'youtube') {
  await page.addInitScript((selectedPlatform) => {
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_audio_mode', '0');
    localStorage.removeItem('echolearn_session');
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
    if (selectedPlatform === 'bilibili') {
      const lines = [
        { id: 'b1', start: 27, end: 29, text: 'Good morning. How are you?' },
        { id: 'b2', start: 29, end: 31, text: '(Audience) Good.' },
        { id: 'b3', start: 31, end: 33, text: "It's been great, hasn't it?" },
        { id: 'b4', start: 33, end: 36, text: "I've been blown away by the whole thing." },
        { id: 'b5', start: 36, end: 38, text: "In fact, I'm leaving." },
      ];
      localStorage.setItem('echolearn_session', JSON.stringify({
        id: 'e2e-bilibili-audio',
        youtubeUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        youtubeId: 'BV1xx411c7mD',
        platform: 'bilibili',
        title: 'Media sync fixture',
        transcriptLines: lines,
        transcriptData: { rawBlocks: lines, sentenceLines: lines },
        createdAt: 1,
        updatedAt: 1,
        status: 'studying',
      }));
    }
  }, platform);
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.locator('[data-transcript-line]').filter({ hasText: SAMPLE_FIRST, visible: true }).first()).toBeVisible({ timeout: 15_000 });
  if (await page.locator('audio').count() === 0) {
    await page.getByRole('button', { name: /audio mode/i }).click();
  }
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
  await page.route('**/api/bilibili*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Media sync fixture' }),
  }));
  await enterGuestStudy(page, 'bilibili');
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
