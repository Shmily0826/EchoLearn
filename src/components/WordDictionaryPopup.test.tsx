// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WordDictionaryPopup from './WordDictionaryPopup';
import { I18nProvider } from '../i18n/I18nContext';
import { lookupWord } from '../services/dictionaryService';

vi.mock('../services/dictionaryService', () => ({
  lookupWord: vi.fn(),
  isKnownProperNoun: vi.fn(() => false),
}));
vi.mock('../services/translationService', () => ({ translateWordFast: vi.fn() }));
vi.mock('../services/wordAnalysisService', () => ({ getWordAnalysis: vi.fn() }));

describe('WordDictionaryPopup dictionary failures', () => {
  beforeEach(() => {
    vi.mocked(lookupWord).mockRejectedValue(new Error('request failed'));
  });

  afterEach(() => cleanup());

  it('shows visible service feedback when lookup rejects', async () => {
    render(
      <I18nProvider>
        <WordDictionaryPopup word="cat" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByText('Dictionary service unavailable. Please try again.')).toBeTruthy();
    expect(screen.queryByText('Dictionary entry not found.')).toBeNull();
  });
});
