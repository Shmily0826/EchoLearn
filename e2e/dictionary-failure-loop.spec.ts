import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * Regression guard: the dictionary popup must stay render-stable when EVERY
 * lookup path fails persistently.
 *
 * Reproduces the field symptom seen in local dev (where `/api/dictionary`,
 * `/api/translate` and `/api/ai` do not exist): opening the popup fired
 * "Maximum update depth exceeded" roughly every 500ms, the console flooded
 * with errors, and the popup jittered so much that clicking
 * "查看词典参考释义" timed out.
 *
 * The mocked-success specs in `dictionary-semantics.spec.ts` cannot catch
 * this, because a successful lookup never enters the repeated-failure path.
 *
 * AC for the fix: this spec passes. Before the fix it fails with a non-empty
 * `depthErrors` array (and usually a click timeout).
 */

const WORD = 'good';

async function failAllDictionaryPaths(page: Page) {
  // 502 mirrors what `vite dev` returns for the missing Vercel functions.
  await page.route('**/api/dictionary*', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/translate**', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/ai**', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }));
}

async function openPopupOnFailingBackend(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'zh');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.goto('/study');
  await expect(page.locator('a[href="/study"]').first()).toBeVisible({ timeout: 15_000 });

  const word = page.getByText(WORD, { exact: true }).filter({ visible: true }).first();
  await expect(word).toBeVisible({ timeout: 20_000 });
  await word.click();
  await expect(page.locator('#tour-transcript-save-word')).toBeVisible({ timeout: 20_000 });
}

test('popup stays render-stable and clickable when every dictionary path fails', async ({ page }) => {
  const depthErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Maximum update depth exceeded')) {
      depthErrors.push(msg.text());
    }
  });

  await failAllDictionaryPaths(page);
  await openPopupOnFailingBackend(page);

  // Give any render loop time to manifest. Before the fix this fills within
  // a couple of seconds; after the fix it stays empty.
  await page.waitForTimeout(4_000);

  // The user-visible symptom: the popup must remain interactive. Before the
  // fix this click timed out because the card never stabilised.
  const disclosure = page.getByRole('button', { name: '查看词典参考释义' });
  if (await disclosure.count()) {
    await disclosure.click({ timeout: 10_000 });
  }

  expect(depthErrors, `render loop fired ${depthErrors.length}x`).toEqual([]);
});
