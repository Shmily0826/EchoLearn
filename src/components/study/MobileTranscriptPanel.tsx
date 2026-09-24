import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { lemmatize } from '../../utils/lemmatizer';
import { extractSentence } from '../../utils/sentence';
import { lookupWord } from '../../services/dictionaryService';
import { prepareVocabularyItem } from '../../services/vocabularyEnrichment';
import { tomorrowMs } from '../../utils/storage';
import type { TranscriptLine, VocabularyItem, SentenceItem } from '../../types';
import WordDictionaryPopup, { type WordDictionaryPopupData } from '../WordDictionaryPopup';
import { formatTime } from './formatTime';
/** How long a learner keeps their own scroll position after manual input. */
const FOLLOW_RESUME_GRACE_MS = 6000;

interface MobileWordPopup {
  word: string;
  context: string;
  startTime: number;
  x: number;
  y: number;
  rowTop: number;
  rowBottom: number;
}

const MobileTranscriptPanel: React.FC<{
  lines: TranscriptLine[];
  activeLineIndex: number;
  videoId: string;
  videoTitle: string;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  savedSentenceIds: Map<string, string>;
  selectedLineStart?: number;
  onSelectLine?: (line: TranscriptLine) => void;
  onLookupStateChange?: (active: boolean) => void;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  onRemoveSentence: (id: string) => void;
  onSeekTo: (seconds: number) => void;
}> = ({ lines, activeLineIndex, videoId, videoTitle, savedWords, savedSentences, savedSentenceIds, selectedLineStart, onSelectLine, onLookupStateChange, onAddVocabulary, onAddSentence, onRemoveSentence, onSeekTo }) => {
  const { t, lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popup, setPopup] = useState<MobileWordPopup | null>(null);
  const [dictionaryData, setDictionaryData] = useState<WordDictionaryPopupData | null>(null);
  // Row element of the popup's source sentence: the context bar mounted by the
  // selection shifts the transcript after the click-time rect was taken.
  const popupRowRef = useRef<HTMLElement | null>(null);
  const showChinese = lang === 'zh';

  // Wheel/touch rather than the `scroll` event: the follow-scroll below fires
  // scroll itself, and treating that as manual input suppressed the next three
  // seconds of following — which on a dense transcript meant the list never
  // kept up with the highlighted line.
  const handleScroll = useCallback(() => {
    userScrolled.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolled.current = false;
    }, FOLLOW_RESUME_GRACE_MS);
  }, []);

  useEffect(() => {
    if (userScrolled.current || !activeRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const el = activeRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Re-engage only once the line being read has actually left the screen, so
    // a small scroll to re-read a sentence is not yanked back.
    if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) return;
    const targetScroll =
      container.scrollTop +
      (elRect.top - containerRect.top) -
      container.clientHeight * 0.4 +
      elRect.height / 2;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [activeLineIndex]);

  const showPopup = useCallback((word: string, line: TranscriptLine, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const rowEl = target.closest<HTMLElement>('[data-transcript-line]');
    const rowRect = rowEl?.getBoundingClientRect();
    popupRowRef.current = rowEl ?? null;
    setDictionaryData(null);
    setPopup({
      word,
      context: line.text,
      startTime: line.start,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      rowTop: rowRect?.top ?? rect.top - 8,
      rowBottom: rowRect?.bottom ?? rect.bottom,
    });
    onSelectLine?.(line);
    onLookupStateChange?.(true);
  }, [onLookupStateChange, onSelectLine]);

  // Re-measure the source row after the context bar shifts the layout, so the
  // popup anchors to where the row actually is.
  useLayoutEffect(() => {
    if (!popup) return;
    const rowEl = popupRowRef.current;
    if (!rowEl || !rowEl.isConnected) return;
    const rect = rowEl.getBoundingClientRect();
    if (rect.height === 0) return;
    setPopup((prev) => {
      if (!prev || (prev.rowTop === rect.top && prev.rowBottom === rect.bottom)) return prev;
      return { ...prev, rowTop: rect.top, rowBottom: rect.bottom };
    });
  }, [popup]);

  const handleAddWord = useCallback(async () => {
    if (!popup) return;
    const word = dictionaryData?.word || popup.word;
    let enEntry = !showChinese ? dictionaryData?.entry : null;
    if (!enEntry) {
      try {
        enEntry = await lookupWord(word, 'en');
      } catch {
        /* keep empty */
      }
    }
    const item = prepareVocabularyItem({
      id: `vocab_${Date.now()}`,
      word,
      meaningCn: '',
      context: extractSentence(popup.context, word),
      fullContext: popup.context,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      sourceTimestamp: popup.startTime,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    }, {
      dictionaryEntry: dictionaryData?.entry || enEntry,
      dictionaryFields: enEntry,
      learnerMeaning: dictionaryData?.learnerMeaning,
    });
    onAddVocabulary(item);
    setPopup(null);
    setDictionaryData(null);
    onLookupStateChange?.(false);
  }, [popup, dictionaryData, showChinese, videoId, videoTitle, onAddVocabulary, onLookupStateChange]);

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

  const splitIntoWords = (text: string) => text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  const isWordSaved = (word: string) => savedWords.has(lemmatize(word).toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);

  if (lines.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
        {t('study.noSubtitles')}
      </div>
    );
  }

  return (
    <div className="relative">
      {popup && (
        <WordDictionaryPopup
          word={popup.word}
          x={popup.x}
          y={popup.y}
          context={popup.context}
          showContext
          sourceLineStart={popup.startTime}
          sourceRowTop={popup.rowTop}
          sourceRowBottom={popup.rowBottom}
          videoId={videoId}
          onClose={() => { setPopup(null); setDictionaryData(null); onLookupStateChange?.(false); }}
          onDataChange={setDictionaryData}
          actions={
            isWordSaved(dictionaryData?.word || popup.word) ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('study.alreadySaved')}</span>
            ) : (
              <button onClick={handleAddWord} className="w-full px-3 py-2 text-sm bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 font-medium cursor-pointer">
                + {t('study.addToVocab')}
              </button>
            )
          }
        />
      )}

      <div
        ref={containerRef}
        onWheel={handleScroll}
        onTouchMove={handleScroll}
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
              data-selected-context={selectedLineStart === line.start ? 'true' : undefined}
              className={`px-2 py-1.5 rounded-lg text-sm leading-relaxed transition-colors ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-medium'
                  : selectedLineStart === line.start
                    ? 'ring-2 ring-indigo-300 dark:ring-indigo-700 text-indigo-900 dark:text-indigo-100'
                  : sentenceSaved
                    ? 'bg-violet-50 dark:bg-violet-950/20 text-gray-600 dark:text-gray-400'
                    : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <div className="flex-1 min-w-0" onClick={() => { onSelectLine?.(line); onSeekTo(line.start); }}>
                  <span
                    className="text-[10px] font-mono mr-1.5 select-none cursor-pointer hover:text-indigo-600"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSelectLine?.(line); onSeekTo(line.start); }}
                  >
                    {formatTime(line.start)}
                  </span>
                  {splitIntoWords(line.text).map((token, i) => {
                    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                    if (/^[^\w']+$/.test(token)) return <span key={i} className="text-gray-400">{token}</span>;
                    const saved = isWordSaved(token.toLowerCase());
                    return (
                      <span
                        key={i}
                        onClick={(e) => showPopup(token, line, e)}
                        className={`inline-block mx-[1px] px-1 py-0.5 rounded cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
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
                <button
                  aria-label={sentenceSaved ? t('study.removeSentenceBookmark') : t('study.saveSentenceBookmark')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sentenceSaved) {
                      const id = savedSentenceIds.get(line.text);
                      if (id) onRemoveSentence(id);
                    } else {
                      handleAddSentence(line);
                    }
                  }}
                  className={`flex-shrink-0 p-3.5 -m-2 rounded transition-colors cursor-pointer ${
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
