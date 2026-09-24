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

test('a subtitle containing an Object.prototype word renders instead of crashing Study', async ({ page }) => {
  // Regression: the word "constructor" made lemmatize() return the Object
  // function, and the transcript token check threw during render, taking the
  // whole Study route down to the error boundary for any programming lecture.
  const riskySrt = '1\n00:00:00,000 --> 00:00:02,000\nEvery class gets a constructor.\n\n2\n00:00:02,000 --> 00:00:04,000\nThe next line is plain.';

  const importer = await openStudy(page);
  await importer.getByTestId('local-media-audio-input').setInputFiles({
    name: 'lecture.wav', mimeType: 'audio/wav', buffer: tinyWav(),
  });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({
    name: 'lecture.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(riskySrt),
  });
  await importer.getByRole('button', { name: 'Open in Study' }).click();

  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  const rows = page.locator('[data-transcript-line]').filter({ visible: true });
  await expect(rows.first()).toContainText('constructor');
  // The token is still rendered as an interactive word, so the saved-word check
  // really ran against it rather than the line being skipped.
  await expect(rows.first().getByRole('button', { name: 'constructor' })).toBeVisible();
});

test('the transcript keeps the line being read on screen through a dense subtitle', async ({ page }) => {
  // Regression: the follow-scroll used to listen for the container's own
  // `scroll` event as "the learner scrolled", so each automatic jump suppressed
  // the next window of following. At ~1.75s per cue the list advanced about
  // once every three lines and the highlighted row drifted permanently out of
  // view - reported from Production as "the subtitles don't scroll".
  //
  // The guarantee is "the line being read stays visible", NOT "the list moves
  // on every cue": once re-centering only happens when the row has actually
  // left the screen, a still list is correct behavior.
  const STEP = 1.75;
  const CUES = 60;

  const wavSeconds = (seconds: number) => {
    const samples = 8000 * seconds;
    const data = Buffer.alloc(44 + samples * 2);
    data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
    data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
    return data;
  };
  const stamp = (s: number) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return `00:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  const srt = Array.from({ length: CUES }, (_, i) =>
    `${i + 1}\n${stamp(i * STEP)} --> ${stamp((i + 1) * STEP - 0.05)}\nCue ${i + 1} carries a few transcript words.\n`).join('\n');

  const importer = await openStudy(page);
  await importer.getByTestId('local-media-audio-input').setInputFiles({
    name: 'dense.wav', mimeType: 'audio/wav', buffer: wavSeconds(CUES * STEP + 5),
  });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({
    name: 'dense.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt),
  });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await expect.poll(() => page.evaluate(() => {
    const a = document.querySelector('audio');
    return a && Number.isFinite(a.duration) ? a.duration : 0;
  }), { timeout: 15000 }).toBeGreaterThan(60);

  const activeRowState = () => page.evaluate(() => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    if (!el) return { index: -1, inView: false, top: 0 };
    const c = el.closest('.overflow-y-auto') as HTMLElement;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    return {
      index: Number(el.getAttribute('data-transcript-line')),
      inView: er.top >= cr.top - 2 && er.bottom <= cr.bottom + 2,
      top: Math.round(c.scrollTop),
    };
  });

  // One cue at a time, the cadence the report came in at.
  const lost: number[] = [];
  for (let cue = 1; cue <= 40; cue += 1) {
    await page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, cue * STEP);
    await page.waitForTimeout(320);
    const state = await activeRowState();
    if (!state.inView) lost.push(state.index);
  }
  expect(lost, `rows that left the screen: ${lost.join(', ')}`).toEqual([]);

  // A small scroll that keeps the current line visible must not be fought.
  const nudged = await page.evaluate(async () => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    const c = el!.closest('.overflow-y-auto') as HTMLElement;
    const before = c.scrollTop;
    c.scrollTop = before + 40;
    return { before: Math.round(before), after: Math.round(c.scrollTop) };
  });
  await page.evaluate(() => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    el!.closest('.overflow-y-auto')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }));
  });
  // One cue ahead, still comfortably on screen: the list must be left alone.
  await page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, 41 * STEP);
  await page.waitForTimeout(700);
  const duringPause = await page.evaluate(() => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    const c = el!.closest('.overflow-y-auto') as HTMLElement;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { top: Math.round(c.scrollTop), inView: er.top >= cr.top - 2 && er.bottom <= cr.bottom + 2 };
  });
  expect(duringPause.inView, 'a single cue should not push the line off screen').toBe(true);
  expect(duringPause.top, 'the list moved while the learner was inside the reading pause')
    .toBe(nudged.after);

  // After the pause expires, a line that is still visible must *stay* put: this
  // is the in-view guard, and it is what stops the list being re-centred under
  // a reader who only moved a row or two.
  await page.waitForTimeout(6200);
  await page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, 42 * STEP);
  await page.waitForTimeout(900);
  const afterPause = await page.evaluate(() => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    const c = el!.closest('.overflow-y-auto') as HTMLElement;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { top: Math.round(c.scrollTop), inView: er.top >= cr.top - 2 && er.bottom <= cr.bottom + 2 };
  });
  expect(afterPause.inView).toBe(true);
  expect(afterPause.top, 'the list was dragged back although the line was still visible')
    .toBe(nudged.after);

  // Scrolled far enough that the line really is gone: the reading pause holds
  // the list still, and following resumes once it expires.
  const scrolledAway = await page.evaluate(() => {
    const el = document.querySelector('[data-transcript-line].border-l-indigo-500');
    const c = el!.closest('.overflow-y-auto') as HTMLElement;
    c.scrollTop = Math.max(0, c.scrollTop - 600);
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true }));
    return Math.round(c.scrollTop);
  });
  await page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, 48 * STEP);
  await page.waitForTimeout(900);
  const duringGrace = await page.evaluate(() => Math.round((document.querySelector('[data-transcript-line].border-l-indigo-500')!.closest('.overflow-y-auto') as HTMLElement).scrollTop));
  expect(duringGrace, 'the list jumped back while the learner was still inside the reading pause')
    .toBe(scrolledAway);

  await page.waitForTimeout(6200);
  await page.evaluate((t) => { (document.querySelector('audio') as HTMLAudioElement).currentTime = t; }, 52 * STEP);
  await page.waitForTimeout(1200);
  const resumed = await activeRowState();
  expect(resumed.inView, 'following never resumed after the reading pause').toBe(true);
  expect(resumed.top).toBeGreaterThan(scrolledAway);
});
