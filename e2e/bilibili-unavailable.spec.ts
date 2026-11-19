import { test, expect } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

test('explains that Bilibili is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.goto('/study');
  await page.getByPlaceholder('Paste YouTube / Bilibili URL or BV id...').fill('https://b23.tv/nbSyQzx');
  await page.getByRole('button', { name: 'Load Video' }).click();
  await expect(page.getByTestId('study-url-error')).toContainText('Bilibili is temporarily unavailable');
});
