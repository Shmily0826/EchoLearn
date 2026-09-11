import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeAnalyticsSuppression,
  isAnalyticsSuppressed,
} from './analyticsSuppression';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

const session = createStorage();

beforeEach(() => {
  session.clear();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/' },
    history: { state: null, replaceState: vi.fn() },
  });
});

describe('analytics suppression', () => {
  it('is off for a normal session and does not use localStorage', () => {
    expect(isAnalyticsSuppressed()).toBe(false);
    expect(session.getItem('echolearn_test_traffic')).toBeNull();
  });

  it('uses the explicit session marker', () => {
    session.setItem('echolearn_test_traffic', '1');
    expect(isAnalyticsSuppressed()).toBe(true);
    expect(session.getItem('echolearn_test_traffic')).toBe('1');
  });

  it('marks dogfood traffic and removes only dogfood from the URL', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost/study?foo=bar&dogfood=1&baz=qux#word' },
      history: { state: { page: 1 }, replaceState },
    });

    initializeAnalyticsSuppression();

    expect(isAnalyticsSuppressed()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      { page: 1 },
      '',
      '/study?foo=bar&baz=qux#word',
    );
  });
});
