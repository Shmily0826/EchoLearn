import { test, expect } from '@playwright/test';
import { openSignedInApp, SYNTHETIC_IDENTITY } from './helpers/sessionFixture';

/**
 * Contract guard for the signed-in session fixture.
 *
 * Anonymous guests are the default in this suite, so a fabricated session that
 * silently stopped working would show up as unrelated-looking failures across
 * every authenticated spec. These tests fail here, with a clear reason, if
 * Firebase changes the persistence shape this fixture depends on.
 */
test.describe('signed-in session fixture', () => {
  test('boots the authenticated shell without letting a Firebase request out', async ({ context, page }) => {
    const log = await openSignedInApp(context, page);

    // openSignedInApp already asserts the shell rendered. Assert the mechanism
    // too: if the SDK never attempted an auth call, the boot could be passing
    // for some other reason and this fixture would be untrustworthy.
    expect(
      log.intercepted.length,
      'the SDK never attempted a Firebase auth call, so the fixture may be passing for the wrong reason',
    ).toBeGreaterThan(0);

    // Anything we aborted must be a Firebase data/telemetry host. Aborting an
    // app asset (for example the dev server's /src/services/firestoreSync.ts)
    // would blank the page, which is the failure this assertion documents.
    for (const url of log.aborted) {
      expect(url, 'a non-Firebase request was aborted; check the hostname matching').toMatch(
        /^https:\/\/(firestore\.googleapis\.com|jnn-pa\.googleapis\.com|[a-z0-9-]+\.firebaseio\.com)\//,
      );
    }
  });

  test('the app adopts the fabricated identity', async ({ context, page }) => {
    await openSignedInApp(context, page);

    // The dashboard is rendered for a signed-in user, not the login page.
    await expect(page.getByText(/Welcome back|欢迎回来/i).first()).toBeVisible({ timeout: 20_000 });

    // And the account page reports the synthetic address rather than a real one.
    const settingsNav = page.locator('a[href="/settings"]').filter({ visible: true }).first();
    if (await settingsNav.isVisible().catch(() => false)) {
      await settingsNav.click();
      await page.waitForURL(/\/settings$/, { timeout: 20_000 });
      await expect(page.getByText(SYNTHETIC_IDENTITY.email).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});
