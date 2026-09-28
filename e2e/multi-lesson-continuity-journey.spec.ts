import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';
import { setControlledMediaTime } from './helpers/mediaClock';

/**
 * ECHO-20260928-MULTI-LESSON-CONTINUITY-JOURNEY — two lessons live side by
 * side, the learner switches away and back, then deletes one.
 *
 * Why: real learners run 2-3 lessons a day, and this area shipped a real bug
 * (ECHO-20260924-RESTORE-CLOCK-V1: a reopened lesson's playback clock never
 * started, so the transcript stopped following) that only the leave-and-return
 * path exposes. Existing specs are single-lesson.
 *
 * Lesson A is a seeded bilibili session played through a route-mocked audio
 * extraction; lesson B is imported through the real local-audio importer with
 * a synthetic 8 kHz WAV and SRT (the 1000 Hz variant is rejected by Chromium).
 * Word attribution (sourceVideoId) is asserted from storage because the
 * per-session word badges only render for completed sessions.
 *
 * Network: dictionary mocked, /api/ai and /api/audio-transcribe aborted, the
 * YouTube iframe blocked — a guest journey must spend nothing.
 */

const LESSON_A_ID = 'BV1xx411c7mD';

const DICTIONARY_FIXTURE = {
  ipa_uk: '/ɡʊd/',
  ipa_us: '/ɡʊd/',
  audio_url: '',
  base_form: 'good',
  source: 'free-dictionary',
  entries: [{
    pos: 'adjective',
    definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
  }],
};

// Cues start at 2s: media served from a fulfilled route is never seekable
// (Chromium keeps seekable empty), so the journey plays naturally from zero
// and must reach an active line within seconds, not at 27s.
const LESSON_A_LINES = [
  { id: 'a1', start: 2, end: 4, text: 'Good morning. How are you?' },
  { id: 'a2', start: 4, end: 6, text: '(Audience) Good.' },
  { id: 'a3', start: 6, end: 8, text: "It's been great, hasn't it?" },
  { id: 'a4', start: 8, end: 11, text: "I've been blown away by the whole thing." },
  { id: 'a5', start: 11, end: 14, text: "In fact, I'm leaving." },
];

const LESSON_B_SRT = [
  '1', '00:00:00,000 --> 00:00:03,000', 'Lesson B opening line.', '',
  '2', '00:00:03,000 --> 00:00:06,000', 'Second B line about practice.', '',
  '3', '00:00:06,000 --> 00:00:09,000', 'Third B line for review.', '',
].join('\n');

function silentWav(seconds = 30): Buffer {
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

type VocabItem = {
  id: string;
  word: string;
  sourceVideoId: string;
  reviewCount: number;
  mastered: boolean;
  nextReviewAt: number;
};

async function readVocabulary(page: Page): Promise<VocabItem[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]'));
}

async function readSessions(page: Page): Promise<Array<{ id: string; title?: string; youtubeId?: string; status?: string; sourceType?: string }>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_sessions_list') || '[]'));
}

async function seedLessonA(page: Page) {
  await page.addInitScript((lines) => {
    const sessionA = {
      id: 'e2e-lesson-a',
      youtubeUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      youtubeId: 'BV1xx411c7mD',
      platform: 'bilibili',
      title: 'Lesson A — interview talk',
      transcriptLines: lines,
      transcriptData: { rawBlocks: lines, sentenceLines: lines },
      createdAt: 1,
      updatedAt: 1,
      status: 'completed',
    };
    // addInitScript reruns on every navigation; seed only once so lessons
    // created later through the real UI are never wiped.
    if (!localStorage.getItem('e2e-lesson-a-seeded')) {
      localStorage.setItem('echolearn_sessions_list', JSON.stringify([sessionA]));
      localStorage.setItem('e2e-lesson-a-seeded', '1');
    }
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_guest_mode', 'true');
  }, LESSON_A_LINES);
}

async function mockNetwork(page: Page) {
  await page.route('**/api/dictionary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
  await page.route('**/api/ai**', (route) => route.abort());
  await page.route('**/api/audio-transcribe', (route) => route.abort());
  // Media behind a route.fulfill never becomes seekable (seekable stays
  // [0,0] even with these headers), so the fixture's early cue is reached by
  // natural playback, never by a seek.
  await page.route('**/api/audio*', (route) => {
    const body = silentWav();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' },
      contentType: 'audio/wav',
      body,
    });
  });
  await page.route('**/api/bilibili*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Lesson A — interview talk' }) }));
  await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());
  // The bilibili audio path points straight at the extraction worker; serve it
  // the synthetic WAV so no real media ever leaves the machine.
  await page.route(/yt-transcript-proxy\.rng2018520\.workers\.dev/, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() }));
}

async function saveWordViaUi(page: Page, word: string) {
  await page.getByRole('button', { name: `Look up ${word}`, exact: true }).filter({ visible: true }).first().click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await saveButton.waitFor({ state: 'visible', timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' }).first())
    .toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
}

async function openSessionFromDashboard(page: Page, title: RegExp) {
  await page.goto('/');
  let card = page.getByText(title).filter({ visible: true }).last();
  if (!(await card.isVisible().catch(() => false))) {
    // Completed lessons live in a collapsed section a user expands first.
    await page.getByRole('button', { name: /Completed \(\d+\)/ }).click();
    card = page.getByText(title).filter({ visible: true }).last();
  }
  // .last() targets the Recent Sessions list entry; the same title also shows
  // in the unclickable "Continue Last Session" hero card higher up the page.
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await expect(page).toHaveURL(/\/study$/);
}

test.describe('Multi-lesson continuity journey', () => {
  test('two lessons coexist, survive switching, deletion, and reload', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', (dialog) => {
      dialogSeen = true;
      void dialog.accept();
    });

    await seedLessonA(page);
    await mockNetwork(page);
    await page.goto('/');
    await enterGuestMode(page);

    // ── Lesson A: open from the Dashboard, play, reach the middle, save ──
    await openSessionFromDashboard(page, /Lesson A — interview talk/);
    if (await page.locator('audio').count() === 0) {
      await page.getByRole('button', { name: /Audio mode|Focus \/ listening mode/i }).click();
    }
    await page.locator('audio').waitFor({ state: 'attached', timeout: 15_000 });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // The audio source resolves asynchronously and remounts the element; wait
    // until playback is genuinely under way so the highlight can arrive on
    // its own through the running clock.
    // Natural playback reaches the first cue (2s) within moments; the
    // following highlight proves the reopened session's clock is alive.
    await expect(
      page.locator('[data-transcript-line].bg-indigo-50').filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await saveWordViaUi(page, 'Good'); // token is capitalised; the stored lemma is lowercase

    let vocab = await readVocabulary(page);
    expect(vocab).toHaveLength(1);
    expect(vocab[0].word).toBe('Good'); // stored as clicked, not lowercased
    expect(vocab[0].sourceVideoId, "A’s word must belong to lesson A").toBe(LESSON_A_ID);

    // ── Lesson B: import real local media through the importer ────
    await page.getByRole('link', { name: 'Study' }).click();
    const importer = page.getByTestId('local-media-importer').first();
    await importer.getByTestId('local-media-audio-input')
      .setInputFiles({ name: 'lesson-b.wav', mimeType: 'audio/wav', buffer: silentWav(15) });
    await importer.getByTestId('local-media-subtitle-input')
      .setInputFiles({ name: 'lesson-b.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(LESSON_B_SRT) });
    await importer.getByRole('button', { name: 'Open in Study' }).click();
    await expect(page.getByText('Lesson B opening line.').filter({ visible: true }).first())
      .toBeVisible({ timeout: 15_000 });
    await saveWordViaUi(page, 'practice');

    vocab = await readVocabulary(page);
    expect(vocab).toHaveLength(2);
    const sessions = await readSessions(page);
    const lessonB = sessions.find((s) => s.sourceType === 'local_audio');
    expect(lessonB, 'the imported lesson must be stored as a session').toBeTruthy();
    const lessonBId = lessonB!.youtubeId;
    const practiceItem = vocab.find((v) => v.word === 'practice')!;
    expect(practiceItem.sourceVideoId, "B’s word must belong to lesson B, not A")
      .toBe(lessonB!.youtubeId);
    expect(practiceItem.sourceVideoId).not.toBe(LESSON_A_ID);

    // ── Dashboard lists both lessons ──────────────────────────────
    await page.goto('/');
    // Lesson A is completed and lives in the collapsed section.
    await page.getByRole('button', { name: /Completed \(\d+\)/ }).click();
    await expect(page.getByText('Lesson A — interview talk').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('lesson-b.wav').filter({ visible: true }).first()).toBeVisible();
    // Lesson A is seeded completed, so its per-session word badge renders.
    await expect(page.getByText('1 Words').filter({ visible: true }).first()).toBeVisible();

    // ── Back to lesson A: position, highlight, ownership survive ──
    await openSessionFromDashboard(page, /Lesson A — interview talk/);
    await expect(page.getByRole('button', { name: 'Look up Good', exact: true }).filter({ visible: true }).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('span[class*="bg-amber-100"]').filter({ hasText: /^good$/i }).filter({ visible: true }).first(),
    ).toBeVisible();
    vocab = await readVocabulary(page);
    expect(vocab.find((v) => v.word === 'Good')!.sourceVideoId).toBe(LESSON_A_ID);

    // Reopen must not leave the playback clock dead (RESTORE-CLOCK-V1): with
    // the audio running, the current time has to advance by itself.
    if (await page.locator('audio').count() === 0) {
      await page.getByRole('button', { name: /Audio mode|Focus \/ listening mode/i }).click();
    }
    await page.locator('audio').waitFor({ state: 'attached', timeout: 15_000 });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const t0 = await page.locator('audio').evaluate((el) => (el as HTMLAudioElement).currentTime);
    await expect.poll(
      () => page.locator('audio').evaluate((el) => (el as HTMLAudioElement).currentTime),
      { timeout: 10_000 },
    ).toBeGreaterThan(t0 + 0.5);

    // ── Reopen lesson B (local audio): its clock must start too ───
    // This is the path that shipped ECHO-20260924-RESTORE-CLOCK-V1: a local
    // lesson's blob URL resolves after the playback-clock effect has run, and
    // the old guard turned that ordering into a permanently dead clock.
    await page.goto('/');
    const bCardOpen = page.getByText('lesson-b.wav').filter({ visible: true }).first();
    await bCardOpen.waitFor({ state: 'visible', timeout: 15_000 });
    await bCardOpen.click();
    await expect(page).toHaveURL(/\/study$/);
    await expect(page.getByText('Lesson B opening line.').filter({ visible: true }).first())
      .toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const bStart = await page.locator('audio').evaluate((el) => (el as HTMLAudioElement).currentTime);
    await expect.poll(
      () => page.locator('audio').evaluate((el) => (el as HTMLAudioElement).currentTime),
      { timeout: 15_000 },
    ).toBeGreaterThan(bStart + 0.5);
    await expect(
      page.locator('[data-transcript-line].bg-indigo-50').filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── Reload, reopen B: a fresh mount of the local-audio lesson ──
    // This is the shape that shipped ECHO-20260924-RESTORE-CLOCK-V1: after a
    // full reload the lesson's blob URL resolves from IndexedDB only after
    // the playback-clock effect has first run.
    await page.reload();
    await openSessionFromDashboard(page, /lesson-b\.wav/);
    await expect(page.getByText('Lesson B opening line.').filter({ visible: true }).first())
      .toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // The clock is alive only if the highlight follows natural playback past
    // the first cue (0-3s) into the second (3-6s); a dead clock pins it there.
    await expect(
      page.locator('[data-transcript-line].bg-indigo-50').filter({ hasText: 'practice', visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Seek continuity: drive the clock into the third cue (6-9s); the
    // highlight must realign to the seek position, not stay on the old row.
    await setControlledMediaTime(page, 7);
    await expect(
      page.locator('[data-transcript-line].bg-indigo-50').filter({ hasText: 'Third B line', visible: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Reopen A: the saved-word highlight survives the round trip ──
    await openSessionFromDashboard(page, /Lesson A — interview talk/);
    await expect(
      page.locator('span[class*="bg-amber-100"]').filter({ hasText: /^good$/i }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── Delete lesson B; lesson A and both words must survive ─────
    await page.goto('/');
    // .last() = the Recent Sessions list entry, not the hero continue card.
    const bCard = page.getByText('lesson-b.wav').filter({ visible: true }).last();
    await bCard.waitFor({ state: 'visible', timeout: 15_000 });
    await bCard.locator('xpath=ancestor::div[contains(@class,"group")][1]').getByRole('button', { name: 'Delete' }).click();
    await expect(bCard).toBeHidden({ timeout: 10_000 });
    expect(dialogSeen, 'deletion must go through the confirmation dialog').toBe(true);
    // A is completed; expand its collapsed section before asserting it.
    await page.getByRole('button', { name: /Completed \(\d+\)/ }).click();
    await expect(page.getByText('Lesson A — interview talk').filter({ visible: true }).first()).toBeVisible();
    vocab = await readVocabulary(page);
    expect(vocab, 'deleting a lesson must not delete its words').toHaveLength(2);
    expect(await readSessions(page)).toHaveLength(1);

    // ── Cross-lesson review: both words queue, each attributed right ─
    await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]');
      localStorage.setItem('echolearn_vocabulary', JSON.stringify(
        list.map((v: { nextReviewAt: number }) => ({ ...v, nextReviewAt: Date.now() - 1000 })),
      ));
    });
    await page.goto('/review');
    const dueButton = page.getByRole('button', { name: /Review Due Today/ });
    await dueButton.waitFor({ state: 'visible', timeout: 15_000 });
    expect(Number(await dueButton.locator('span').last().textContent())).toBe(2);
    await dueButton.click();
    for (let i = 0; i < 2; i++) {
      const frontWord = await page.evaluate(() => {
        const paragraphs = [...document.querySelectorAll('main p')].map((el) => el.textContent?.trim());
        return ['Good', 'practice'].find((w) => paragraphs.includes(w));
      });
      expect(frontWord, `review card ${i + 1} must be one of the two lessons' words`).toBeTruthy();
      await page.getByRole('button', { name: /Show Answer/ }).click();
      await page.getByRole('button', { name: /Remember/ }).click();
    }
    await expect(page.getByText('Session Complete!')).toBeVisible();
    vocab = await readVocabulary(page);
    expect(vocab.find((v) => v.word === 'Good')!.sourceVideoId).toBe(LESSON_A_ID);
    expect(vocab.find((v) => v.word === 'practice')!.sourceVideoId)
      .toBe(lessonBId);
  });
});
