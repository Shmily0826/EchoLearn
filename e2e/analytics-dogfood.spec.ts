import { test, expect } from '@playwright/test';
import { installAnalyticsTestTraffic } from './helpers/analyticsTraffic';

test('dogfood query marks the session and cleans only its query parameter', async ({ page }) => {
  await page.goto('/?keep=1&dogfood=1');

  await expect(page).toHaveURL(/\/\?keep=1$/);
  await expect(page.getByRole('button', { name: /Try without login|先体验一下/ })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('echolearn_test_traffic'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('echolearn_test_traffic'))).toBeNull();
});

test('automation helper installs the marker before app navigation', async ({ page }) => {
  await installAnalyticsTestTraffic(page);
  await page.goto('/');

  expect(await page.evaluate(() => sessionStorage.getItem('echolearn_test_traffic'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('echolearn_test_traffic'))).toBeNull();
});

test('a fresh browser context starts without the test marker', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/');

  expect(await page.evaluate(() => sessionStorage.getItem('echolearn_test_traffic'))).toBeNull();
  await context.close();
});
