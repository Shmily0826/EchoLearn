import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { enterGuestMode } from './helpers/guestMode';

const routes = [
  { path: '/', label: 'Dashboard' },
  { path: '/vocabulary', label: 'Vocabulary' },
  { path: '/sentences', label: 'Sentences' },
  { path: '/review', label: 'Review' },
  { path: '/settings', label: 'Settings' },
] as const;

/**
 * Keep this suite away from third-party video hosts.
 *
 * The Study page embeds the YouTube player, which pulls the iframe API, the
 * player bundle and ad endpoints. Some of those (notably the Waa/ads calls)
 * answer datacenter egress IPs with 403, which surfaced here as an
 * unexplained "403 (Forbidden)" console error (CI runs 35158633844 and
 * 35159726225) while the same spec passed locally. Stub only those hosts so
 * the assertion measures the app, not a third party's IP policy.
 *
 * Everything else must keep flowing: Firebase resolves the auth state through
 * the auth.echo-learn.uk helper iframe, and stubbing that document left
 * AuthGate on "Loading…" forever.
 */
const THIRD_PARTY_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'ytimg.com',
  'ggpht.com',
  'doubleclick.net',
  'www.google.com',
  'jnn-pa.googleapis.com',
];

function isThirdPartyHost(hostname: string) {
  return THIRD_PARTY_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

async function stubYouTubeRequests(page: Page) {
  const ONE_PIXEL_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!/^https?:/.test(url)) return route.continue();
    if (!isThirdPartyHost(new URL(url).hostname)) return route.continue();
    const type = route.request().resourceType();
    if (type === 'document' || type === 'iframe') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    }
    if (type === 'script') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (type === 'image') {
      return route.fulfill({ status: 200, contentType: 'image/gif', body: ONE_PIXEL_GIF });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function startGuest(page: Page) {
  await stubYouTubeRequests(page);
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
  test('fresh guest can reach Study without a blocking tour', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.getByRole('button', { name: 'Try without login', exact: true }).click();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start studying', exact: true })).toBeVisible();
    await expect(page.locator('.driver-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start studying', exact: true }).click();
    await expect(page).toHaveURL(/\/study$/);
    await expectNoHorizontalOverflow(page);
  });

  test('mobile navigation and major pages fit without horizontal overflow', async ({ page }) => {
    const consoleErrors: string[] = [];
    // Keep the failing URL in the report: a bare "403 (Forbidden)" console
    // message does not say which resource was refused.
    const failedResponses: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });

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
    expect({
      consoleErrors: consoleErrors.filter((message) => !/favicon|service worker/i.test(message)),
      failedResponses,
    }).toEqual({ consoleErrors: [], failedResponses: [] });
  });

  test('Vocabulary filter toolbar wraps within a narrow mobile viewport', async ({ page }) => {
    await startGuest(page);
    await clickMobileNav(page, '/vocabulary', 'Vocabulary');
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
