import { test, expect, type Page } from '@playwright/test';

/**
 * ErrorBoundary destructive-action confirmation — browser-level regression.
 *
 * Deterministic trigger: abort the lazy module request for an unvisited route
 * (dev serves /src/pages/VocabularyPage.tsx) so the route boundary renders with
 * "Something went wrong". No real failure, no Firebase, no provider traffic.
 *
 * Contract (EB1–EB5, EB8, EB10):
 *  - "Clear Data & Reload" opens a confirmation instead of clearing;
 *  - Cancel preserves every local learning key and does not reload;
 *  - explicit confirm clears ONLY echolearn_ keys and reloads;
 *  - unrelated keys survive.
 */

async function enterGuest(page: Page) {
  // Seed ONCE: addInitScript reruns after the confirm-reload, which would
  // re-create the echolearn_ keys and mask the cleared state.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__eb_seeded')) return;
    sessionStorage.setItem('__eb_seeded', '1');
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'w1', word: 'final' }]));
    localStorage.setItem('echolearn_session', JSON.stringify({ id: 'session_e2e', title: 'x.wav' }));
    localStorage.setItem('unrelated_key', 'keep me');
  });
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    const g = page.getByRole('button', { name: /^(Try without login|先体验一下)$/ });
    if (await g.isVisible().catch(() => false)) {
      await g.click();
      await g.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    }
    if (await page.locator('a[href="/study"]').filter({ visible: true }).isVisible().catch(() => false)) break;
  }
  const en = page.getByRole('button', { name: 'English', exact: true });
  if (await en.isVisible().catch(() => false)) await en.click();
}

async function openBrokenRoute(page: Page) {
  // Abort the unvisited route's lazy chunk so the route-level ErrorBoundary renders.
  await page.route('**/src/pages/VocabularyPage.tsx*', (route) => route.abort());
  await page.locator('a[href="/vocabulary"]').filter({ visible: true }).first().click();
  await page.getByRole('heading', { name: /Something went wrong/ }).waitFor({ state: 'visible', timeout: 15000 });
}

async function clickClearData(page: Page) {
  await page.getByTestId('error-clear-reload').click();
}

test('Cancel preserves every local learning key', async ({ page }) => {
  await enterGuest(page);
  await openBrokenRoute(page);

  await clickClearData(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Clear local learning data\?/);

  // a marker that only survives if the page is NOT reloaded
  await page.evaluate(() => { (window as unknown as { __ebMarker?: string }).__ebMarker = 'alive'; });

  await dialog.getByRole('button', { name: /^Cancel$/ }).click();
  await expect(dialog).toBeHidden();
  // EB3: no reload happened
  const marker = await page.evaluate(() => (window as unknown as { __ebMarker?: string }).__ebMarker);
  expect(marker).toBe('alive');
  // EB2/EB5: data untouched, Reload Page still available and did not clear anything
  const stored = await page.evaluate(() => ({
    vocab: localStorage.getItem('echolearn_vocabulary'),
    session: localStorage.getItem('echolearn_session'),
    unrelated: localStorage.getItem('unrelated_key'),
  }));
  expect(stored.vocab).toContain('final');
  expect(stored.session).toContain('session_e2e');
  expect(stored.unrelated).toBe('keep me');
  await expect(page.getByRole('button', { name: /Reload Page/i })).toBeVisible();
});

test('explicit confirm clears only echolearn_ keys and reloads', async ({ page }) => {
  await enterGuest(page);
  await openBrokenRoute(page);

  await clickClearData(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  await page.evaluate(() => { (window as unknown as { __ebMarker?: string }).__ebMarker = 'alive'; });
  await dialog.getByTestId('error-confirm-clear').click();

  // EB4: the reload actually happens (marker cannot survive a navigation)
  await page.waitForFunction(() => (window as unknown as { __ebMarker?: string }).__ebMarker === undefined, { timeout: 15000 });
  // EB10: only echolearn_ keys were removed; unrelated keys survive
  const afterReload = await page.evaluate(() => ({
    vocab: localStorage.getItem('echolearn_vocabulary'),
    session: localStorage.getItem('echolearn_session'),
    lang: localStorage.getItem('echolearn_lang'),
    unrelated: localStorage.getItem('unrelated_key'),
  }));
  expect(afterReload.vocab).toBeNull();
  expect(afterReload.session).toBeNull();
  expect(afterReload.lang).toBeNull();
  expect(afterReload.unrelated).toBe('keep me');
});
