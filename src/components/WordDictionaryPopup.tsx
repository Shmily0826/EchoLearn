import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { DictionaryEntry, DictionaryReferenceSense, LearnerMeaning } from '../types';
import { lookupWord, isKnownProperNoun } from '../services/dictionaryService';
import { resolveLearnerMeaning } from '../services/learnerMeaning';
import { translateWordFast, type TranslateLang } from '../services/translationService';
import { getWordAnalysis, type WordAnalysis } from '../services/wordAnalysisService';
import { useI18n } from '../i18n/I18nContext';

/** Speak a word using the browser's built-in TTS (free, no network/API key). */
function speakWord(word: string): void {
  try {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* speech synthesis unavailable */
  }
}

export interface WordDictionaryPopupData {
  word: string;
  entry: (DictionaryEntry & { lemma?: string }) | null;
  meaningCn: string;
  learnerMeaning?: LearnerMeaning;
}

interface WordDictionaryPopupProps {
  /** The word to look up */
  word: string;
  /** Position for the popup (viewport coordinates) */
  x: number;
  y: number;
  /** Called when the user clicks outside — parent should set active popup to null */
  onClose: () => void;
  /** Optional: additional content below dictionary data (e.g. "Add to vocabulary" button) */
  actions?: React.ReactNode;
  /** Optional: called whenever the internally-displayed word changes (e.g. recursive lookup). */
  onWordChange?: (word: string) => void;
  /** Optional: exposes current lookup data to parent actions such as saving vocabulary. */
  onDataChange?: (data: WordDictionaryPopupData) => void;
  /** Optional: source video id, used to cache AI enrichment per (word, video). */
  videoId?: string;
  /** Optional: the sentence the word appeared in, used for contextual AI analysis. */
  context?: string;
}

const POS_ABBREVIATIONS: Record<string, string> = {
  adjective: 'adj',
  adverb: 'adv',
  article: 'art',
  auxiliary: 'aux',
  conjunction: 'conj',
  determiner: 'det',
  interjection: 'interj',
  noun: 'n',
  'participle adjective': 'part adj',
  preposition: 'prep',
  pronoun: 'pron',
  'proper noun': 'prop n',
  'phrasal verb': 'phr v',
  verb: 'v',
};

function compactPartOfSpeech(pos: string): string {
  const normalized = pos.trim().toLowerCase().replace(/\.$/, '');
  return POS_ABBREVIATIONS[normalized] ?? pos.trim();
}

function groupDefinitions(definitions: DictionaryReferenceSense[]) {
  const groups = new Map<string, typeof definitions>();
  for (const item of definitions) {
    const pos = compactPartOfSpeech(item.pos);
    const current = groups.get(pos) ?? [];
    current.push(item);
    groups.set(pos, current);
  }
  return [...groups.entries()].map(([pos, items]) => ({ pos, items }));
}

function getPopupTop(y: number, popupHeight: number, viewportHeight: number, margin = 16): number {
  const spaceBelow = viewportHeight - y - margin;
  const spaceAbove = y - margin;
  const preferBelow = popupHeight <= spaceBelow || (popupHeight > spaceAbove && spaceBelow >= spaceAbove);
  const desiredTop = preferBelow ? y + 24 : y - popupHeight;
  const maxTop = Math.max(margin, viewportHeight - margin - popupHeight);
  return Math.min(Math.max(desiredTop, margin), maxTop);
}

/**
 * A reusable popup that shows dictionary information for a word.
 * Used by TranscriptViewer, VocabularyPage, and SentencesPage.
 * Supports recursive lookup: tap any word in the definition to look it up.
 */
const WordDictionaryPopup: React.FC<WordDictionaryPopupProps> = ({
  word: initialWord,
  x,
  y,
  onClose,
  actions,
  onWordChange,
  onDataChange,
  videoId,
  context,
}) => {
  const [currentWord, setCurrentWord] = useState(initialWord);
  const [wordHistory, setWordHistory] = useState<string[]>([]);
  const [entry, setEntry] = useState<(DictionaryEntry & { lemma?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'not-found' | 'request' | null>(null);
  const [definitionCn, setDefinitionCn] = useState('');
  // AI enrichment (bilingual example + contextual analysis), zh mode only.
  const [aiAnalysis, setAiAnalysis] = useState<WordAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // Long words (e.g. "brief") can return 10+ senses; show a compact subset by
  // default and let the user expand, so the popup usually fits without scrolling.
  const [expandDefs, setExpandDefs] = useState(false);
  // Chinese AI contextual analysis can be very verbose; collapse it by default.
  const [expandAiAnalysis, setExpandAiAnalysis] = useState(false);
  // Chinese dictionary details stay behind one disclosure; English keeps its existing list expansion.
  const [expandDictionaryDefinitions, setExpandDictionaryDefinitions] = useState(false);
  // Dynamic vertical placement: prefer below, flip above when it fits, and
  // clamp the card when neither side has enough room.
  const [popupTop, setPopupTop] = useState<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { lang, t } = useI18n();
  // In English page mode we deliberately hide the Chinese line and skip the
  // DeepSeek call entirely (pure-English study view, saves token quota).
  const showChinese = lang === 'zh';
  const definitionLimit = showChinese ? 3 : 5;
  const referenceSenses = entry?.reference?.senses.filter((sense) => sense.displayText) ?? [];
  const learnerMeaning = resolveLearnerMeaning({
    targetLanguage: showChinese ? 'zh-CN' : 'en',
    sourceSentence: context || '',
    contextAi: aiAnalysis?.meaningZh,
    quickGloss: definitionCn,
    dictionaryReference: entry?.reference,
  });
  const primaryMeaning = learnerMeaning.text;
  const visibleDefinitions = showChinese
    ? (expandDictionaryDefinitions ? referenceSenses : [])
    : (expandDefs ? referenceSenses : referenceSenses.slice(0, definitionLimit));
  const definitionGroups = groupDefinitions(visibleDefinitions);
  const primaryPos = compactPartOfSpeech(
    aiAnalysis?.pos || entry?.reference?.senses[0]?.pos || '',
  );
  const hasDictionaryDetails = showChinese && referenceSenses.length > 0;

  // Reset when initial word changes
  useEffect(() => {
    // A parent-selected word replaces the entire lookup history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentWord(initialWord);
    setWordHistory([]);
  }, [initialWord]);

  // Notify parent when the displayed word changes (e.g. user clicks a synonym).
  useEffect(() => {
    onWordChange?.(currentWord);
  }, [currentWord, onWordChange]);

  useEffect(() => {
    onDataChange?.({
      word: currentWord,
      entry,
      meaningCn: learnerMeaning.text,
      learnerMeaning,
    });
  }, [currentWord, entry, definitionCn, aiAnalysis, learnerMeaning, learnerMeaning.text, onDataChange]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  // Fetch dictionary data (+ Chinese translation only when the page language is Chinese)
  useEffect(() => {
    let cancelled = false;
    // The lookup key changed; show loading rather than stale data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setEntry(null);
    setDefinitionCn('');
    setExpandDefs(false);
    setExpandDictionaryDefinitions(false);

    // The one-line Chinese gloss is fetched in parallel with the dictionary
    // lookup. It uses the keyless Google gtx proxy ONLY (noDeepSeekFallback) so
    // a slow/empty Google response can never stall the popup the way the old
    // DeepSeek fallback (~3s) used to. The main definitions arrive from
    // /api/dictionary in ~170ms and are not blocked by this call.
    if (showChinese) {
      translateWordFast(currentWord, lang as TranslateLang, 'en', { noDeepSeekFallback: true })
        .then((cn) => { if (!cancelled && cn) setDefinitionCn(cn); })
        .catch(() => { /* silent */ });
    }

    // Pass the page language as the translation target: English mode asks the
    // API for English definitions (no server translation, fast), Chinese mode
    // asks for Chinese. Previously this was hardcoded to zh-CN, so the popup
    // always showed Chinese definitions even after switching to English.
    lookupWord(currentWord, showChinese ? 'zh-CN' : 'en').then((result) => {
      if (cancelled) return;
      if (result) {
        setEntry(result);
      } else {
        setError('not-found');
      }
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('request');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentWord, showChinese, lang]);

  // Fetch AI enrichment (bilingual example + contextual analysis) for the word.
  // Chinese mode only — English study mode skips the call to save tokens.
  // Cached per (word, videoId) in IndexedDB by the service, so repeats are free.
  useEffect(() => {
    if (!showChinese) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAiAnalysis(null);
      setAiLoading(false);
      return;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiAnalysis(null);
    setExpandAiAnalysis(false);

    getWordAnalysis(currentWord, { videoId, context, lang })
      .then((res) => {
        if (cancelled) return;
        setAiAnalysis(res);
        setAiLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentWord, showChinese, videoId, context, lang]);

  // Look up a new word from the definition (push current to history)
  const handleLookupWord = useCallback((w: string) => {
    const cleaned = w.replace(/[^\w']/g, '').toLowerCase();
    if (!cleaned || cleaned === currentWord.toLowerCase()) return;
    setWordHistory((prev) => [...prev, currentWord]);
    setCurrentWord(cleaned);
  }, [currentWord]);

  // Go back to the previous word
  const handleGoBack = useCallback(() => {
    setWordHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const prevWord = newHistory.pop()!;
      setCurrentWord(prevWord);
      return newHistory;
    });
  }, []);

  const handlePlayAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Prefer the source recording when Free Dictionary provides one,
    // otherwise fall back to the browser's built-in TTS (always available,
    // no network) so pronunciation always works.
    if (entry?.audioUrl) {
      new Audio(entry.audioUrl).play().catch(() => speakWord(currentWord));
    } else {
      speakWord(currentWord);
    }
  };

  const updatePlacement = useCallback(() => {
    if (!popupRef.current || loading) return;
    setPopupTop(getPopupTop(y, popupRef.current.getBoundingClientRect().height, window.innerHeight));
  }, [loading, y]);

  useLayoutEffect(() => {
    updatePlacement();
  }, [updatePlacement, entry, expandDefs, expandDictionaryDefinitions, expandAiAnalysis, aiAnalysis]);

  // Re-evaluate placement on window resize.
  useEffect(() => {
    window.addEventListener('resize', updatePlacement);
    return () => window.removeEventListener('resize', updatePlacement);
  }, [updatePlacement]);

  return (
    <div
      ref={popupRef}
      className="fixed z-50 transform -translate-x-1/2"
      style={{
        left: Math.min(Math.max(x, 170), window.innerWidth - 170),
        top: popupTop ?? y + 24,
      }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 p-4 min-w-[260px] max-w-[min(340px,90vw)] max-h-[85vh] overflow-y-auto overflow-x-hidden relative thin-scrollbar">
        {/* Close button — visible on mobile */}
        <button
          onClick={onClose}
          className="md:hidden absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Word header */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1">
          {wordHistory.length > 0 && (
            <button
              onClick={handleGoBack}
              title="Back to previous word"
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-indigo-500 hover:text-indigo-700 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <span className="text-lg font-bold text-gray-800 dark:text-gray-200">{currentWord}</span>
          {entry?.lemma && (
            <span
              className="text-xs font-normal text-gray-400 dark:text-gray-500"
              title="Base form (lemma)"
            >
              ← {entry.lemma}
            </span>
          )}
          <button
            onClick={handlePlayAudio}
            title="Play pronunciation (TTS)"
            className="p-1.5 text-indigo-600 hover:text-indigo-800 bg-indigo-50/70 hover:bg-indigo-100 rounded-full transition-colors cursor-pointer"
            aria-label="Play pronunciation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
        </div>

        {/* Phonetic — baseline-aligned, IPA-aware font, wraps gracefully. */}
        {entry && !loading && (
          <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {entry.phoneticUk && entry.phoneticUs && entry.phoneticUk !== entry.phoneticUs ? (
              <>
                <span className="inline-flex items-baseline gap-1 text-sm text-gray-400 dark:text-gray-500">
                  <span className="text-[10px] opacity-70">UK</span>
                  <span className="font-ipa">/{entry.phoneticUk}/</span>
                </span>
                <span className="inline-flex items-baseline gap-1 text-sm text-gray-400 dark:text-gray-500">
                  <span className="text-[10px] opacity-70">US</span>
                  <span className="font-ipa">/{entry.phoneticUs}/</span>
                </span>
              </>
            ) : (
              entry?.phonetic && (
                <span className="inline-flex items-baseline gap-1 text-sm text-gray-400 dark:text-gray-500">
                  <span className="text-[10px] opacity-70">IPA</span>
                  <span className="font-ipa">/{entry.phonetic}/</span>
                </span>
              )
            )}
          </div>
        )}

        {/* One-line Chinese translation at the top of the dictionary content */}
        {showChinese && primaryMeaning && !loading && entry && (
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            {primaryPos && (
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {primaryPos}
              </span>
            )}
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-relaxed">
              {primaryMeaning}
            </span>
          </div>
        )}

        {/* Part of speech — hidden when the list below already labels each row */}
        {entry?.reference?.senses[0]?.pos &&
          (!showChinese || !primaryMeaning) &&
          referenceSenses.length === 0 && (
            <span className="inline-block text-[11px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 rounded-full font-medium mb-2">
              {compactPartOfSpeech(entry.reference.senses[0].pos)}
            </span>
          )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Looking up...
          </div>
        )}

        {/* Dictionary result */}
        {entry && !loading && (
          <>
            {hasDictionaryDetails && (
              <button
                onClick={() => setExpandDictionaryDefinitions((v) => !v)}
                aria-expanded={expandDictionaryDefinitions}
                className="mb-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer transition-colors"
              >
                {expandDictionaryDefinitions ? '收起词典参考释义' : '查看词典参考释义'}
              </button>
            )}
            {(!showChinese || expandDictionaryDefinitions) && <div className="mb-3">
            {referenceSenses.length > 0 ? (
              <>
                {definitionGroups.length > 0 && <div className="space-y-3">
                  {definitionGroups.map((group) => (
                    <section key={group.pos || 'definition'} aria-label={`Part of speech ${group.pos}`}>
                      {group.pos && (
                        <h3 className="mb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-semibold">
                          {group.pos}
                        </h3>
                      )}
                      <ol className="list-decimal list-inside space-y-1.5">
                        {group.items.map((definition, i) => (
                          <li key={`${group.pos}-${i}`} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {definition.displayText}
                            {showChinese && definition.translationStatus === 'fallback-en' && (
                              <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                                （英文原文，翻译失败）
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>}
                {!showChinese && referenceSenses.length > definitionLimit && (
                  <button
                    onClick={() => setExpandDefs((v) => !v)}
                    className="mt-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer transition-colors"
                  >
                    {expandDefs
                      ? t('wordCard.collapse')
                      : t('wordCard.showMoreMeanings', {
                          count: referenceSenses.length - definitionLimit,
                          s: referenceSenses.length - definitionLimit > 1 ? 's' : '',
                        })}
                  </button>
                )}
              </>
            ) : null}
            {entry.example && (
              <div className="mt-2 border-t border-gray-100 dark:border-slate-700 pt-2">
                <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{t('wordCard.dictionaryExample')}</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed">
                  &ldquo;{entry.example}&rdquo;
                </p>
              </div>
            )}
            {entry.synonyms.length > 0 && (
              <div className="mt-2 flex items-start gap-1 flex-wrap">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-px">syn:</span>
                {entry.synonyms.slice(0, 5).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleLookupWord(s)}
                    className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950 cursor-pointer transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {entry.antonyms.length > 0 && (
              <div className="mt-1 flex items-start gap-1 flex-wrap">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-px">ant:</span>
                {entry.antonyms.slice(0, 5).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleLookupWord(s)}
                    className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950 cursor-pointer transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            </div>}
          </>
        )}

        {/* AI enrichment: bilingual example + 语境分析 (zh mode only).
            Kept compact: no separate AI meaning line (the Google/translation line
            above already gives the Chinese gloss), just example + context note. */}
        {showChinese && (aiLoading || aiAnalysis) && (
          <div className="mb-2 border-t border-gray-100 dark:border-slate-700 pt-1.5 mt-1 text-left">
            {aiLoading && !aiAnalysis && (
              <div className="flex items-center gap-2 py-0.5 text-xs text-gray-400">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('wordCard.aiLoading')}
              </div>
            )}
            {aiAnalysis?.exampleEn && (
              <div className="mb-1">
                <div className="text-[10px] font-medium text-indigo-500">{t('wordCard.aiExample')}</div>
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{aiAnalysis.exampleEn}</p>
                {aiAnalysis.exampleZh && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">{aiAnalysis.exampleZh}</p>
                )}
              </div>
            )}
            {aiAnalysis?.analysis && (
              <div>
                <button
                  onClick={() => setExpandAiAnalysis((v) => !v)}
                  aria-expanded={expandAiAnalysis}
                  className="text-[10px] font-medium text-indigo-500 cursor-pointer"
                >
                  {expandAiAnalysis ? '收起语境分析' : '查看语境分析'}
                </button>
                {expandAiAnalysis && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    {aiAnalysis.analysis}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">
              {error === 'request'
                ? t('wordCard.lookupError')
                : isKnownProperNoun(currentWord)
                ? 'No dictionary entry — this looks like a name, brand, or abbreviation.'
                : 'Dictionary entry not found.'}
            </p>
            {showChinese && primaryMeaning && (
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-relaxed mt-1">{primaryMeaning}</p>
            )}
          </div>
        )}

        {/* One primary action area, followed by de-emphasized provider attribution. */}
        {actions && (
          <div className="mt-3 border-t border-gray-100 dark:border-slate-700 pt-3">
            {actions}
          </div>
        )}
        {entry?.provider === 'Merriam-Webster' && (
          <a
            href="https://www.learnersdictionary.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="block mt-2 text-[10px] text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors"
          >
            Powered by Merriam-Webster Learner&apos;s Dictionary
          </a>
        )}
      </div>
    </div>
  );
};

export default WordDictionaryPopup;
