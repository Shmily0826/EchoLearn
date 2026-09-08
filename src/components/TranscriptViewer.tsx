import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { TranscriptLine, VocabularyItem, SentenceItem } from '../types';
import { tomorrowMs } from '../utils/storage';
import { createItemId, currentTimeMs } from '../utils/id';
import { lemmatize } from '../utils/lemmatizer';
import { extractSentence } from '../utils/sentence';
import { lookupWord } from '../services/dictionaryService';
import WordDictionaryPopup, { type WordDictionaryPopupData } from './WordDictionaryPopup';

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
  onSeekTo: (seconds: number) => void;
}

interface WordPopupState {
  word: string;
  context: string;
  startTime: number;
  x: number;
  y: number;
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
  onSeekTo,
}) => {
  const { t, lang } = useI18n();
  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const [dictionaryData, setDictionaryData] = useState<WordDictionaryPopupData | null>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showChinese = lang === 'zh';

  const handleUserScroll = useCallback(() => {
    userScrolledRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      userScrolledRef.current = false;
    }, 3000);
  }, []);

  useEffect(() => {
    const lineEl = activeLineRef.current;
    if (!lineEl) return;
    const container = lineEl.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;
    container.addEventListener('scroll', handleUserScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleUserScroll);
  }, [handleUserScroll, lines]);

  useEffect(() => {
    if (activeLineIndex < 0 || !activeLineRef.current || userScrolledRef.current) return;
    const el = activeLineRef.current;
    const container = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetScroll =
      container.scrollTop +
      (elRect.top - containerRect.top) -
      container.clientHeight * 0.4 +
      elRect.height / 2;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [activeLineIndex]);

  const handleWordClick = (
    word: string,
    context: string,
    lineStart: number,
    e: React.MouseEvent | React.KeyboardEvent,
  ) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictionaryData(null);
    setPopup({
      word,
      context,
      startTime: lineStart,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleAddWord = async () => {
    if (!popup) return;
    const word = dictionaryData?.word || popup.word;
    const lemma = lemmatize(word);
    let enDict = !showChinese ? dictionaryData?.entry : null;
    if (!enDict) {
      try {
        enDict = await lookupWord(lemma, 'en');
      } catch {
        /* keep null */
      }
    }
    const item: VocabularyItem = {
      id: createItemId('vocab'),
      word: lemma,
      lemma,
      meaningCn: dictionaryData?.meaningCn || '',
      context: extractSentence(popup.context, lemma),
      fullContext: popup.context,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      sourceTimestamp: popup.startTime,
      addedAt: currentTimeMs(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
      phonetic: enDict?.phonetic || '',
      audioUrl: enDict?.audioUrl || '',
      partOfSpeech: enDict?.partOfSpeech || '',
      definitionEn: enDict?.definitionEn || '',
      example: enDict?.example || '',
      synonyms: enDict?.synonyms || [],
      antonyms: enDict?.antonyms || [],
      dictionaryProvider: enDict?.provider || '',
    };
    onAddVocabulary(item);
    setPopup(null);
    setDictionaryData(null);
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
    <div className="relative">
      {popup && (
        <WordDictionaryPopup
          word={popup.word}
          x={popup.x}
          y={popup.y}
          context={popup.context}
          videoId={videoId}
          onClose={() => { setPopup(null); setDictionaryData(null); }}
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
              className={lineClass}
              onClick={() => onSeekTo(line.start)}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span
                    className="text-[11px] font-mono mr-2 select-none cursor-pointer hover:text-indigo-600 transition-colors py-1 md:py-0"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSeekTo(line.start); }}
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
                          onClick={(e) => handleWordClick(token, line.text, line.start, e)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWordClick(token, line.text, line.start, e); } }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Look up ${token}`}
                          className={`inline-block mx-[1px] px-1 md:px-0.5 py-0.5 md:py-0 rounded cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                            saved
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800'
                              : 'hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-700 dark:hover:text-indigo-300 underline decoration-indigo-200/70 underline-offset-2'
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
                  title={sentenceSaved ? 'Remove bookmark' : 'Save sentence'}
                  aria-label={sentenceSaved ? 'Remove bookmark' : 'Save sentence'}
                  className={`flex-shrink-0 p-1.5 md:p-1 rounded transition-colors cursor-pointer ${
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
