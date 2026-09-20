import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * STUDY MATERIAL ENTRY & CLEAR DISCOVERABILITY (P3)
 *
 * Pins two confirmed product defects that earlier suites could not see:
 *
 *  UX-01 — the bundled Sample Video is shown when Study has no persisted
 *          session, but Clear was rendered only for a persisted session, so the
 *          Sample had no exit at all.
 *  UX-02 — the only Local Audio importer sat AFTER the transcript rows: on the
 *          Sample that is 277 rows and ~19.3k px of scroll, and on a phone the
 *          importer was not rendered at all while a transcript was showing.
 *
 * The old tests missed both because they reached the importer directly by
 * `data-testid` and drove it with setInputFiles, never asserting that a learner
 * looking at the first viewport could find the thing. Discovery here is by
 * visible role/name only, and every entry is checked against the INITIAL
 * viewport box — Playwright's automatic scrolling is never treated as evidence
 * that a feature was discoverable. Desktop and phone viewports are covered
 * separately (the CI mobile projects only run mobile-pwa.spec.ts).
 */

const SAMPLE_VIDEO_MARKER = 'Good morning';
const EMPTY_STATE_TEXT = /paste a youtube or bilibili url above to start/i;

const visibleTranscriptRows = (page: Page) => page.locator('[data-transcript-line]').filter({ visible: true });

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

const srt = '1\n00:00:00,000 --> 00:00:02,000\nHello local audio.\n\n2\n00:02,000 --> 00:04,000\nThis line is timed.';

async function openStudyWithSample(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  // The bundled sample lesson is on screen. The app keeps two transcript copies
  // mounted, so only the laid-out one proves anything to a learner.
  await expect(visibleTranscriptRows(page)).not.toHaveCount(0);
  await expect(visibleTranscriptRows(page).filter({ hasText: SAMPLE_VIDEO_MARKER }).first()).toBeVisible();
}

async function expectTopOfElementWithinFirstViewport(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = locator.page().viewportSize();
  expect(viewport).not.toBeNull();
  // No scrolling has happened at this point, so being above the fold is the test.
  expect(box!.y).toBeLessThan(viewport!.height);
  return box!;
}

for (const viewport of [
  { label: 'desktop 1440x900', width: 1440, height: 900 },
  { label: 'mobile 390x844', width: 390, height: 844 },
]) {
  test.describe(`Study material entry — ${viewport.label}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test('the bundled Sample offers a Clear exit within the first viewport', async ({ page }) => {
      await openStudyWithSample(page);

      const clear = page.getByRole('button', { name: /^Clear$/ });
      await expect(clear).toBeVisible();
      await expectTopOfElementWithinFirstViewport(clear);
    });

    test('Import Audio is discoverable within the first viewport, above the transcript rows', async ({ page }) => {
      await openStudyWithSample(page);

      const entry = page.getByRole('button', { name: /^Import Audio$/ });
      await expect(entry).toBeVisible();
      const entryBox = await expectTopOfElementWithinFirstViewport(entry);

      // It is a first-level entry, not a row buried in the transcript scroll area.
      const firstRowBox = await visibleTranscriptRows(page).first().boundingBox();
      expect(firstRowBox).not.toBeNull();
      expect(entryBox.y).toBeLessThan(firstRowBox!.y);
    });

    test('Clearing the Sample removes the lesson and leaves the material entry usable', async ({ page }) => {
      await openStudyWithSample(page);

      await page.getByRole('button', { name: /^Clear$/ }).click();

      await expect(visibleTranscriptRows(page)).toHaveCount(0);
      await expect(page.getByText(EMPTY_STATE_TEXT)).toBeVisible();
      await expect(visibleTranscriptRows(page).filter({ hasText: SAMPLE_VIDEO_MARKER })).toHaveCount(0);

      // SC4: the learner can go straight to their own material afterwards.
      const entry = page.getByRole('button', { name: /^Import Audio$/ });
      await expect(entry).toBeVisible();
      await expectTopOfElementWithinFirstViewport(entry);
    });

    test('a learner can import their own audio lesson through that entry', async ({ page }) => {
      await openStudyWithSample(page);

      const pickFile = async (name: RegExp, file: { name: string; mimeType: string; buffer: Buffer }) => {
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.getByRole('button', { name }).click(),
        ]);
        await chooser.setFiles(file);
      };

      await pickFile(/^Import Audio$/, { name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
      await pickFile(/^Choose SRT \/ VTT$/, { name: 'lesson.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
      await page.getByRole('button', { name: /Open in Study/ }).click();

      await expect(page.locator('audio')).toHaveCount(1);
      await expect(visibleTranscriptRows(page).filter({ hasText: 'Hello local audio.' }).first()).toBeVisible();
      // The import replaced the sample rather than stacking a second lesson on it.
      await expect(visibleTranscriptRows(page).filter({ hasText: SAMPLE_VIDEO_MARKER })).toHaveCount(0);
    });
  });
}

test('the material entry is labelled in the learner’s language', async ({ page }) => {
  // The entry is first-level now, so a zh learner must be able to read it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'zh');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.locator('a[href="/study"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(visibleTranscriptRows(page)).not.toHaveCount(0);

  await expect(page.getByRole('button', { name: '导入音频' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择 SRT / VTT 字幕' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^清空$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import Audio$/ })).toHaveCount(0);
});

test('Clearing does not touch saved vocabulary', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([
      {
        id: 'v_keepme', word: 'conference', meaningCn: '会议', context: 'the conference',
        sourceVideoId: '', addedAt: Date.now(), mastered: false, reviewCount: 0,
        lastReviewedAt: 0, nextReviewAt: Date.now() + 86_400_000,
      },
    ]));
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);

  await page.getByRole('button', { name: /^Clear$/ }).click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]'));
  expect(saved.map((w: { word: string }) => w.word)).toEqual(['conference']);
});
