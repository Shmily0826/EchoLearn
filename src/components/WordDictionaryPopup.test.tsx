// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WordDictionaryPopup, { type WordDictionaryPopupData } from './WordDictionaryPopup';
import { I18nProvider } from '../i18n/I18nContext';
import type { DictionaryReferenceTranslationStatus } from '../types';
import { lookupWord } from '../services/dictionaryService';
import * as learnerMeaningService from '../services/learnerMeaning';
import { translateWordFast } from '../services/translationService';
import { getWordAnalysis } from '../services/wordAnalysisService';

const authState = { user: { uid: 'test-user' } as { uid: string } | null };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));
vi.mock('../services/dictionaryService', () => ({
  lookupWord: vi.fn(),
  isKnownProperNoun: vi.fn(() => false),
}));
vi.mock('../services/translationService', () => ({ translateWordFast: vi.fn() }));
vi.mock('../services/wordAnalysisService', () => ({ getWordAnalysis: vi.fn() }));

function referenceFor(
  word: string,
  senses: Array<{ pos: string; displayText: string; translationStatus?: DictionaryReferenceTranslationStatus }>,
  status: DictionaryReferenceTranslationStatus = 'translated',
  requestedLanguage = 'zh-CN',
) {
  return {
    queriedForm: word,
    provider: 'test',
    sourceLanguage: 'en',
    requestedLanguage,
    displayLanguage: status === 'translated' ? requestedLanguage : 'en',
    translationStatus: status,
    senses: senses.map((sense) => ({
      pos: sense.pos,
      sourceText: sense.displayText,
      displayText: sense.displayText,
      translationStatus: sense.translationStatus ?? status,
    })),
  };
}

describe('WordDictionaryPopup dictionary failures', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.user = { uid: 'test-user' };
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

  it('settles when a parent stores onDataChange during unavailable lookups', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const ParentWithDataSink = () => {
      const [, setData] = useState<WordDictionaryPopupData | null>(null);
      return (
        <WordDictionaryPopup
          word="loosely"
          x={100}
          y={100}
          onClose={vi.fn()}
          onDataChange={setData}
        />
      );
    };

    render(
      <I18nProvider>
        <ParentWithDataSink />
      </I18nProvider>,
    );

    expect(await screen.findByText('词典服务暂时不可用，请稍后重试。')).toBeTruthy();
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
      reference: referenceFor('light', [
        { pos: 'adjective', displayText: '轻的' },
        { pos: 'adjective', displayText: '浅色的' },
        { pos: 'noun', displayText: '光' },
      ]),
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

    expect(await screen.findByRole('button', { name: '查看词典参考释义' })).toBeTruthy();
    const primaryMeaning = screen.getByText('contextual meaning');
    expect(primaryMeaning.className).toContain('text-gray-800');
    expect(primaryMeaning.className).not.toContain('text-indigo-600');
    const primaryPos = screen.getByText('n', { exact: true });
    expect(primaryPos.compareDocumentPosition(primaryMeaning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('dictionary fallback')).toBeNull();
    expect(screen.queryByText('词典例句')).toBeNull();
    expect(screen.getByText('AI 例句')).toBeTruthy();
    expect(screen.queryByText('Here, light describes the amount of luggage.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看词典参考释义' }));
    expect(screen.getByText('轻的')).toBeTruthy();
    expect(screen.getByText('浅色的')).toBeTruthy();
    expect(screen.getByText('光')).toBeTruthy();
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

  it.each([
    ['audience', '\u89c2\u4f17', '\u4e00\u7fa4\u4eba\u805a\u96c6\u5728\u4e00\u8d77\u542c\u67d0\u4e8b\uff08\u4f8b\u5982\u97f3\u4e50\u4f1a\uff09\u6216\u89c2\u770b\u67d0\u4e8b\uff08\u4f8b\u5982\u7535\u5f71\u6216\u620f\u5267\uff09\uff1a\u53c2\u52a0\u8868\u6f14\u7684\u4eba'],
    ['education', '\u6559\u80b2', '\u6559\u5b66\u67d0\u4eba\u7684\u884c\u52a8\u6216\u8fc7\u7a0b\uff0c\u5c24\u5176\u5728\u5b66\u6821\u3001\u5b66\u9662\u6216\u5927\u5b66\u4e2d'],
    ['education', '\u6559\u80b2', '\u60a8\u4ece\u5b66\u6821\u3001\u5b66\u9662\u6216\u5927\u5b66\u83b7\u5f97\u7684\u77e5\u8bc6\u3001\u6280\u80fd\u548c\u7406\u89e3'],
  ])('keeps long %s provider prose behind full dictionary disclosure', async (word, meaning, longDefinition) => {
    localStorage.setItem('echolearn_lang', 'zh');
    vi.mocked(lookupWord).mockResolvedValue({
      word,
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: longDefinition,
      definitionsEn: [{ pos: 'noun', definition: longDefinition }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
      reference: referenceFor(word, [{ pos: 'noun', displayText: longDefinition }], 'fallback-en'),
    });
    vi.mocked(getWordAnalysis).mockResolvedValue({
      pos: 'noun',
      meaningZh: meaning,
      exampleEn: `A sentence using ${word}.`,
      exampleZh: '...',
      analysis: '...',
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word={word} x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    await screen.findByText(meaning);
    expect(screen.queryByRole('button', { name: /\u67e5\u770b(?:\u8be6\u7ec6\u91ca\u4e49|\u5b8c\u6574\u8bcd\u5178\u91ca\u4e49)/u })).toBeNull();
    expect(screen.getAllByText(meaning).length).toBeGreaterThan(0);
    expect(screen.queryByText(longDefinition)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '\u67e5\u770b\u8bcd\u5178\u53c2\u8003\u91ca\u4e49' }));
    expect(screen.getByText(longDefinition)).toBeTruthy();
    expect(getWordAnalysis).toHaveBeenCalledTimes(1);
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
      reference: referenceFor('light', [{ pos: 'adjective', displayText: 'not heavy', translationStatus: 'fallback-en' }], 'fallback-en'),
    });
    vi.mocked(translateWordFast).mockResolvedValue('translated meaning');

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '查看词典参考释义' })).toBeTruthy();
    expect(await screen.findByText('translated meaning')).toBeTruthy();
    expect(screen.getByText('adj', { exact: true })).toBeTruthy();
    expect(screen.queryByText('（英文原文，翻译失败）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看词典参考释义' }));
    expect(screen.getByText('（英文原文，翻译失败）')).toBeTruthy();
  });

  it('does not promote an English fallback reference into Chinese learner meaning', async () => {
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
      reference: referenceFor('light', [{ pos: 'adjective', displayText: 'not heavy', translationStatus: 'fallback-en' }], 'fallback-en'),
    });
    vi.mocked(translateWordFast).mockResolvedValue('');

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '查看词典参考释义' })).toBeTruthy();
    expect(screen.queryByText('not heavy')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看词典参考释义' }));
    expect(screen.getByText('not heavy')).toBeTruthy();
  });

  it('keeps long translated prose out of the top meaning and preserves Chinese reference text', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const translatedProse = '一段很长的机器翻译定义句子，不适合作为顶部学习释义。';
    const sourceProse = 'a long provider definition sentence';
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'cat',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: 'a small animal',
      definitionsEn: [{ pos: 'noun', definition: '猫' }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Free Dictionary',
      reference: {
        ...referenceFor('cat', [{ pos: 'noun', displayText: translatedProse }]),
        senses: [{
          pos: 'noun',
          sourceText: sourceProse,
          displayText: translatedProse,
          translationStatus: 'translated',
        }],
      },
    });
    vi.mocked(translateWordFast).mockResolvedValue('');

    render(
      <I18nProvider>
        <WordDictionaryPopup word="cat" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    const referenceButton = await screen.findByRole('button', { name: '查看词典参考释义' });
    expect(referenceButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(translatedProse)).toBeNull();
    expect(screen.queryByText(sourceProse)).toBeNull();
    fireEvent.click(referenceButton);
    expect(referenceButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(translatedProse)).toBeTruthy();
    expect(screen.queryByText(sourceProse)).toBeNull();
  });

  it('keeps a fully translated reference in Chinese even when one sense is long', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const translatedLongSense = '\u4e00\u4e2a\u5173\u4e8e\u4f1a\u8bae\u7684\u5f88\u957f\u7684\u7ffb\u8bd1\u91ca\u4e49\u6587\u672c\uff0c\u4e0d\u5e94\u88ab\u66ff\u6362\u4e3a\u82f1\u6587\u3002';
    const sourceLongSense = 'an organized meeting for discussion';
    vi.mocked(translateWordFast).mockResolvedValue('\u4f1a\u8bae');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'conference',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: sourceLongSense,
      definitionsEn: [
        { pos: 'noun', definition: sourceLongSense },
        { pos: 'noun', definition: 'a meeting' },
      ],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
      reference: {
        queriedForm: 'conference',
        provider: 'Merriam-Webster',
        sourceLanguage: 'en',
        requestedLanguage: 'zh-CN',
        displayLanguage: 'zh-CN',
        translationStatus: 'translated',
        senses: [
          { pos: 'noun', sourceText: sourceLongSense, displayText: translatedLongSense, translationStatus: 'translated' },
          { pos: 'noun', sourceText: 'a meeting', displayText: '\u4f1a\u8bae', translationStatus: 'translated' },
        ],
      },
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="conference" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByText('\u4f1a\u8bae')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '\u67e5\u770b\u8bcd\u5178\u53c2\u8003\u91ca\u4e49' }));
    expect(screen.getByText(translatedLongSense)).toBeTruthy();
    expect(screen.getAllByText('\u4f1a\u8bae').length).toBeGreaterThan(1);
    expect(screen.queryByText(sourceLongSense)).toBeNull();
  });

  it('omits a missing-source mixed sense without changing the top learner meaning', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const sourceSense = 'an organized meeting for discussion';
    const missingSourceChinese = '\u4e0d\u5e94\u663e\u793a\u7684\u4e2d\u6587\u91ca\u4e49';
    const onDataChange = vi.fn();
    vi.mocked(translateWordFast).mockResolvedValue('\u4f1a\u8bae');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'conference',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: sourceSense,
      definitionsEn: [{ pos: 'noun', definition: sourceSense }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
      reference: {
        queriedForm: 'conference',
        provider: 'Merriam-Webster',
        sourceLanguage: 'en',
        requestedLanguage: 'zh-CN',
        displayLanguage: 'mixed',
        translationStatus: 'translated',
        senses: [
          { pos: 'noun', sourceText: sourceSense, displayText: sourceSense, translationStatus: 'fallback-en' },
          { pos: 'noun', sourceText: null, displayText: missingSourceChinese, translationStatus: 'translated' },
        ],
      },
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup
          word="conference"
          x={100}
          y={100}
          onClose={vi.fn()}
          onDataChange={onDataChange}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(onDataChange.mock.calls.at(-1)?.[0]?.meaningCn).toBe('\u4f1a\u8bae'));
    fireEvent.click(screen.getByRole('button', { name: '\u67e5\u770b\u8bcd\u5178\u53c2\u8003\u91ca\u4e49' }));
    expect(screen.getByText(sourceSense)).toBeTruthy();
    expect(screen.queryByText(missingSourceChinese)).toBeNull();
    expect(screen.getAllByText('\u4f1a\u8bae')).toHaveLength(1);
  });

  it('passes the clicked subtitle to the shared LearnerMeaning resolver', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'cat',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: 'a small animal',
      definitionsEn: [{ pos: 'noun', definition: '猫' }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Free Dictionary',
      reference: referenceFor('cat', [{ pos: 'noun', displayText: '猫' }]),
    });
    const resolveSpy = vi.spyOn(learnerMeaningService, 'resolveLearnerMeaning');

    render(
      <I18nProvider>
        <WordDictionaryPopup
          word="cat"
          x={100}
          y={100}
          context="The cat slept on the mat."
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    await screen.findByText('猫');
    expect(resolveSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      sourceSentence: 'The cat slept on the mat.',
    });
  });

  it('shows all bounded provider senses behind one Chinese dictionary disclosure', async () => {
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
      reference: referenceFor('light', [
        { pos: 'adjective', displayText: 'sense one' },
        { pos: 'noun', displayText: 'sense two' },
        { pos: 'verb', displayText: 'sense three' },
        { pos: 'verb', displayText: 'sense four' },
      ]),
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: '查看词典参考释义' })).toBeTruthy();
    expect(screen.queryByText('sense three')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看词典参考释义' }));
    expect(screen.getByText('sense three')).toBeTruthy();
    expect(screen.getByText('sense four')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /显示另外|查看详细释义|查看完整词典释义/u })).toBeNull();
  });

  it('renders a long reference definition without Popup rewriting it', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const definition = 'The name of various cities, towns and boroughs in the USA, United Kingdom, Canada, Australia and New Zealand. See the full list.';
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'stratford',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: '',
      definitionsEn: [{
        pos: 'noun',
        definition: '\u7f8e\u56fd\u3001\u82f1\u56fd\u3001\u52a0\u62ff\u5927\u3001\u6fb3\u5927\u5229\u4e9a\u548c\u65b0\u897f\u5170\u5404\u4e2a\u57ce\u5e02\u3001\u57ce\u9547\u548c\u884c\u653f\u533a\u7684\u540d\u79f0\u3002\u67e5\u770b\u5b8c\u6574\u5217\u8868\u3002',
      }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Datamuse',
      reference: referenceFor('stratford', [{ pos: 'noun', displayText: definition }], 'fallback-en'),
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="stratford" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '\u67e5\u770b\u8bcd\u5178\u53c2\u8003\u91ca\u4e49' }));
    expect(screen.getByText(definition)).toBeTruthy();
  });

  it('renders the reference usage tail without rewriting the sense', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    const definition = 'A date that is remembered or celebrated because a special or notable event occurred on that date in a previous year - usually used before another noun';
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'anniversary',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: '',
      definitionsEn: [{
        pos: 'noun',
        definition: '\u7531\u4e8e\u524d\u4e00\u5e74\u7684\u8be5\u65e5\u671f\u53d1\u751f\u4e86\u7279\u6b8a\u6216\u503c\u5f97\u6ce8\u610f\u7684\u4e8b\u4ef6\u800c\u88ab\u8bb0\u4f4f\u6216\u5e86\u795d\u7684\u65e5\u671f - \u901a\u5e38\u5728\u53e6\u4e00\u4e2a\u540d\u8bcd\u4e4b\u524d\u4f7f\u7528',
      }],
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Merriam-Webster',
      reference: referenceFor('anniversary', [{ pos: 'noun', displayText: definition }], 'fallback-en'),
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="anniversary" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '\u67e5\u770b\u8bcd\u5178\u53c2\u8003\u91ca\u4e49' }));
    expect(screen.getByText(definition)).toBeTruthy();
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
      reference: referenceFor('compact', [{ pos: 'adjective', displayText: 'small' }], 'source', 'en'),
    });

    render(
      <I18nProvider>
        <WordDictionaryPopup word="compact" x={100} y={250} onClose={vi.fn()} />
      </I18nProvider>,
    );

    const popup = (await screen.findByText('small')).closest('div.fixed') as HTMLElement;
    await waitFor(() => expect(popup.style.top).toBe('84px'));
  });

  it('skips AI enrichment for guests in Chinese mode without touching the display language', async () => {
    localStorage.setItem('echolearn_lang', 'zh');
    authState.user = null;
    vi.mocked(lookupWord).mockResolvedValue({
      word: 'light', phonetic: '', audioUrl: '', partOfSpeech: 'noun',
      definitionEn: '光', example: '', synonyms: [], antonyms: [],
      provider: 'Merriam-Webster',
      reference: referenceFor('light', [{ pos: 'noun', displayText: '光' }]),
    });
    vi.mocked(translateWordFast).mockResolvedValue('光');

    render(
      <I18nProvider>
        <WordDictionaryPopup word="light" x={100} y={100} onClose={vi.fn()} />
      </I18nProvider>,
    );

    // Dictionary + quick gloss (non-AI) still resolve for the guest.
    await screen.findByText('光');
    expect(getWordAnalysis).not.toHaveBeenCalled();
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
      reference: referenceFor('light', [{ pos: 'adjective', displayText: 'not heavy' }], 'source', 'en'),
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
