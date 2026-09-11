import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  getAnalytics: vi.fn(() => ({})),
  isSupported: vi.fn(async () => true),
  logEvent: vi.fn(),
}));

vi.mock('@vercel/analytics', () => ({ track: mocks.track }));
vi.mock('firebase/analytics', () => ({
  getAnalytics: mocks.getAnalytics,
  isSupported: mocks.isSupported,
  logEvent: mocks.logEvent,
}));
vi.mock('../lib/firebase', () => ({ default: {} }));

import { trackEvent } from './analytics';

const session = {
  value: null as string | null,
  getItem: () => session.value,
  setItem: (_key: string, value: string) => { session.value = value; },
  removeItem: () => { session.value = null; },
  clear: () => { session.value = null; },
};

beforeEach(() => {
  session.clear();
  vi.stubGlobal('sessionStorage', session);
  vi.stubEnv('PROD', true);
  mocks.track.mockClear();
  mocks.getAnalytics.mockClear();
  mocks.isSupported.mockClear();
  mocks.logEvent.mockClear();
});

describe('trackEvent', () => {
  it('keeps the normal Vercel and Firebase paths', async () => {
    trackEvent('word_saved', { source: 'test' });
    await vi.waitFor(() => expect(mocks.logEvent).toHaveBeenCalled());

    expect(mocks.track).toHaveBeenCalledWith('word_saved', { source: 'test' });
    expect(mocks.isSupported).toHaveBeenCalled();
    expect(mocks.getAnalytics).toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith({}, 'word_saved', { source: 'test' });
  });

  it('does not call either destination for explicit test traffic', async () => {
    session.setItem('echolearn_test_traffic', '1');

    trackEvent('word_saved');
    await Promise.resolve();

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.isSupported).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
