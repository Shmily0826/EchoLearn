import type { Page } from '@playwright/test';

/** Install the explicit marker before the page's first application script. */
export async function installAnalyticsTestTraffic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('echolearn_test_traffic', '1');
  });
}
