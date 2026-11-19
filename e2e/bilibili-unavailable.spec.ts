import { test, expect } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

test('accepts only YouTube links without advertising removed features', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.goto('/study');
  await expect(page.getByText('Bilibili is temporarily unavailable', { exact: false })).toHaveCount(0);
  await page.getByPlaceholder('Paste YouTube URL or video ID...').fill('https://b23.tv/nbSyQzx');
  await page.getByRole('button', { name: 'Load Video' }).click();
  await expect(page.getByTestId('study-url-error')).toHaveText('Enter a valid YouTube video URL or ID.');
  await expect(page.getByRole('button', { name: /generate transcript/i })).toHaveCount(0);
});

test('caption failures do not offer speech transcription', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    return /^http:\/\/(localhost|127\.0\.0\.1):5173\//.test(url) ? route.continue() : route.abort();
  });
  await page.route('**/api/transcript**', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'asr_required', code: 'asr_required' }),
  }));
  await page.goto('/');
  await enterGuestMode(page);
  await page.goto('/study');
  await page.getByPlaceholder('Paste YouTube URL or video ID...').fill('https://www.youtube.com/watch?v=abcDEF12345');
  await page.getByRole('button', { name: 'Load Video' }).click();
  await expect(page.getByTestId('caption-error-card').filter({ visible: true }).first()).toBeVisible({ timeout: 40000 });
  await expect(page.getByRole('button', { name: /generate transcript/i })).toHaveCount(0);
  await expect(page.getByTestId('caption-error-card').filter({ visible: true }).first()).not.toContainText('transcribe');
});
