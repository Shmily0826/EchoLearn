// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function ThrowingChild(): never {
  throw new TypeError('U(...).toLowerCase is not a function');
}

/**
 * The boundary used to show a message and 300 characters of minified stack,
 * which is not enough to place a report: the `constructor` crash sat in
 * Production for three months and arrived as a screenshot. These cases pin what
 * a learner can hand over in one click — and what must never be in it.
 */
describe('ErrorBoundary diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'w1', word: 'secretword' }]));
    localStorage.setItem('echolearn_session', JSON.stringify({ youtubeId: 'PRIVATE_SESSION' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderCrash() {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    return screen.getByTestId('error-diagnostics').textContent || '';
  }

  it('names the build, the route and the throw, and says which component rendered it', () => {
    const text = renderCrash();
    expect(text).toMatch(/EchoLearn build \S+/);
    expect(text).toContain('route=');
    expect(text).toContain('TypeError: U(...).toLowerCase is not a function');
    expect(text).toContain('Rendered by:');
    expect(text).toContain('ThrowingChild');
  });

  it('carries no stored learning data, however convenient that would be', () => {
    const text = renderCrash();
    expect(text).not.toContain('secretword');
    expect(text).not.toContain('PRIVATE_SESSION');
    expect(text).not.toContain('echolearn_vocabulary');
  });

  it('copies the diagnostics and confirms it', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-copy-diagnostics'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('TypeError: U(...).toLowerCase is not a function');
    expect(copied).not.toContain('secretword');
    await vi.waitFor(() => {
      expect(screen.getByTestId('error-copy-diagnostics').textContent)
        .toBe('error.diagnosticsCopied');
    });
  });

  it('stays usable when the clipboard is unavailable, without claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });

    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    fireEvent.click(screen.getByTestId('error-copy-diagnostics'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('error-copy-diagnostics').textContent).toBe('error.copyDiagnostics');
    });
    // The text is still on screen and selectable, which is the fallback path.
    expect(screen.getByTestId('error-diagnostics').textContent).toContain('EchoLearn build');
  });

  it('does not offer the destructive control as the way out of a report', () => {
    render(<ErrorBoundary><ThrowingChild /></ErrorBoundary>);
    expect(screen.getByTestId('error-clear-reload')).toBeTruthy();
    expect(screen.getByTestId('error-copy-diagnostics')).toBeTruthy();
  });
});
