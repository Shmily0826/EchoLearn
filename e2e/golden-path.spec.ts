import { test, expect } from '@playwright/test';

/**
 * Golden-path E2E — fully local, no external services.
 *
 * The Study page preloads a bundled sample video ("Do schools kill
 * creativity?", transcript included), so the whole journey runs without
 * YouTube/Bilibili/AI access:
 *
 *   guest login → Study renders sample transcript → click a word →
 *   dictionary popup → save to vocabulary → Words page lists it →
 *   Dashboard "Saved Words" counter updates.
 */

async function dismissOnboarding(page: import('@playwright/test').Page) {
  await page.waitForTimeout(1500);
  // First-visit overlays: language chooser, then the guided-tour dialog.
  // They render asynchronously — poll until neither is visible.
  for (let i = 0; i < 5; i++) {
    const english = page.getByRole('button', { name: 'English', exact: true });
    if (await english.isVisible()) {
      await english.click();
      await page.waitForTimeout(400);
      continue;
    }
    const close = page.getByRole('button', { name: 'Close', exact: true });
    if (await close.isVisible()) {
      await close.click();
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }
}

test('sample video study → save word → vocabulary and dashboard update', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without login' }).click();
  await page.waitForTimeout(800);
  await dismissOnboarding(page);

  // ── Study: the sample transcript renders without any network fetch ──
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  // The word exists in both the desktop panel and the hidden mobile copy —
  // keep only the visible one. NOTE: 'Good' is chosen deliberately: its lemma
  // is itself. Words like 'morning' lemmatize to 'morne' (known lemmatizer
  // quirk) and would be saved under the wrong headword.
  const good = page
    .getByText('good', { exact: true })
    .filter({ visible: true })
    .first();
  await expect(good).toBeVisible({ timeout: 15_000 });

  // ── Click the word → dictionary popup opens with the save button ──
  await good.click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  // Saving first awaits the dictionary enrichment (several seconds when the
  // dictionary backends are slow/unavailable) and only then persists. The
  // popup closing marks completion — wait for it before navigating.
  await expect(saveButton).toBeHidden({ timeout: 45_000 });

  // ── Words page lists the saved word ──
  await page.getByRole('link', { name: 'Words' }).click();
  await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
  // The card renders the headword together with its phonetic (when the
  // dictionary answered), so match on a leading-word regex instead of exact.
  await expect(
    page.getByText(/^good\b/).filter({ visible: true }).first(),
  ).toBeVisible();

  // ── Dashboard counter reflects the save after a reload ──
  // (Dashboard reads the stats on mount; the always-mounted SPA shell does
  // not live-refresh them on save. Guest login also resets on reload — both
  // re-entered here, which also asserts the save truly persisted to disk.)
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Try without login' }).click();
  await page.waitForTimeout(1000);
  await dismissOnboarding(page);
  const savedWordsLabel = page.getByText('Saved Words', { exact: true });
  await expect(savedWordsLabel).toBeVisible();
  const counter = savedWordsLabel.locator('xpath=preceding-sibling::p[1]');
  await expect(counter).toHaveText('1');
});
