import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { TranscriptLine, VocabularyItem, SentenceItem } from '../types';
import { tomorrowMs } from '../utils/storage';
import { createItemId, currentTimeMs } from '../utils/id';
import { lemmatize } from '../utils/lemmatizer';
import { extractSentence } from '../utils/sentence';
import { lookupWord } from '../services/dictionaryService';
import { prepareVocabularyItem } from '../services/vocabularyEnrichment';
import WordDictionaryPopup, { type WordDictionaryPopupData } from './WordDictionaryPopup';

/** How long a learner keeps their own scroll position after manual input. */
const FOLLOW_RESUME_GRACE_MS = 6000;
/** Where the line being read is placed when the list moves: just above centre. */
const FOLLOW_ANCHOR = 0.45;

interface TranscriptViewerProps {
  lines: TranscriptLine[];
  videoId: string;
  videoTitle?: string;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  onRemoveSentence?: (id: string) => void;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  savedSentenceIds?: Map<string, string>;
  activeLineIndex: number;
  selectedLineStart?: number;
  onSelectLine?: (line: TranscriptLine) => void;
  onLookupStateChange?: (active: boolean) => void;
  onSeekTo: (seconds: number) => void;
}

interface WordPopupState {
  word: string;
  context: string;
  startTime: number;
  x: number;
  y: number;
  rowTop: number;
  rowBottom: number;
}

const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  lines,
  videoId,
  videoTitle,
  onAddVocabulary,
  onAddSentence,
  onRemoveSentence,
  savedWords,
  savedSentences,
  savedSentenceIds,
  activeLineIndex,
  selectedLineStart,
  onSelectLine,
  onLookupStateChange,
  onSeekTo,
}) => {
  const { t, lang } = useI18n();
  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const [dictionaryData, setDictionaryData] = useState<WordDictionaryPopupData | null>(null);
  // Row element of the popup's source sentence, kept for a post-render
  // re-measure: selecting a line mounts the context bar above the transcript,
  // which shifts every row down AFTER the click-time rect was taken.
  const popupRowRef = useRef<HTMLElement | null>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const lastManualScrollAtRef = useRef(0);
  const showChinese = lang === 'zh';

  // Manual input, not the `scroll` event: the follow-scroll below is itself a
  // scroll, and listening for it made every automatic jump suppress the next
  // three seconds of following. On a dense transcript (a Whisper or local
  // subtitle at under three seconds a line) that left the list permanently
  // behind the highlighted line.
  //
  // The window is a reading pause, not an animation delay: scrolling a row or
  // two up to check the line just spoken should not have the list dragged back
  // under the eyes. It is a timestamp rather than a timer because the hold has
  // to be judged against where the line currently is, and a cue boundary - the
  // only moment this matters - can arrive long after any timer would have run.
  const handleUserScroll = useCallback(() => {
    userScrolledRef.current = true;
    lastManualScrollAtRef.current = Date.now();
  }, []);

  // Attached to the scroll pane from this component's own root, NOT from the
  // active row: a real Whisper subtitle starts its first cue after zero
  // (0.07s in the lesson this was found in), so at mount there is no active row
  // at all. Resolving the pane through one made the learner's scroll invisible
  // to the component for the rest of the lesson, which is what read as "it
  // keeps dragging my list back".
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const container = root.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;
    container.addEventListener('wheel', handleUserScroll, { passive: true });
    container.addEventListener('touchmove', handleUserScroll, { passive: true });
    return () => {
      container.removeEventListener('wheel', handleUserScroll);
      container.removeEventListener('touchmove', handleUserScroll);
    };
  }, [handleUserScroll]);

  useEffect(() => {
    if (activeLineIndex < 0 || !activeLineRef.current) return;
    const el = activeLineRef.current;
    const container = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // The learner's own position wins while the line they stopped on is still on
    // screen: the pause renews itself for as long as it is, and only runs out
    // once following would have to lose the line entirely. A fixed window was
    // reported as "easily dragged back", because a sentence longer than the
    // window ends with the list moving under someone who is still reading it.
    if (userScrolledRef.current) {
      const inView = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
      if (inView || Date.now() - lastManualScrollAtRef.current < FOLLOW_RESUME_GRACE_MS) return;
      userScrolledRef.current = false;
    }
    // Follow to an anchor just above the middle of the pane, moving by the
    // least that keeps the line there. Refusing to move while the line is
    // anywhere on screen freezes the list for ten cues and then teleports a
    // screenful, which reads as "it stopped scrolling".
    const anchor = containerRect.top + containerRect.height * FOLLOW_ANCHOR;
    const delta = elRect.bottom > anchor
      ? elRect.bottom - anchor
      : elRect.top < containerRect.top
        ? elRect.top - containerRect.top
        : 0;
    if (delta === 0) return;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + delta),
      behavior: 'smooth',
    });
  }, [activeLineIndex]);

  const handleWordClick = (
    word: string,
    line: TranscriptLine,
    e: React.MouseEvent | React.KeyboardEvent,
  ) => {
    e.stopPropagation();
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
  };

  // Re-measure the source row once the context bar (mounted by this same
  // selection) has shifted the transcript, so the popup anchors to where the
  // row actually is, not where it was at click time.
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

  const handleAddWord = async () => {
    if (!popup) return;
    const word = dictionaryData?.word || popup.word;
    let enDict = !showChinese ? dictionaryData?.entry : null;
    if (!enDict) {
      try {
        enDict = await lookupWord(word, 'en');
      } catch {
        /* keep null */
      }
    }
    const item = prepareVocabularyItem({
      id: createItemId('vocab'),
      word,
      meaningCn: '',
      context: extractSentence(popup.context, word),
      fullContext: popup.context,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      sourceTimestamp: popup.startTime,
      addedAt: currentTimeMs(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    }, {
      dictionaryEntry: dictionaryData?.entry,
      dictionaryFields: enDict,
      learnerMeaning: dictionaryData?.learnerMeaning,
    });
    onAddVocabulary(item);
    setPopup(null);
    setDictionaryData(null);
    onLookupStateChange?.(false);
  };

  const handleAddSentence = (line: TranscriptLine) => {
    const item: SentenceItem = {
      id: createItemId('sent'),
      text: line.text,
      meaningCn: '',
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      startTime: line.start,
      addedAt: currentTimeMs(),
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddSentence(item);
  };

  const isWordSaved = (word: string) => savedWords.has(lemmatize(word).toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);
  const splitIntoWords = (text: string) => text.match(/[\w']+|[^\w\s]+|\s+/g) || [];

  return (
    <div className="relative" ref={rootRef}>
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
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t('transcript.wordSaved')}
              </span>
            ) : (
              <button
                id="tour-transcript-save-word"
                onClick={handleAddWord}
                className="w-full px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800 transition-colors font-medium cursor-pointer"
              >
                {t('transcript.addWord')}
              </button>
            )
          }
        />
      )}

      <div className="space-y-2">
        {lines.map((line, idx) => {
          const isActive = idx === activeLineIndex;
          const sentenceSaved = isSentenceSaved(line.text);
          let lineClass = 'group rounded-lg px-3 py-2.5 transition-colors border cursor-pointer';
          if (isActive) {
            lineClass += ' bg-indigo-50 dark:bg-indigo-950 border-l-[3px] border-l-indigo-500 border-t-indigo-200 border-r-indigo-200 border-b-indigo-200 shadow-sm';
          } else if (sentenceSaved) {
            lineClass += ' bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800';
          } else {
            lineClass += ' bg-white dark:bg-slate-800 border-transparent hover:bg-gray-50 dark:hover:bg-slate-900 hover:border-gray-200 dark:hover:border-slate-700';
          }

          return (
            <div
              key={idx}
              ref={isActive ? activeLineRef : undefined}
              data-transcript-line={idx}
              data-selected-context={selectedLineStart === line.start ? 'true' : undefined}
              className={`${lineClass}${selectedLineStart === line.start ? ' ring-2 ring-indigo-300 dark:ring-indigo-700' : ''}`}
              onClick={() => { onSelectLine?.(line); onSeekTo(line.start); }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span
                    className="text-[11px] font-mono mr-2 select-none cursor-pointer hover:text-indigo-600 transition-colors py-1 md:py-0"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSelectLine?.(line); onSeekTo(line.start); }}
                  >
                    {formatTime(line.start)}
                  </span>
                  <span className="text-[15px] leading-relaxed">
                    {splitIntoWords(line.text).map((token, i) => {
                      if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                      if (/^[^\w']+$/.test(token)) return <span key={i} className="text-gray-400">{token}</span>;
                      const saved = isWordSaved(token.toLowerCase());
                      return (
                        <span
                          key={i}
                          onClick={(e) => handleWordClick(token, line, e)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWordClick(token, line, e); } }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Look up ${token}`}
                          className={`inline-block mx-[1px] px-1 md:px-0.5 py-0.5 md:py-0 rounded cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                            saved
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800'
                              : 'hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-700 dark:hover:text-indigo-300'
                          }`}
                        >
                          {token}
                        </span>
                      );
                    })}
                  </span>
                </div>
                <button
                  id="tour-transcript-save-sentence"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sentenceSaved && onRemoveSentence && savedSentenceIds) {
                      const id = savedSentenceIds.get(line.text);
                      if (id) onRemoveSentence(id);
                    } else {
                      handleAddSentence(line);
                    }
                  }}
                  title={sentenceSaved ? t('study.removeSentenceBookmark') : t('study.saveSentenceBookmark')}
                  aria-label={sentenceSaved ? t('study.removeSentenceBookmark') : t('study.saveSentenceBookmark')}
                  className={`flex-shrink-0 p-3.5 -m-2 md:p-2 md:-m-0.5 rounded transition-colors cursor-pointer ${
                    sentenceSaved
                      ? 'text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300'
                      : 'text-gray-300 hover:text-violet-400'
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default TranscriptViewer;
