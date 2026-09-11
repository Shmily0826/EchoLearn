const TEST_TRAFFIC_KEY = 'echolearn_test_traffic';

export function isAnalyticsSuppressed(): boolean {
  try {
    return sessionStorage.getItem(TEST_TRAFFIC_KEY) === '1';
  } catch {
    return false;
  }
}

export function initializeAnalyticsSuppression(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (url.searchParams.get('dogfood') !== '1') return;

  try {
    sessionStorage.setItem(TEST_TRAFFIC_KEY, '1');
  } catch {
    return;
  }

  url.searchParams.delete('dogfood');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
