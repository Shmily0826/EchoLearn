import { test, expect } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

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

test('sample video study → save word → vocabulary and dashboard update', async ({
  page,
}) => {
  // Keep the save flow deterministic while preserving the real popup,
  // storage mutation, and Dashboard event/update path under test.
  await page.route('**/api/dictionary*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '/ɡʊd/',
        ipa_us: '/ɡʊd/',
        audio_url: '',
        base_form: 'good',
        source: 'free-dictionary',
        entries: [{
          pos: 'adjective',
          definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
        }],
      }),
    });
  });
  // This test covers the guest-to-save journey, not the separate first-visit
  // onboarding flow. Seed its completed state so the golden path starts at a
  // deterministic app boundary.
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);

  // ── Study: the sample transcript renders without any network fetch ──
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  // The word exists in both the desktop panel and the hidden mobile copy —
  // keep only the visible one. 'Good' has an unchanged lemma.
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
  // Saving awaits dictionary enrichment and then persists. The popup closing
  // marks completion — wait for it before navigating.
  await expect(saveButton).toBeHidden({ timeout: 45_000 });

  // ── Words page lists the saved word ──
  await page.getByRole('link', { name: 'Words' }).click();
  await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
  // The card renders the headword together with its phonetic (when the
  // dictionary answered), so match on a leading-word regex instead of exact.
  await expect(
    page.getByText(/^good\b/).filter({ visible: true }).first(),
  ).toBeVisible();

  // ── Dashboard counter reflects the same-tab save without reload ──
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const savedWordsLabel = page.getByText('Saved Words', { exact: true });
  await expect(savedWordsLabel).toBeVisible();
  const counter = savedWordsLabel.locator('xpath=preceding-sibling::p[1]');
  await expect(counter).toHaveText('1');
});
