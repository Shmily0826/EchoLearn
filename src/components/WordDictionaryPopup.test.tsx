// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

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
    vi.mocked(translateWordFast).mockResolvedValue('dictionary fallback');
    vi.mocked(getWordAnalysis).mockResolvedValue({
      pos: 'noun',
      meaningZh: 'contextual meaning',
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

    expect(await screen.findByText('查看其他词性与详细释义')).toBeTruthy();
    const primaryMeaning = screen.getByText('contextual meaning');
    expect(primaryMeaning.className).toContain('text-gray-800');
    expect(primaryMeaning.className).not.toContain('text-indigo-600');
    const primaryPos = screen.getByText('n', { exact: true });
    expect(primaryPos.compareDocumentPosition(primaryMeaning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('dictionary fallback')).toBeNull();
    expect(screen.queryByText('词典例句')).toBeNull();
    expect(screen.getByText('AI 例句')).toBeTruthy();
    expect(screen.queryByText('Here, light describes the amount of luggage.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看其他词性与详细释义' }));
    expect(screen.getByRole('heading', { name: 'adj' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'n' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'adjective' })).toBeNull();
    expect(screen.getByText('词典例句')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看语境分析' }));
    expect(screen.getByText('Here, light describes the amount of luggage.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save word' });
    const attribution = screen.getByText(/Powered by Merriam-Webster/);
    expect(save.compareDocumentPosition(attribution) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('labels English fallback definitions in Chinese mode', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'not heavy',
      definitionTranslationStatus: 'fallback-en',
      definitionsEn: [{ pos: 'adjective', definition: 'not heavy', translationStatus: 'fallback-en' }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Free Dictionary',
    });
    vi.mocked(translateWordFast).mockResolvedValue('translated meaning');

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '查看详细释义' })).toBeTruthy();
    expect(await screen.findByText('translated meaning')).toBeTruthy();
    expect(screen.getByText('adj', { exact: true })).toBeTruthy();
    expect(screen.queryByText('（英文原文，翻译失败）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看详细释义' }));
    expect(screen.getByText('（英文原文，翻译失败）')).toBeTruthy();
  });

  it('shows three default senses and expands the remaining meanings', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'sense one',
      definitionsEn: [
        { pos: 'adjective', definition: 'sense one' },
        { pos: 'noun', definition: 'sense two' },
        { pos: 'verb', definition: 'sense three' },
        { pos: 'verb', definition: 'sense four' },
      ],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '查看其他词性与详细释义' })).toBeTruthy();
    expect(screen.queryByText('sense three')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看其他词性与详细释义' }));
    expect(screen.getByText('sense three')).toBeTruthy();
    expect(screen.queryByText('sense four')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示另外 1 个释义' }));
    expect(screen.getByText('sense four')).toBeTruthy();
  });

  it('clamps the popup inside the viewport when neither side fits', async () => {
    localStorage.setItem('echolearn_lang', 'en');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    getBoundingClientRect.mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('fixed')) {
        return { height: 400, width: 300, top: 0, bottom: 400, left: 0, right: 300 } as DOMRect;
      }
      return { height: 0, width: 0, top: 0, bottom: 0, left: 0, right: 0 } as DOMRect;
    });
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'compact',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'small',
      definitionsEn: [{ pos: 'adjective', definition: 'small' }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Datamuse',
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="compact" x={100} y={250} onClose={vi.fn()} />
      </I18nProvider>,
    );

    const popup = (await screen.findByText('small')).closest('div.fixed') as HTMLElement;
    await waitFor(() => expect(popup.style.top).toBe('84px'));
  });

  it('skips Chinese translation and AI enrichment in English mode', async () => {
    localStorage.setItem('echolearn_lang', 'en');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'adjective',
      definitionEn: 'not heavy',
      definitionTranslationStatus: 'fallback-en',
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
    expect(screen.queryByText('（英文原文，翻译失败）')).toBeNull();
    expect(translateWordFast).not.toHaveBeenCalled();
    expect(getWordAnalysis).not.toHaveBeenCalled();
  });
});
