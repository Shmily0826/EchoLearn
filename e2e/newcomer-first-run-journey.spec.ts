import { test, expect, type Page } from '@playwright/test';

/**
 * ECHO-20260928-BATCH2-T3 — the new user's first three minutes, walked WITH
 * the onboarding tour instead of skipping it. The existing first-run spec
 * only proved the tour can be skipped; every step's content and anchor was
 * unverified.
 *
 * Two product defects were found while writing this journey and are pinned
 * here as test.fixme (evidence in ECHO-20260928-JOURNEY-E2E-BATCH2):
 *
 * 🔴 Defect 1 — the tour never auto-starts. The original implementation
 * (d0e7646) scheduled `setTimeout(() => startTour(false), 700)` on mount;
 * `89df463 fix: streamline core learning journey` removed that line and
 * nothing re-added it, so `TOUR_START_EVENT` is only ever dispatched by
 * Settings → "Replay guide". A first-time guest who chooses English never
 * sees a popover (measured: timeout on `.driver-popover-title`).
 *
 * 🔴 Defect 2 — finishing the dashboard tour does not hand over. On the last
 * step's Next click driver.js 1.8.0 removes its popover but the app's
 * `onDestroyed` callback never runs (measured: completion flag stays unset,
 * URL stays `/`), so the tour can never reach the Study page and the
 * completion flag is never written. With an `onDestroyStarted` probe added
 * the driver stays open on the final step, proving the click does reach the
 * destroy path; the app callbacks are skipped inside it (mechanism inferred,
 * not directly observed). Because the handover is the only path into the
 * Study-page tour, those steps are currently unreachable in-app and are not
 * covered here.
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
  // 🔴 Pinned defect 1 — turn this back into a live test when the auto-start
  // is restored or the product decision ("replay only") lands.
  test.fixme('the tour auto-starts for a first-time user who chooses a language', async ({ page }) => {
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

  // 🔴 Pinned defect 2 — the final-step handover (tour → Study page →
  // completion flag) never fires. Re-enable and extend with the Study-page
  // tour steps once defect 1/2 are fixed.
  test.fixme('the walked tour points at real elements, hands over to Study, and completes', async ({ page }) => {
    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());

    // Fresh guest + language, then the only working entry: Replay guide.
    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Study' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: /Replay guide/i }).click();

    // ── Dashboard tour: titles and progress must line up ──────────
    for (let i = 0; i < DASHBOARD_TITLES.length; i++) {
      expect(await popoverTitle(page), `dashboard step ${i + 1}`).toBe(DASHBOARD_TITLES[i]);
      const progress = await page.locator('.driver-popover-progress-text').textContent();
      expect(progress?.trim()).toBe(`${i + 1} of ${DASHBOARD_TITLES.length}`);
      if (i < DASHBOARD_TITLES.length - 1) await page.locator('.driver-popover-next-btn').click();
    }

    // ── The handover that never happens (defect 2) ────────────────
    await page.locator('.driver-popover-next-btn').click();
    await expect(page).toHaveURL(/\/study$/, { timeout: 15_000 });
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('echolearn-tour-completed-v1'))).toBe('1');

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

  // ✅ What DOES work today, pinned so it cannot silently regress: walking
  // the dashboard steps themselves (content + progress, real driver popovers).
  test('the replayable dashboard tour walks its four steps with real content', async ({ page }) => {
    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Study' }).first()).toBeVisible({ timeout: 15_000 });
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
