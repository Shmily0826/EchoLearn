// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function ThrowingChild(): never {
  throw new Error('boom');
}

const SEED_KEYS: Record<string, string> = {
  echolearn_vocabulary: JSON.stringify([{ id: 'w1', word: 'final' }]),
  echolearn_sentences: JSON.stringify([{ id: 's1' }]),
  echolearn_session: JSON.stringify({ id: 'session_x' }),
  echolearn_lang: 'en',
  unrelated_key: 'keep me',
};

describe('ErrorBoundary destructive-action contract', () => {
  const originalLocation = window.location;
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    Object.entries(SEED_KEYS).forEach(([k, v]) => localStorage.setItem(k, v));
    reloadMock = vi.fn();
    // jsdom forbids redefining location.reload; swap the whole location object
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    // silence the expected console.error from the boundary + React logging
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('does not clear data on first click; opens confirmation instead (EB1)', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-clear-reload'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(localStorage.getItem('echolearn_vocabulary')).toBe(SEED_KEYS.echolearn_vocabulary);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('Cancel preserves all local learning data and does not reload (EB2, EB3)', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-clear-reload'));
    fireEvent.click(screen.getByRole('button', { name: 'error.clearConfirmCancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(localStorage.getItem('echolearn_vocabulary')).toBe(SEED_KEYS.echolearn_vocabulary);
    expect(localStorage.getItem('echolearn_sentences')).toBe(SEED_KEYS.echolearn_sentences);
    expect(localStorage.getItem('echolearn_session')).toBe(SEED_KEYS.echolearn_session);
    expect(localStorage.getItem('echolearn_lang')).toBe('en');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('explicit confirmation clears only echolearn_ keys and reloads (EB4, EB10)', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-clear-reload'));
    fireEvent.click(screen.getByTestId('error-confirm-clear'));
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
    expect(localStorage.getItem('echolearn_sentences')).toBeNull();
    expect(localStorage.getItem('echolearn_session')).toBeNull();
    expect(localStorage.getItem('echolearn_lang')).toBeNull();
    expect(localStorage.getItem('unrelated_key')).toBe('keep me');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('repeated confirm clicks cannot duplicate the destructive execution (EB8)', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-clear-reload'));
    const confirm = screen.getByTestId('error-confirm-clear');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('Reload Page never clears learning data (EB5)', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'error.reload' }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('echolearn_vocabulary')).toBe(SEED_KEYS.echolearn_vocabulary);
  });

  it('guest data survives Cancel after a broken-route render (V2)', () => {
    localStorage.setItem('echolearn_guest_mode', '1');
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-clear-reload'));
    fireEvent.click(screen.getByRole('button', { name: 'error.clearConfirmCancel' }));
    expect(localStorage.getItem('echolearn_guest_mode')).toBe('1');
    expect(localStorage.getItem('echolearn_vocabulary')).toBe(SEED_KEYS.echolearn_vocabulary);
  });
});
