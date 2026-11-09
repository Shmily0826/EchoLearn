import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * Regression — English UI must never leak hardcoded Chinese (Bug 2).
 *
 * Default locale is English. After a successful caption load, the toast / source
 * label must read English ("YouTube official subtitles") and must NOT contain
 * the hardcoded Chinese literals that previously shipped ("来源：", "YouTube 官方字幕",
 * "加载中…", "视频仍在准备中").
 *
 * External requests are blocked so the test exercises a mocked same-origin
 * /api/transcript response with a YouTube source payload.
 */

const SAMPLE_VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function transcriptPayload(lines: { start: number; end: number; text: string }[]) {
  return JSON.stringify({ lines, language: 'en', source: 'youtube' });
}

async function seedCleanVisitor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_current_session');
    localStorage.setItem('echolearn_lang', 'en');
  });
}

async function routeTranscript(page: Page) {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.route(/^http:\/\/(?:localhost|127\.0\.0\.1):5173\/api\/transcript\b/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: transcriptPayload([
        { start: 0, end: 2, text: 'Hummingbirds visit the garden' },
        { start: 2, end: 4, text: 'Welcome to this lesson' },
      ]),
    }),
  );
}

test('English UI shows no hardcoded Chinese after a successful load', async ({ page }) => {
  await seedCleanVisitor(page);
  await routeTranscript(page);

  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await page.waitForTimeout(2000);

  const urlInput = page.locator('#tour-study-url');
  await urlInput.fill(SAMPLE_VIDEO_URL);
  await page.locator('#tour-study-load').click();

  // Wait for a word only present in the loaded transcript, not the bundled sample.
  await expect(page.getByText('Hummingbirds', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20000 });

  // The source label must be English.
  await expect(page.getByText('YouTube official subtitles')).toBeVisible();

  // And the page must NOT contain the previously-hardcoded Chinese literals.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('来源：');
  expect(bodyText).not.toContain('YouTube 官方字幕');
  expect(bodyText).not.toContain('加载中');
  expect(bodyText).not.toContain('视频仍在准备中');
  expect(bodyText).not.toContain('前往平台观看');
});
