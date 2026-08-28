import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { lemmatize } from '../../utils/lemmatizer';
import { extractSentence } from '../../utils/sentence';
import { lookupWord } from '../../services/dictionaryService';
import { tomorrowMs } from '../../utils/storage';
import type {
  TranscriptLine,
  VocabularyItem,
  SentenceItem,
  DictionaryEntry,
} from '../../types';
import { formatTime } from './formatTime';

interface MobileWordPopup {
  word: string;
  context: string;
  startTime: number;
  x: number;
  y: number;
}

const MobileTranscriptPanel: React.FC<{
  lines: TranscriptLine[];
  activeLineIndex: number;
  videoId: string;
  videoTitle: string;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  savedSentenceIds: Map<string, string>;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  onRemoveSentence: (id: string) => void;
  onSeekTo: (seconds: number) => void;
}> = ({ lines, activeLineIndex, videoId, videoTitle, savedWords, savedSentences, savedSentenceIds, onAddVocabulary, onAddSentence, onRemoveSentence, onSeekTo }) => {
  const { t, lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Word popup state
  const [popup, setPopup] = useState<MobileWordPopup | null>(null);
  const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState(false);
  const [dictWordHistory, setDictWordHistory] = useState<string[]>([]);
  const [dictCurrentWord, setDictCurrentWord] = useState('');

  // Detect user scrolling
  const handleScroll = useCallback(() => {
    userScrolled.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolled.current = false;
    }, 3000);
  }, []);

  // Auto-scroll to active line — container-relative, never scrolls the page.
  // Anchor the active line slightly above the vertical centre (40%) so the
  // playback controls stay visible while upcoming subtitles are readable.
  useEffect(() => {
    if (userScrolled.current || !activeRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const el = activeRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetScroll =
      container.scrollTop +
      (elRect.top - containerRect.top) -
      container.clientHeight * 0.4 +
      elRect.height / 2;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [activeLineIndex]);

  // Close popup on outside click
  useEffect(() => {
    if (!popup) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [popup]);

  // Dictionary lookup when dictCurrentWord changes
  const showChinese = lang === 'zh';
  useEffect(() => {
    if (!dictCurrentWord) return;
    // The lookup key changed; discard the previous definition immediately so
    // it cannot be mistaken for the current word while the request is pending.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDictEntry(null);
    setDictLoading(true);
    setDictError(false);
    let cancelled = false;
    // Pass the page language as the translation target: English mode asks the
    // API for English definitions (fast, no server translation), Chinese mode
    // asks for Chinese. Previously hardcoded to zh-CN, so the popup always
    // showed Chinese definitions even after switching to English.
    lookupWord(dictCurrentWord, showChinese ? 'zh-CN' : 'en').then((entry) => {
      if (cancelled) return;
      if (entry) setDictEntry(entry);
      else setDictError(true);
      setDictLoading(false);
    });
    return () => { cancelled = true; };
  }, [dictCurrentWord, showChinese]);

  // Look up a word from definition (push current to history)
  const handleDictWordClick = useCallback((w: string) => {
    const cleaned = w.replace(/[^\w']/g, '').toLowerCase();
    if (!cleaned || cleaned === dictCurrentWord.toLowerCase()) return;
    setDictWordHistory((prev) => [...prev, dictCurrentWord]);
    setDictCurrentWord(cleaned);
  }, [dictCurrentWord]);

  // Go back to previous word in dictionary history
  const handleDictGoBack = useCallback(() => {
    setDictWordHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const prevWord = newHistory.pop()!;
      setDictCurrentWord(prevWord);
      return newHistory;
    });
  }, []);

  const handleWordClick = useCallback((word: string, context: string, lineStart: number, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({
      word,
      context,
      startTime: lineStart,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
    setDictCurrentWord(word);
    setDictWordHistory([]);
  }, []);

  const handleAddWord = useCallback(async () => {
    if (!popup || !dictCurrentWord) return;
    const lemma = lemmatize(dictCurrentWord);
    // Decouple stored fields from the current UI language. The popup's dictEntry
    // is language-specific (zh-CN in Chinese mode, en in English mode), so its
    // `definitionEn` field holds CHINESE when in Chinese mode — saving it as the
    // English definition would leak Chinese into English mode. Always pull
    // meaningCn from a zh-CN lookup and definitionEn (plus phonetic/audio/
    // partOfSpeech/example/synonyms/antonyms) from an en lookup, regardless of UI
    // language. The dictionary cache (keyed by word+target) makes the second call
    // cheap when the word was already looked up in that language.
    let meaningCn = '';
    let enEntry = !showChinese && dictEntry ? dictEntry : null;
    try {
      const cnEntry = await lookupWord(lemma, 'zh-CN');
      meaningCn = cnEntry?.definitionEn || '';
    } catch {
      /* keep empty */
    }
    if (!enEntry) {
      try {
        enEntry = await lookupWord(lemma, 'en');
      } catch {
        /* keep empty */
      }
    }
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}`,
      word: lemma,
      lemma,
      meaningCn,
      context: extractSentence(popup.context, lemma),
      fullContext: popup.context,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      sourceTimestamp: popup.startTime,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
      phonetic: enEntry?.phonetic || '',
      audioUrl: enEntry?.audioUrl || '',
      partOfSpeech: enEntry?.partOfSpeech || '',
      definitionEn: enEntry?.definitionEn || '',
      example: enEntry?.example || '',
      synonyms: enEntry?.synonyms || [],
      antonyms: enEntry?.antonyms || [],
      dictionaryProvider: enEntry?.provider || '',
    };
    onAddVocabulary(item);
    setPopup(null);
  }, [popup, dictCurrentWord, dictEntry, showChinese, videoId, videoTitle, onAddVocabulary]);

  const handleAddSentence = useCallback((line: TranscriptLine) => {
    const item: SentenceItem = {
      id: `sent_${Date.now()}`,
      text: line.text,
      meaningCn: '',
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      startTime: line.start,
      addedAt: Date.now(),
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddSentence(item);
  }, [videoId, videoTitle, onAddSentence]);

  const handlePlayAudio = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (dictEntry?.audioUrl) {
      new Audio(dictEntry.audioUrl).play().catch(() => {});
    }
  }, [dictEntry]);

  const splitIntoWords = (text: string) => {
    return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  };

  const isWordSaved = (word: string) => savedWords.has(lemmatize(word).toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);

  const shouldFlip = popup ? popup.y < 280 : false;

  if (lines.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
        {t('study.noSubtitles')}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Word dictionary popup (mobile) */}
      {popup && (
        <div
          ref={popupRef}
          className={`fixed z-50 transform -translate-x-1/2 ${shouldFlip ? '' : '-translate-y-full'}`}
          style={{ left: Math.min(Math.max(popup.x, 170), window.innerWidth - 170), top: shouldFlip ? popup.y + 24 : popup.y }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 p-4 min-w-[260px] max-w-[min(340px,90vw)] max-h-[70vh] overflow-y-auto">
            <button
              onClick={() => setPopup(null)}
              className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-center gap-2 mb-1">
              {dictWordHistory.length > 0 && (
                <button
                  onClick={handleDictGoBack}
                  title="Back to previous word"
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-indigo-500 hover:text-indigo-700 transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <span className="text-lg font-bold text-gray-800 dark:text-gray-200">{dictCurrentWord}</span>
              {dictEntry?.phonetic && <span className="text-sm text-gray-400 font-mono">{dictEntry.phonetic}</span>}
              {dictEntry?.audioUrl && (
                <button onClick={handlePlayAudio} className="p-1 text-indigo-500 rounded-full cursor-pointer">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" /></svg>
                </button>
              )}
            </div>
            {dictEntry?.partOfSpeech && (
              <span className="inline-block text-[11px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full font-medium mb-2">{dictEntry.partOfSpeech}</span>
            )}
            {dictLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Looking up...
              </div>
            )}
            {dictEntry && !dictLoading && (
              <div className="mb-3">
                {dictEntry.definitionEn && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {dictEntry.definitionEn}
                  </p>
                )}
                {dictEntry.example && <p className="text-xs text-gray-400 mt-1.5 italic">&ldquo;{dictEntry.example}&rdquo;</p>}
                {dictEntry.synonyms.length > 0 && (
                  <div className="mt-2 flex items-start gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-400 font-medium mt-px">syn:</span>
                    {dictEntry.synonyms.slice(0, 5).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleDictWordClick(s)}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950 cursor-pointer transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {dictError && !dictLoading && <p className="text-xs text-gray-400 mb-3">Dictionary entry not found.</p>}
            <p className="text-[11px] text-gray-400 mb-3 line-clamp-2">&ldquo;{popup.context}&rdquo;</p>
            {isWordSaved(dictCurrentWord) ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('study.alreadySaved')}</span>
            ) : (
              <button onClick={handleAddWord} className="w-full px-3 py-2 text-sm bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 font-medium cursor-pointer">
                + {t('study.addToVocab')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transcript lines */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto max-h-[55vh] px-2 py-1 bg-white dark:bg-slate-800"
        style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollBehavior: 'smooth' }}
      >
        {lines.map((line, idx) => {
          const isActive = idx === activeLineIndex;
          const sentenceSaved = isSentenceSaved(line.text);

          return (
            <div
              key={line.id || idx}
              ref={isActive ? activeRef : null}
              data-transcript-line={idx}
              className={`px-2 py-1.5 rounded-lg text-sm leading-relaxed transition-colors ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-medium'
                  : sentenceSaved
                    ? 'bg-violet-50 dark:bg-violet-950/20 text-gray-600 dark:text-gray-400'
                    : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <div className="flex-1 min-w-0" onClick={() => onSeekTo(line.start)}>
                  <span
                    className="text-[10px] font-mono mr-1.5 select-none cursor-pointer hover:text-indigo-600"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSeekTo(line.start); }}
                  >
                    {formatTime(line.start)}
                  </span>
                  {/* Clickable words */}
                  {splitIntoWords(line.text).map((token, i) => {
                    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                    if (/^[^\w']+$/.test(token)) return <span key={i} className="text-gray-400">{token}</span>;
                    const saved = isWordSaved(token.toLowerCase());
                    return (
                      <span
                        key={i}
                        onClick={(e) => handleWordClick(token, line.text, line.start, e)}
                        className={`inline-block mx-[1px] px-1 py-0.5 rounded cursor-pointer transition-colors underline decoration-indigo-200/70 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                          saved
                            ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                            : 'active:bg-indigo-100'
                        }`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Look up ${token}`}
                      >
                        {token}
                      </span>
                    );
                  })}
                </div>
                {/* Sentence bookmark button — toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sentenceSaved) {
                      const id = savedSentenceIds.get(line.text);
                      if (id) onRemoveSentence(id);
                    } else {
                      handleAddSentence(line);
                    }
                  }}
                  className={`flex-shrink-0 p-1.5 rounded transition-colors cursor-pointer ${
                    sentenceSaved
                      ? 'text-violet-500 dark:text-violet-400'
                      : 'text-gray-300 active:text-violet-400'
                  }`}
                >
                  {sentenceSaved ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5 2h14a1 1 0 011 1v19.143a.5.5 0 01-.766.424L12 18.03l-7.234 4.536A.5.5 0 014 22.143V3a1 1 0 011-1z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MobileTranscriptPanel;
