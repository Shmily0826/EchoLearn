import { test, expect } from '@playwright/test';
import { installAnalyticsTestTraffic, isAnalyticsRequest } from './helpers/analyticsTraffic';

test('dogfood query marks the session and cleans only its query parameter', async ({ page }) => {
  const requestUrls: string[] = [];
  page.on('request', (request) => requestUrls.push(request.url()));
  await page.goto('/?keep=1&dogfood=1');

  await expect(page).toHaveURL(/\/\?keep=1$/);
  await expect(page.getByRole('button', { name: /Try without login|先体验一下/ })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('echolearn_test_traffic'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('echolearn_test_traffic'))).toBeNull();
  expect(requestUrls.filter(isAnalyticsRequest)).toHaveLength(0);
  expect(isAnalyticsRequest('https://echo-learn.uk/_vercel/insights/view')).toBe(true);
  expect(isAnalyticsRequest('https://www.google-analytics.com/g/collect?v=2')).toBe(true);
  expect(isAnalyticsRequest('https://o123.ingest.sentry.io/api/456/envelope/')).toBe(false);
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
