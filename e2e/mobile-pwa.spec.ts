import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { enterGuestMode } from './helpers/guestMode';

const routes = [
  { path: '/', label: 'Dashboard' },
  { path: '/vocabulary', label: 'Words' },
  { path: '/sentences', label: 'Sentences' },
  { path: '/review', label: 'Review' },
  { path: '/settings', label: 'Settings' },
] as const;

async function startGuest(page: Page) {
  await page.route('**/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
  });
  await page.goto('/');
  await enterGuestMode(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  )).toBe(true);
}

async function clickMobileNav(page: Page, path: string, label: string) {
  const link = page.locator(`nav a[href="${path}"]`).filter({ visible: true });
  await expect(link).toHaveText(label);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`));
}

test.describe('Batch 11 — mobile/PWA lifecycle', () => {
  test('mobile navigation and major pages fit without horizontal overflow', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await startGuest(page);
    await expect(page.locator('nav.md\\:hidden.fixed.bottom-0')).toBeVisible();

    for (const [index, route] of routes.entries()) {
      if (index > 0) await clickMobileNav(page, route.path, route.label);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator('main')).toBeVisible();
    }

    await clickMobileNav(page, '/study', 'Study');
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText('good', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });

    await clickMobileNav(page, '/', 'Dashboard');
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors.filter((message) => !/favicon|service worker/i.test(message))).toEqual([]);
  });

  test('Vocabulary filter toolbar wraps within a narrow mobile viewport', async ({ page }) => {
    await startGuest(page);
    await clickMobileNav(page, '/vocabulary', 'Words');
    await expectNoHorizontalOverflow(page);

    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('Study transcript remains usable across orientation and visibility changes', async ({ page }) => {
    await startGuest(page);
    await clickMobileNav(page, '/study', 'Study');
    await expect(page.getByText('good', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });

    const before = await page.locator('[data-transcript-line]').filter({ visible: true }).count();
    expect(before).toBeGreaterThan(0);

    await page.setViewportSize({ width: 800, height: 390 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 393, height: 873 });
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('[data-transcript-line]').filter({ visible: true }).first()).toBeVisible();
  });

  test('offline and reconnect do not crash the loaded guest shell', async ({ page }) => {
    await startGuest(page);
    const studyNav = page.locator('nav a[href="/study"]').filter({ visible: true });
    await expect(studyNav).toBeVisible();

    await page.context().setOffline(true);
    await expect(studyNav).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.context().setOffline(false);
    await clickMobileNav(page, '/study', 'Study');
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText('good', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('production PWA manifest exposes standalone metadata and valid icons', async ({ page }) => {
    await startGuest(page);
    const manifestPath = join(process.cwd(), 'dist', 'manifest.webmanifest');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    for (const icon of manifest.icons) {
      await expect(readFile(join(process.cwd(), 'dist', icon.src))).resolves.toBeTruthy();
    }
  });
});
