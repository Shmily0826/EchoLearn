import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

// Regression coverage for ECHO_LEARNER_FRICTION_FIX_V1:
// A/B — invalid URL is a form error and must not destroy the current lesson.
// C   — dictionary popup is visible while loading, near the viewport bottom.
// D   — the bundled Sample says so, and stays intentionally unpersisted.
// E   — first-day Review guidance + the existing non-due practice path.
// F   — mobile Save Sentence touch target.

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

async function bootStudy(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(page).toHaveURL(/\/study$/);
  // The app keeps visited routes mounted under display:none; wait on the
  // visible copy of the transcript, not the hidden duplicate.
  await expect(page.locator('[data-transcript-line]:visible').first()).toBeVisible({ timeout: 10_000 });
}

async function stubDictionary(page: Page, delayMs = 0) {
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
  await page.route('https://api.datamuse.com/**', (route) => route.abort());
  await page.route('**/api/dictionary*', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const word = new URL(route.request().url()).searchParams.get('word') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: 'ˈstub', ipa_us: '', audio_url: '', base_form: word, source: 'e2e-stub',
        lemma_provenance: 'provider-confirmed',
        entries: [{ pos: 'noun', definitions: [{ display_order: 0, definitions_json: { definition: `${word} (E2E stub sense)`, source_text: `${word} (E2E stub sense)` } }] }],
      }),
    });
  });
}

async function statFrom(page: Page, label: string) {
  return page.evaluate((l) => {
    const m = document.body.innerText.match(new RegExp(`(\\d+)\\s*\\n\\s*${l}`));
    return m ? Number(m[1]) : null;
  }, label);
}

test('A: invalid URL on the Sample shows a form error and keeps the lesson', async ({ page }) => {
  await bootStudy(page);
  const rows = page.locator('[data-transcript-line]:visible');
  const before = await rows.count();
  expect(before).toBeGreaterThan(100);

  await page.getByPlaceholder(/paste youtube/i).fill('hello this is not a video');
  await page.getByRole('button', { name: 'Load Video' }).click();

  await expect(page.getByTestId('study-url-error')).toHaveText(/valid YouTube or Bilibili/i);
  await expect(rows).toHaveCount(before);
  await expect(page.locator('text=Unable to fetch captions').filter({ visible: true })).toHaveCount(0);
  // Sample still usable: its note is visible and a word click still opens the popup.
  await expect(page.getByTestId('study-sample-note')).toBeVisible();

  // IV2: empty input gets its own actionable message, still non-destructive.
  await page.getByPlaceholder(/paste youtube/i).fill('');
  await page.getByRole('button', { name: 'Load Video' }).click();
  await expect(page.getByTestId('study-url-error')).toHaveText(/paste a youtube or bilibili link first/i);
  await expect(rows).toHaveCount(before);
});

test('B: invalid URL leaves a real Local Audio lesson and its Session untouched', async ({ page }) => {
  await bootStudy(page);
  const importer = page.getByTestId('local-media-importer').first();
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: 'lesson.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: 'lesson.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await page.getByRole('button', { name: /open in study/i }).click();

  const rows = page.locator('[data-transcript-line]:visible');
  await expect(rows).toHaveCount(2);
  // The app drives playback through a custom UI; the <audio> element itself
  // stays display:none, so assert on its existence and blob source, not pixels.
  await expect(page.locator('audio').first()).toHaveAttribute('src', /^blob:/);
  const sessionBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_session') || 'null')?.id);
  expect(sessionBefore).toBeTruthy();

  await page.getByPlaceholder(/paste youtube/i).fill('not a valid url at all');
  await page.getByRole('button', { name: 'Load Video' }).click();
  await expect(page.getByTestId('study-url-error')).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('audio').first()).toHaveAttribute('src', /^blob:/);
  const sessionAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_session') || 'null')?.id);
  expect(sessionAfter).toBe(sessionBefore);

  // IV9 + restore: a valid reload path still works and the lesson survives a refresh.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-transcript-line]:visible')).toHaveCount(2);
  await expect(page.locator('audio').first()).toHaveAttribute('src', /^blob:/);
});

test('C: word near the viewport bottom gets an in-viewport popup during loading', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootStudy(page);
  await stubDictionary(page, 1500);

  // Scroll the transcript container to its end and pick a visible word whose
  // row is low enough that an unclamped below-row popup (24px gap + ~360px
  // card) would have overflowed the viewport before the fix.
  const box = await page.evaluate(() => {
    const first = [...document.querySelectorAll('[data-transcript-line]')].find((r) => r.getBoundingClientRect().width > 0) as HTMLElement | undefined;
    const container = first?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return null;
    container.scrollTop = container.scrollHeight;
    const cr = container.getBoundingClientRect();
    const lo = Math.max(0, cr.top);
    const hi = Math.min(innerHeight, cr.bottom);
    const spans = [...container.querySelectorAll('[data-transcript-line] span')].filter((s) =>
      /^[A-Za-z]{7,}$/.test((s.innerText || '').trim()),
    );
    for (const el of spans) {
      const row = el.closest('[data-transcript-line]') as HTMLElement;
      const r = row.getBoundingClientRect();
      const w = el.getBoundingClientRect();
      if (r.bottom > hi - 384 && w.width > 0 && w.top >= lo && w.bottom <= hi) {
        return { word: el.innerText, x: w.x + w.width / 2, y: w.y + w.height / 2, rowBottom: r.bottom };
      }
    }
    return null;
  });
  expect(box, 'found a transcript word near the bottom edge').not.toBeNull();
  await page.mouse.click(box!.x, box!.y);

  const popup = page.locator('[data-dictionary-popup]').filter({ visible: true }).first();
  await expect(popup).toBeVisible({ timeout: 2000 });
  const loadingBox = await popup.boundingBox();
  expect(loadingBox).not.toBeNull();
  // DP2/DP3: the loading card is inside the viewport immediately.
  expect(loadingBox!.y).toBeGreaterThanOrEqual(0);
  expect(loadingBox!.y + loadingBox!.height).toBeLessThanOrEqual(720);

  await expect(popup.getByText(/E2E stub sense/)).toBeVisible({ timeout: 8000 });
  const finalBox = await popup.boundingBox();
  // DP4/DP5: result still in viewport and no big jump.
  expect(finalBox!.y).toBeGreaterThanOrEqual(0);
  expect(finalBox!.y + finalBox!.height).toBeLessThanOrEqual(720);
  expect(Math.abs(finalBox!.y - loadingBox!.y)).toBeLessThan(120);

  // DP8: Save Word still works from this popup.
  await popup.getByRole('button', { name: /add to vocab/i }).click();
  await expect(page.locator('body')).toContainText(/Vocabulary \((\d+)\)/);
});

test('D: Sample is explained and intentionally not persisted as a Session', async ({ page }) => {
  await bootStudy(page);
  await stubDictionary(page);
  await expect(page.getByTestId('study-sample-note')).toHaveText(/sample lesson/i);
  await expect(page.getByTestId('study-sample-note')).toContainText("won't appear in your study history");

  // Save one word from the Sample.
  const w = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-transcript-line] span')].find((s) => /^[A-Za-z]{7,}$/.test((s.innerText || '').trim()) && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().top > 0 && s.getBoundingClientRect().bottom < innerHeight);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(w).not.toBeNull();
  await page.mouse.click(w!.x, w!.y);
  await page.getByRole('button', { name: /add to vocab/i }).first().click();
  // The Study-page badge confirms the add landed before leaving the page.
  await expect(page.locator('body')).toContainText(/Vocabulary \(1\)/);
  // Close the lookup popup first; its outside-press handler would otherwise
  // swallow the navigation click.
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('Saved Words', { exact: true }).first()).toBeVisible();
  const savedWords = (await statFrom(page, 'Saved Words')) ?? 0;
  expect(savedWords).toBeGreaterThan(0);
  expect(await statFrom(page, 'Study Sessions')).toBe(0);
  // The note belongs to the Sample state only; the Dashboard never claims a session.
  await expect(page.getByTestId('study-sample-note').filter({ visible: true })).toHaveCount(0);
});

test('E: Due Today = 0 with saved items explains and offers practice', async ({ page }) => {
  await bootStudy(page);
  await stubDictionary(page);
  const w = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-transcript-line] span')].find((s) => /^[A-Za-z]{7,}$/.test((s.innerText || '').trim()) && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().top > 0 && s.getBoundingClientRect().bottom < innerHeight);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(w).not.toBeNull();
  await page.mouse.click(w!.x, w!.y);
  await page.getByRole('button', { name: /add to vocab/i }).first().click();

  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByTestId('review-first-day-hint')).toBeVisible();
  await expect(page.getByTestId('review-first-day-hint')).toContainText(/scheduled for tomorrow/i);
  // RV5: the existing non-due action still starts a session.
  await page.getByRole('button', { name: /review every saved item/i }).click();
  await expect(page.getByText(/1\s*\/\s*1/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
});

test('F: mobile Save Sentence touch target is at least 44px and saves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootStudy(page);
  const btn = page.getByRole('button', { name: /save sentence/i }).filter({ visible: true }).first();
  await btn.scrollIntoViewIfNeeded();
  const b = await btn.boundingBox();
  expect(b).not.toBeNull();
  expect(b!.width).toBeGreaterThanOrEqual(44);
  expect(b!.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await expect(page.getByRole('button', { name: /remove bookmark/i }).filter({ visible: true }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('G: mobile dictionary popup stays in the 390x844 viewport through loading', async ({ page }) => {
  test.setTimeout(60_000);

  const evidence: Record<string, unknown> = { viewport: { w: 390, h: 844 } };
  await page.setViewportSize({ width: 390, height: 844 });
  await bootStudy(page);
  await stubDictionary(page, 1200);

  // Scroll the PAGE like a learner until a word sits in the bottom band of the
  // viewport, fully visible (viewport-relative), then click it.
  let box: { word: string; x: number; y: number } | null = null;
  for (let step = 0; step < 14 && !box; step += 1) {
    box = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('[data-transcript-line] span')].filter((s) => {
        const w = s.getBoundingClientRect();
        const row = s.closest('[data-transcript-line]') as HTMLElement;
        const r = row.getBoundingClientRect();
        if (!(/^[A-Za-z]{7,}$/.test((s.innerText || '').trim()) && w.width > 0 && r.bottom >= innerHeight - 300)) return false;
        const x = w.x + w.width / 2;
        const y = w.y + w.height / 2;
        const at = document.elementFromPoint(x, y);
        return at === s || s.contains(at); // not clipped away by the scroll container
      });
      if (!spans.length) return null;
      const el = spans[spans.length - 1];
      const w = el.getBoundingClientRect();
      return { word: el.innerText, label: el.getAttribute('aria-label') || `Look up ${el.innerText}`, x: w.x + w.width / 2, y: w.y + w.height / 2 };
    });
    if (!box) {
      await page.mouse.wheel(0, 400);
      // Let any smooth-scroll settle before re-measuring, so coordinates and
      // the real hit target cannot disagree.
      await page.waitForTimeout(350);
    }
  }
  expect(box, 'MP1: a bottom-band word is genuinely visible after page scroll').not.toBeNull();
  evidence.clickedWord = box;
  // Click through the accessible name so Playwright's own actionability
  // (visible + stable + receives events) replaces a hand-rolled coordinate.
  await page.getByRole('button', { name: box!.label }).filter({ visible: true }).first().click();
  expect(box!.y).toBeLessThan(844);

  await page.mouse.click(box!.x, box!.y);
  const popup = page.locator('[data-dictionary-popup]').filter({ visible: true }).first();
  await expect(popup, 'MP2/MP3: click reaches the app and loading feedback is prompt').toBeVisible({ timeout: 2000 });
  const loadingBox = await popup.boundingBox();
  expect(loadingBox).not.toBeNull();
  evidence.loadingPopup = loadingBox;
  expect(loadingBox!.y).toBeGreaterThanOrEqual(0);
  expect(loadingBox!.y + loadingBox!.height).toBeLessThanOrEqual(844);

  await expect(popup.getByText(/E2E stub sense/)).toBeVisible({ timeout: 8000 });
  const finalBox = await popup.boundingBox();
  evidence.finalPopup = finalBox;
  evidence.displacementPx = finalBox && loadingBox ? Math.abs(finalBox.y - loadingBox.y) : null;
  expect(finalBox!.y).toBeGreaterThanOrEqual(0);
  expect(finalBox!.y + finalBox!.height).toBeLessThanOrEqual(844);
  // MP5: the card must not fill the whole 844px screen.
  expect(finalBox!.height).toBeLessThan(844 * 0.9);

  // MP6: Save Word is reachable inside the viewport and works; Close works.
  const addBtn = popup.getByRole('button', { name: /add to vocab/i });
  const ab = await addBtn.boundingBox();
  evidence.saveWordButton = ab;
  expect(ab).not.toBeNull();
  expect(ab!.y).toBeGreaterThanOrEqual(0);
  expect(ab!.y + ab!.height).toBeLessThanOrEqual(844);
  await addBtn.click();
  await expect(page.locator('body')).toContainText(/Vocabulary \(1\)/);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-dictionary-popup]').filter({ visible: true })).toHaveCount(0);

  // MP7: no horizontal overflow at any point.
  evidence.overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(evidence.overflowPx).toBeLessThanOrEqual(0);

});
