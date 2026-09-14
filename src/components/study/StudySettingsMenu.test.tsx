// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudySettingsMenu from './StudySettingsMenu';
import { I18nProvider } from '../../i18n/I18nContext';
import type { CEFRLevel } from '../../services/cefrWordList';

/**
 * Focused coverage for the collapsed Study controls.
 *
 * The milestone moved the sleep timer, the CEFR level range and the transcript
 * recovery action behind this menu. These tests pin the two things that must
 * not regress: every control keeps working, and collapsing them does not break
 * keyboard/AT access.
 */

interface State {
  sleepMinutes: number;
  cefrMin: CEFRLevel;
  cefrMax: CEFRLevel;
}

function Harness({
  initial = { sleepMinutes: 0, cefrMin: 'B1', cefrMax: 'C2' },
  onReloadTranscript = vi.fn(),
  reloadDisabled = false,
}: {
  initial?: State;
  onReloadTranscript?: () => void;
  reloadDisabled?: boolean;
}) {
  const [state, setState] = useState<State>(initial);
  return (
    <I18nProvider>
      <StudySettingsMenu
        sleepMinutes={state.sleepMinutes}
        onSleepMinutesChange={(minutes) => setState((s) => ({ ...s, sleepMinutes: minutes }))}
        cefrMin={state.cefrMin}
        onCefrMinChange={(level) => setState((s) => ({ ...s, cefrMin: level }))}
        cefrMax={state.cefrMax}
        onCefrMaxChange={(level) => setState((s) => ({ ...s, cefrMax: level }))}
        onReloadTranscript={onReloadTranscript}
        reloadDisabled={reloadDisabled}
      />
      <span data-testid="state">{JSON.stringify(state)}</span>
    </I18nProvider>
  );
}

const openMenu = () => fireEvent.click(screen.getByTestId('study-settings-toggle'));

beforeEach(() => {
  localStorage.setItem('echolearn_lang', 'en');
});

afterEach(() => {
  cleanup();
});

describe('StudySettingsMenu — collapsed secondary controls', () => {
  it('keeps the trigger labelled and collapsed until opened', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('study-settings-toggle');
    expect(trigger.textContent).toContain('Study settings');
    expect(trigger.getAttribute('title')).toBe('Study settings');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByTestId('study-settings-panel')).toBeNull();
  });

  it('exposes timer, level and recovery controls with accessible names once open', () => {
    render(<Harness />);
    openMenu();
    expect(screen.getByTestId('study-settings-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Study settings' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '15 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30 min' })).toBeTruthy();
    expect(screen.getByLabelText('Custom minutes (1-180)')).toBeTruthy();
    expect(screen.getByLabelText('Minimum CEFR level')).toBeTruthy();
    expect(screen.getByLabelText('Maximum CEFR level')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload transcript' })).toBeTruthy();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    openMenu();
    const trigger = screen.getByTestId('study-settings-toggle');
    const panel = screen.getByTestId('study-settings-panel');
    expect(panel.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('study-settings-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside press', () => {
    render(<Harness />);
    openMenu();
    expect(screen.getByTestId('study-settings-panel')).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId('study-settings-panel')).toBeNull();
  });

  it('still sets the sleep timer from a preset', () => {
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    expect(screen.getByRole('button', { name: '30 min' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('state').textContent).toContain('"sleepMinutes":30');
  });

  it('still sets a custom timer duration', () => {
    render(<Harness />);
    openMenu();
    const input = screen.getByLabelText('Custom minutes (1-180)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '90' } });
    expect(screen.getByTestId('state').textContent).toContain('"sleepMinutes":90');
  });

  it('clamps the CEFR range when the minimum passes the maximum', () => {
    render(<Harness initial={{ sleepMinutes: 0, cefrMin: 'B1', cefrMax: 'B2' }} />);
    openMenu();
    fireEvent.change(screen.getByLabelText('Minimum CEFR level'), { target: { value: 'C1' } });
    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.cefrMin).toBe('C1');
    expect(state.cefrMax).toBe('C1');
  });

  it('still triggers the transcript recovery action and closes after it', () => {
    const onReloadTranscript = vi.fn();
    render(<Harness onReloadTranscript={onReloadTranscript} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Reload transcript' }));
    expect(onReloadTranscript).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('study-settings-panel')).toBeNull();
  });

  it('disables the recovery action while a transcript fetch is in flight', () => {
    render(<Harness reloadDisabled />);
    openMenu();
    expect((screen.getByRole('button', { name: 'Reload transcript' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
