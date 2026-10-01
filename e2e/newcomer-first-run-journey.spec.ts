import { test, expect, type Page } from '@playwright/test';

/**
 * ECHO-20260928-BATCH2-T3 — the new user's first three minutes, walked WITH
 * the onboarding tour instead of skipping it. The existing first-run spec
 * only proved the tour can be skipped; every step's content and anchor was
 * unverified.
 *
 * Two product defects were found while writing this journey and pinned as
 * test.fixme (evidence in ECHO-20260928-JOURNEY-E2E-BATCH2); BOTH are fixed
 * now (auto-start restored in LanguageChooser + FirstTimeTour; completion and
 * the Study handover routed through driver.js `onDestroyStarted`, which 1.8.0
 * requires because on the last step's Next click it drops the app's
 * `onDestroyed`):
 *
 * ✅ Defect 1 — the tour never auto-starts: `89df463` removed the
 * `setTimeout(startTour, 700)` and the chooser's dispatch; both restored.
 * ✅ Defect 2 — finishing the dashboard tour did not hand over to Study.
 * The last-step Next now navigates to /study, writes the completion flag and
 * starts the Study-page tour.
 */

const DASHBOARD_TITLES = [
  'Welcome to EchoLearn',
  'Start studying from a video',
  'Keep learning over time',
  'Next: the Study page',
];

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

async function popoverTitle(page: Page): Promise<string> {
  const title = page.locator('.driver-popover-title');
  await title.waitFor({ state: 'visible', timeout: 20_000 });
  return (await title.textContent())?.trim() ?? '';
}

test.describe('New user first three minutes (tour walked, not skipped)', () => {
  // Defect 1 fixed — the tour must start by itself after the language choice.
  test('the tour auto-starts for a first-time user who chooses a language', async ({ page }) => {
    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('.driver-popover-title')).toBeVisible({ timeout: 10_000 });
    expect(await popoverTitle(page)).toBe(DASHBOARD_TITLES[0]);
  });

  // Defect 2 fixed — walking the auto-started tour to the end hands over to
  // the Study page, writes the completion flag and starts the Study tour.
  test('the walked tour points at real elements, hands over to Study, and completes', async ({ page }) => {
    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();

    // ── Dashboard tour auto-starts and walks with real content ────
    for (let i = 0; i < DASHBOARD_TITLES.length; i++) {
      expect(await popoverTitle(page), `dashboard step ${i + 1}`).toBe(DASHBOARD_TITLES[i]);
      const progress = await page.locator('.driver-popover-progress-text').textContent();
      expect(progress?.trim()).toBe(`${i + 1} of ${DASHBOARD_TITLES.length}`);
      if (i < DASHBOARD_TITLES.length - 1) await page.locator('.driver-popover-next-btn').click();
    }

    // ── The handover: last-step Next → Study page + completion flag ──
    await page.locator('.driver-popover-next-btn').click();
    await expect(page).toHaveURL(/\/study$/, { timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem('echolearn-tour-completed-v1'))).toBe('1');

    // The Study-page tour starts over the bundled sample transcript — close
    // it so the lookup/save below can be clicked without the overlay.
    await expect(page.locator('.driver-popover-title')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);

    // ── First lookup and first save, right where the tour pointed ──
    await page.getByRole('button', { name: 'Look up Good', exact: true }).filter({ visible: true }).first().click();
    await page.locator('#tour-transcript-save-word').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#tour-transcript-save-word').click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' }).first())
      .toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');

    await page.goto('/vocabulary');
    await expect(page.getByText(/1 words/)).toBeVisible();

    // ── Reload: the tour must not come back ────────────────────────
    await page.reload();
    await expect(page.getByRole('link', { name: 'Vocabulary' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await expect(page.locator('.driver-overlay')).toHaveCount(0);
  });

  // ✅ The replay path (Settings → Replay guide) still walks the four
  // dashboard steps with real content. The tour now auto-starts after the
  // language choice, so it is dismissed first; replay (force) restarts it.
  test('the replayable dashboard tour walks its four steps with real content', async ({ page }) => {
    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('.driver-popover-title')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: /Replay guide/i }).click();

    for (let i = 0; i < DASHBOARD_TITLES.length; i++) {
      expect(await popoverTitle(page), `dashboard step ${i + 1}`).toBe(DASHBOARD_TITLES[i]);
      const progress = await page.locator('.driver-popover-progress-text').textContent();
      expect(progress?.trim()).toBe(`${i + 1} of ${DASHBOARD_TITLES.length}`);
      if (i < DASHBOARD_TITLES.length - 1) await page.locator('.driver-popover-next-btn').click();
    }
  });
});
