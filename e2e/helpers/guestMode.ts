import { expect, type Page } from '@playwright/test';

/**
 * Enter the guest shell and wait for the app-owned navigation invariant.
 *
 * The old specs used fixed delays after clicking guest mode. That made the
 * next navigation race React's AuthGate transition and the first-visit
 * overlays. This helper waits on the actual DOM state instead.
 */
export async function enterGuestMode(page: Page) {
  const guestButton = page.getByRole('button', { name: /^(Try without login|先体验一下)$/ });
  const englishButton = page.getByRole('button', { name: 'English', exact: true });
  const studyNav = page.locator('a[href="/study"]').filter({ visible: true });
  const needsLanguageChoice = await page.evaluate(() =>
    !localStorage.getItem('echolearn_lang') &&
    !localStorage.getItem('echolearn-lang-chosen'),
  );

  // AuthGate can briefly commit the guest shell while its initial auth
  // listener finishes. Observe the stable result and retry the user action if
  // the LoginPage is rendered again; do not advance on a transient hide.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await guestButton.isVisible().catch(() => false)) {
      await guestButton.click();
      await expect(guestButton).toBeHidden({ timeout: 10_000 });
    }
    await expect.poll(async () => {
      if (await englishButton.isVisible().catch(() => false)) return 'language';
      if (await studyNav.isVisible().catch(() => false)) return 'app';
      if (await guestButton.isVisible().catch(() => false)) return 'login';
      return 'transitioning';
    }, { timeout: 10_000 }).toMatch(/language|app|login/);
    if (await guestButton.isVisible().catch(() => false)) continue;
    break;
  }

  if (needsLanguageChoice) {
    await expect(englishButton).toBeVisible();
    await englishButton.click();
    await expect(englishButton).toBeHidden();
  }

  // ── FTUE tour suppression (specs that are not about the tour) ──
  // The tour auto-starts after a language choice (chooser dispatch) and via
  // the 700ms Dashboard timer. Tests opt out the way the app allows: close
  // any popover that opened, then write the completion flag so no pending
  // timer can open one mid-test (startTour re-reads the flag at fire time).
  try {
    await page.locator('.driver-popover').waitFor({ state: 'visible', timeout: 3_000 });
    await page.keyboard.press('Escape');
  } catch {
    /* no tour opened for this flow */
  }
  await page.evaluate(() => localStorage.setItem('echolearn-tour-completed-v1', '1'));
  await expect(page.locator('.driver-popover')).toHaveCount(0);
  await expect(page.locator('.driver-overlay')).toHaveCount(0);

  // Keep this helper focused on the stable app-shell navigation invariant.
  await expect(studyNav).toBeVisible();
}
