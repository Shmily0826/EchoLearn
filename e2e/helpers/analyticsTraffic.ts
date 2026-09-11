import type { Page } from '@playwright/test';

const VERCEL_ANALYTICS_HOSTS = new Set([
  'va.vercel-scripts.com',
]);
const GOOGLE_ANALYTICS_HOSTS = new Set([
  'www.google-analytics.com',
  'region1.google-analytics.com',
  'region2.google-analytics.com',
  'analytics.google.com',
]);

/** Classify known visitor/product analytics collection requests, excluding Sentry. */
export function isAnalyticsRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.pathname === '/_vercel/insights' || parsed.pathname.startsWith('/_vercel/insights/')) {
    return true;
  }
  if (VERCEL_ANALYTICS_HOSTS.has(parsed.hostname)) {
    return parsed.pathname === '/v1/script.js' || parsed.pathname === '/v1/view';
  }
  if (parsed.hostname === 'www.googletagmanager.com' && parsed.pathname === '/gtag/js') {
    return true;
  }
  if (GOOGLE_ANALYTICS_HOSTS.has(parsed.hostname)) {
    return parsed.pathname === '/collect' || parsed.pathname === '/g/collect' || parsed.pathname === '/j/collect';
  }
  return (parsed.hostname === 'app-measurement.com' && parsed.pathname === '/a')
    || (parsed.hostname === 'firebaselogging.googleapis.com' && parsed.pathname === '/v0cc/log');
}

/** Install the explicit marker before the page's first application script. */
export async function installAnalyticsTestTraffic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('echolearn_test_traffic', '1');
  });
}
