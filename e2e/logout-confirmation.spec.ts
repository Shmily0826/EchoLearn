// Logout confirmation (unverified + data at risk) — ECHO_LOGOUT_SAFETY_UX_V1.
// Uses the synthetic-session fixture, so no real Firebase/Production access is
// needed: the whole auth surface is intercepted (see e2e/helpers/sessionFixture).
import { expect, test, type Page } from '@playwright/test';
import { SYNTHETIC_IDENTITY, SYNTHETIC_IDENTITY_UNVERIFIED, openSignedInApp } from './helpers/sessionFixture';

const SEED_VOCAB = JSON.stringify([{ id: 'w1', word: 'shadow', meaningCn: '影子', context: 'shadow of doubt', addedAt: 1, mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 1 }]);

async function gotoSettings(page: Page, vocab: string | null, identity: typeof SYNTHETIC_IDENTITY, lang = 'en'): Promise<void> {
  await page.addInitScript(({ vocab, lang }) => {
    if (vocab) localStorage.setItem('echolearn_vocabulary', vocab);
    localStorage.setItem('echolearn_lang', lang);
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_guest_mode');
  }, { vocab, lang });
  await openSignedInApp(page.context(), page, identity);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  // The Sign Out button exists in both languages; the h1 does not.
  await expect(page.getByRole('button', { name: /sign out|退出登录/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Logout confirmation (unverified + data at risk)', () => {

  test('C: unverified with local data — confirm flow clears data at the boundary', async ({ page }) => {
    await gotoSettings(page, SEED_VOCAB, SYNTHETIC_IDENTITY_UNVERIFIED);

    // UX1: Sign Out must not immediately run the destructive logout.
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Your email isn't verified yet", { exact: false })).toBeVisible();
    // Still signed in: the account heading and the vocabulary survive.
    await expect(page.getByRole('button', { name: 'Sign Out' }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).not.toBeNull();

    // UX2: Cancel keeps the session, data, and sync metadata untouched.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('echolearn_firebase_sync_pending'))).toBeNull();

    // Escape closes the dialog too (UX8), still without logging out.
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).not.toBeNull();

    // UX3/UX5: explicit confirm runs the boundary — logged out, data cleared.
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /sign out and clear data/i }).click();
    await expect(page.getByRole('button', { name: /try without login/i })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).toBeNull();
  });

  test('UX7: confirm double-click stays pending and runs the logout once', async ({ page }) => {
    await gotoSettings(page, SEED_VOCAB, SYNTHETIC_IDENTITY_UNVERIFIED);

    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Double-click: the confirmSignOut pending guard must let logOut run at
    // most once. The unverified logout completes quickly, so the observable
    // contract is the final state: logged out, data cleared, and NO error
    // message (a second logOut attempt on a dead session would surface one).
    const proceed = dialog.getByRole('button', { name: /sign out and clear data/i });
    await proceed.dblclick();
    await expect(page.getByRole('button', { name: /try without login/i })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).toBeNull();
    await expect(page.getByText(/sign out failed|could not be safely synced/i)).toHaveCount(0);
  });

  test('B: unverified with nothing at risk signs out directly, no dialog', async ({ page }) => {
    await gotoSettings(page, null, SYNTHETIC_IDENTITY_UNVERIFIED);
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /try without login/i })).toBeVisible({ timeout: 15_000 });
  });

  test('A: verified account signs out directly, no dialog (UX6 — no regression)', async ({ page }) => {
    await gotoSettings(page, SEED_VOCAB, SYNTHETIC_IDENTITY);
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    // UX6 no-regression contract: the confirmation dialog must never appear for
    // a verified account. (The full verified logout with data cannot complete
    // in this fully-intercepted environment — the sync guard honestly blocks
    // it — which is the pre-existing behavior, not this feature's concern.)
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign Out' }).first()).toBeVisible();
  });

  test('UX8: the confirmation renders in Chinese for the zh UI', async ({ page }) => {
    await gotoSettings(page, SEED_VOCAB, SYNTHETIC_IDENTITY_UNVERIFIED);
    // The fixture's init script re-pins en on every load; use the app's own
    // language toggle instead of localStorage.
    await page.getByRole('button', { name: /switch to chinese|EN 中/i }).first().click();
    await expect(page.getByRole('button', { name: /退出登录/ }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /退出登录/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('退出登录？')).toBeVisible();
    await expect(dialog.getByText('尚未同步的数据可能无法恢复', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '仍要退出并清除数据' })).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /退出登录/ }).first()).toBeVisible();
  });
});
