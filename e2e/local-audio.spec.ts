import { test, expect } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

function tinyWav() {
  const data = Buffer.alloc(44 + 8000);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(8000, 28);
  data.writeUInt16LE(1, 32);
  data.writeUInt16LE(8, 34);
  data.write('data', 36);
  data.writeUInt32LE(8000, 40);
  return data;
}

test('local audio imports once, drives the existing player, and asks for re-import after reload', async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/audio-transcribe', async (route) => {
    requests += 1;
    await responseReady;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'local_audio',
        lines: [
          { id: 'local-1', start: 0, end: 2, text: 'Hello local audio.' },
          { id: 'local-2', start: 2, end: 4, text: 'This line is timed.' },
        ],
      }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByRole('button', { name: 'Import Audio' })).toHaveCount(1);
  const input = page.locator('input[accept*=".mp3"]').first();
  await expect(input).toHaveCount(1);
  await input.setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByText('lesson.wav').first()).toBeVisible();
  await expect(page.getByText(/^(Uploading…|Transcribing…)$/).first()).toBeVisible();
  release();

  await expect(page.getByText('Hello local audio.').first()).toBeVisible();
  await expect.poll(() => page.locator('audio').count()).toBe(1);
  await expect.poll(async () => page.locator('audio').first().getAttribute('src')).toMatch(/^blob:/);
  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('local audio player missing');
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 2.5 });
    audio.dispatchEvent(new Event('timeupdate'));
  });
  await expect(page.getByText('This line is timed.').first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/local audio file is unavailable/i).first()).toBeVisible();
  expect(requests).toBe(1);
});
