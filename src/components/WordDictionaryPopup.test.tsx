// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WordDictionaryPopup from './WordDictionaryPopup';
import { I18nProvider } from '../i18n/I18nContext';
import { lookupWord } from '../services/dictionaryService';
import { translateWordFast } from '../services/translationService';
import { getWordAnalysis } from '../services/wordAnalysisService';

vi.mock('../services/dictionaryService', () => ({
  lookupWord: vi.fn(),
  isKnownProperNoun: vi.fn(() => false),
}));
vi.mock('../services/translationService', () => ({ translateWordFast: vi.fn() }));
vi.mock('../services/wordAnalysisService', () => ({ getWordAnalysis: vi.fn() }));

describe('WordDictionaryPopup dictionary failures', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(lookupWord).mockRejectedValue(new Error('request failed'));
    vi.mocked(translateWordFast).mockResolvedValue('');
    vi.mocked(getWordAnalysis).mockResolvedValue(null);
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

  it('groups definitions by compact English POS and keeps example provenance clear', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'not heavy',
      definitionsEn: [
        { pos: 'adjective', definition: 'not heavy' },
        { pos: 'adjective', definition: 'pale in colour' },
        { pos: 'noun', definition: 'the natural agent that makes things visible' },
      ],
      example: 'The bag is light.',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
    });
    vi.mocked(translateWordFast).mockResolvedValue('轻的；轻便的');
    vi.mocked(getWordAnalysis).mockResolvedValue({
      meaningZh: '轻便的',
      exampleEn: 'She packed light for the trip.',
      exampleZh: '她轻装出行。',
      analysis: 'Here, light describes the amount of luggage.',
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup
          word="light"
          x={100}
          y={100}
          onClose={vi.fn()}
          actions={<button>Save word</button>}
        />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'adj' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'n' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'adjective' })).toBeNull();
    expect(screen.getByText('词典例句')).toBeTruthy();
    expect(screen.getByText('AI 例句')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save word' });
    const attribution = screen.getByText(/Powered by Merriam-Webster/);
    expect(save.compareDocumentPosition(attribution) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('skips Chinese translation and AI enrichment in English mode', async () => {
    localStorage.setItem('echolearn_lang', 'en');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'not heavy',
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Datamuse',
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByText('not heavy')).toBeTruthy();
    expect(translateWordFast).not.toHaveBeenCalled();
    expect(getWordAnalysis).not.toHaveBeenCalled();
  });
});
