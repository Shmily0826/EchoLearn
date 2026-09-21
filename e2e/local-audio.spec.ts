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

test('V2 reports local storage failure without opening or changing a lesson', async ({ page }) => {
  const importer = await openStudy(page);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: 'lesson.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await expect(importer.getByRole('alert')).toContainText(/Free up browser storage or compress the audio/i);
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Study', exact: true })).toBeVisible();
});


test('a restored local_audio session without its blob shows the re-import state, not a caption error', async ({ page }) => {
  // Simulates the cross-device case: the session record synced from the cloud
  // but the audio Blob lives in the original device's IndexedDB only.
  // ECHO_LOGOUT_SAFETY_UX follow-up: the generic "Unable to fetch captions"
  // error card must not render for a local_audio session — the honest
  // re-import banner and importer are the correct surface.
  let captionFetches = 0;
  await page.route('**/api/transcript**', async (route) => {
    captionFetches += 1;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await enterGuestMode(page);
  await page.evaluate(() => {
    localStorage.setItem('echolearn_session', JSON.stringify({
      id: 'session_stale_blob',
      youtubeUrl: 'local_audio:lesson.wav',
      youtubeId: 'local_1700000000000_test',
      platform: 'youtube',
      sourceType: 'local_audio',
      localMediaId: 'local_1700000000000_test',
      title: 'lesson.wav',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      status: 'studying',
      lastPosition: 0,
    }));
  });
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.waitForTimeout(3000);

  await expect(page.getByText(/This local audio file is unavailable after reload/i)).toBeVisible();
  await expect(page.getByTestId('local-media-importer').first()).toBeVisible();
  await expect(page.getByTestId('caption-error-card')).toHaveCount(0);
  expect(captionFetches).toBe(0);
});
