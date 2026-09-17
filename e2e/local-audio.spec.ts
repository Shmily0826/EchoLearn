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

const srt = '1\n00:00:00,000 --> 00:00:02,000\nHello local audio.\n\n2\n00:00:02,000 --> 00:00:04,000\nThis line is timed.';
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello VTT audio.\n\n00:02.000 --> 00:04.000\nThis VTT line is timed.';

async function openStudy(page: Parameters<typeof enterGuestMode>[0]) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  return page.getByTestId('local-media-importer').first();
}

async function mediaCount(page: Parameters<typeof enterGuestMode>[0]) {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const request = indexedDB.open('echolearn-local-media-v2', 1);
    request.onsuccess = () => {
      const transaction = request.result.transaction('media', 'readonly');
      const count = transaction.objectStore('media').count();
      count.onsuccess = () => resolve(count.result);
    };
    request.onerror = () => resolve(-1);
  }));
}

test('V2 imports SRT with zero ASR and restores the existing Study flow', async ({ page }) => {
  let asrRequests = 0;
  await page.route('**/api/audio-transcribe', async (route) => {
    asrRequests += 1;
    await route.abort();
  });

  const importer = await openStudy(page);
  const audioInput = importer.getByTestId('local-media-audio-input');
  const subtitleInput = importer.getByTestId('local-media-subtitle-input');
  await audioInput.setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await expect(page.getByText(/Subtitles are required.*No transcription is performed/i)).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Open in Study' })).toBeDisabled();

  await subtitleInput.setInputFiles({ name: 'broken.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('not timed subtitles') });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await expect(importer.getByRole('alert')).toContainText('malformed');

  await subtitleInput.setInputFiles({ name: 'lesson.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  const openButton = importer.getByRole('button', { name: 'Open in Study' });
  await openButton.dblclick();
  await expect(page.getByText('Hello local audio.').first()).toBeVisible();
  await expect.poll(() => page.locator('audio').count()).toBe(1);
  await expect.poll(async () => page.locator('audio').first().getAttribute('src')).toMatch(/^blob:/);
  expect(asrRequests).toBe(0);
  await expect.poll(() => mediaCount(page)).toBe(1);

  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('local audio player missing');
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 2.5 });
    audio.dispatchEvent(new Event('timeupdate'));
  });
  await expect(page.getByText('This line is timed.').first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('Hello local audio.').first()).toBeVisible();
  await expect.poll(async () => page.locator('audio').first().getAttribute('src')).toMatch(/^blob:/);
  expect(asrRequests).toBe(0);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => mediaCount(page)).toBe(0);
});

test('V2 imports VTT and never calls the ASR endpoint', async ({ page }) => {
  let asrRequests = 0;
  await page.route('**/api/audio-transcribe', async (route) => {
    asrRequests += 1;
    await route.abort();
  });

  const importer = await openStudy(page);
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await expect(importer.getByText('lesson.wav')).toBeVisible();
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: 'lesson.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await expect(page.getByText('Hello VTT audio.').first()).toBeVisible();
  await expect(page.getByText('This VTT line is timed.').last()).toBeVisible();
  expect(asrRequests).toBe(0);
});

test('V2 rejects unsupported subtitle files without leaving the importer', async ({ page }) => {
  const importer = await openStudy(page);
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: 'lesson.txt', mimeType: 'text/plain', buffer: Buffer.from('not a supported subtitle') });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await expect(importer.getByRole('alert')).toContainText('SRT or VTT');
  await expect(page.locator('audio')).toHaveCount(0);
});
