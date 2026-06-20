import React, { useState, useRef, useEffect } from 'react';
import type { TranscriptLine, VocabularyItem, SentenceItem, DictionaryEntry } from '../types';
import { tomorrowMs } from '../utils/storage';
import { lookupWord } from '../services/dictionaryService';

interface TranscriptViewerProps {
  lines: TranscriptLine[];
  videoId: string;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  activeLineIndex: number;
  onSeekTo: (seconds: number) => void;
}

/** Popup card that appears when clicking a word */
interface WordPopupState {
  word: string;
  context: string;
  startTime: number; // transcript line start time for sourceTimestamp
  x: number;
  y: number;
}

const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  lines,
  videoId,
  onAddVocabulary,
  onAddSentence,
  savedWords,
  savedSentences,
  activeLineIndex,
  onSeekTo,
}) => {
  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState(false);

  const popupRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    };
    if (popup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [popup]);

  // Auto-scroll to the active line
  useEffect(() => {
    if (activeLineIndex >= 0 && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLineIndex]);

  // Trigger dictionary lookup when popup opens
  useEffect(() => {
    if (!popup) return;
    setDictEntry(null);
    setDictLoading(true);
    setDictError(false);

    let cancelled = false;
    lookupWord(popup.word).then((entry) => {
      if (cancelled) return;
      if (entry) {
        setDictEntry(entry);
      } else {
        setDictError(true);
      }
      setDictLoading(false);
    });

    return () => { cancelled = true; };
  }, [popup]);

  const handleWordClick = (
    word: string,
    context: string,
    lineStart: number,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({
      word,
      context,
      startTime: lineStart,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleAddWord = () => {
    if (!popup) return;
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}`,
      word: popup.word,
      meaningCn: dictEntry?.definitionEn || '',
      context: popup.context,
      sourceVideoId: videoId,
      sourceTimestamp: popup.startTime,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
      // Merge dictionary data
      phonetic: dictEntry?.phonetic || '',
      audioUrl: dictEntry?.audioUrl || '',
      partOfSpeech: dictEntry?.partOfSpeech || '',
      definitionEn: dictEntry?.definitionEn || '',
      example: dictEntry?.example || '',
      synonyms: dictEntry?.synonyms || [],
      antonyms: dictEntry?.antonyms || [],
      dictionaryProvider: dictEntry?.provider || '',
    };
    onAddVocabulary(item);
    setPopup(null);
  };

  const handlePlayAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dictEntry?.audioUrl) {
      const audio = new Audio(dictEntry.audioUrl);
      audio.play().catch(() => { /* ignore autoplay errors */ });
    }
  };

  const handleAddSentence = (line: TranscriptLine) => {
    const item: SentenceItem = {
      id: `sent_${Date.now()}`,
      text: line.text,
      meaningCn: '',
      sourceVideoId: videoId,
      startTime: line.start,
      addedAt: Date.now(),
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddSentence(item);
  };

  const handleTimestampClick = (line: TranscriptLine, e: React.MouseEvent) => {
    e.stopPropagation();
    onSeekTo(line.start);
  };

  const handleLineClick = (line: TranscriptLine) => {
    onSeekTo(line.start);
  };

  const isWordSaved = (word: string) => savedWords.has(word.toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);

  /** Strip punctuation from a word for display but keep it for reference */
  const splitIntoWords = (text: string) => {
    return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  };

  // ── Determine popup flip direction ──────────────────────────
  const shouldFlip = popup ? popup.y < 280 : false;

  return (
    <div className="relative">
      {/* Word popup */}
      {popup && (
        <div
          ref={popupRef}
          className={`fixed z-50 transform -translate-x-1/2 ${
            shouldFlip ? '' : '-translate-y-full'
          }`}
          style={{ left: popup.x, top: shouldFlip ? popup.y + 24 : popup.y }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-4 min-w-[280px] max-w-[340px]">
            {/* Word + phonetic */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-gray-800">
                {popup.word}
              </span>
              {dictEntry?.phonetic && (
                <span className="text-sm text-gray-400 font-mono">
                  {dictEntry.phonetic}
                </span>
              )}
              {dictEntry?.audioUrl && (
                <button
                  onClick={handlePlayAudio}
                  title="Play pronunciation"
                  className="p-1 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-full transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                    <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Part of speech */}
            {dictEntry?.partOfSpeech && (
              <span className="inline-block text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium mb-2">
                {dictEntry.partOfSpeech}
              </span>
            )}

            {/* Loading state */}
            {dictLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12" cy="12" r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Looking up...
              </div>
            )}

            {/* Dictionary result */}
            {dictEntry && !dictLoading && (
              <div className="mb-3">
                {dictEntry.definitionEn && (
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {dictEntry.definitionEn}
                  </p>
                )}
                {dictEntry.example && (
                  <p className="text-xs text-gray-400 mt-1.5 italic leading-relaxed">
                    &ldquo;{dictEntry.example}&rdquo;
                  </p>
                )}
                {dictEntry.synonyms.length > 0 && (
                  <div className="mt-2 flex items-start gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-400 font-medium mt-px">syn:</span>
                    {dictEntry.synonyms.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {dictEntry.antonyms.length > 0 && (
                  <div className="mt-1 flex items-start gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-400 font-medium mt-px">ant:</span>
                    {dictEntry.antonyms.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error / not found state */}
            {dictError && !dictLoading && (
              <p className="text-xs text-gray-400 mb-3">
                Dictionary entry not found. You can still save this word manually.
              </p>
            )}

            {/* Context */}
            <p className="text-[11px] text-gray-400 mb-3 line-clamp-2 leading-relaxed">
              &ldquo;{popup.context}&rdquo;
            </p>

            {/* Action button */}
            {isWordSaved(popup.word) ? (
              <span className="text-xs text-amber-600 font-medium">
                已在生词本中
              </span>
            ) : (
              <button
                onClick={handleAddWord}
                className="w-full px-3 py-2 text-sm bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors font-medium cursor-pointer"
              >
                + 加入生词本
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transcript lines */}
      <div className="space-y-2">
        {lines.map((line, idx) => {
          const isActive = idx === activeLineIndex;
          const sentenceSaved = isSentenceSaved(line.text);

          // Build className based on state
          let lineClass =
            'group rounded-lg px-3 py-2.5 transition-all border cursor-pointer';
          if (isActive) {
            lineClass += ' bg-indigo-50 border-l-[3px] border-l-indigo-500 border-t-indigo-200 border-r-indigo-200 border-b-indigo-200 shadow-sm';
          } else if (sentenceSaved) {
            lineClass += ' bg-violet-50 border-violet-200';
          } else {
            lineClass += ' bg-white border-transparent hover:bg-gray-50 hover:border-gray-200';
          }

          return (
            <div
              key={idx}
              ref={isActive ? activeLineRef : undefined}
              className={lineClass}
              onClick={() => handleLineClick(line)}
            >
              <div className="flex items-start gap-2">
                {/* Main content: timestamp + words */}
                <div className="flex-1 min-w-0">
                  {/* Timestamp */}
                  <span
                    className="text-[11px] font-mono mr-2 select-none cursor-pointer hover:text-indigo-600 transition-colors"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => handleTimestampClick(line, e)}
                  >
                    {formatTime(line.start)}
                  </span>

                  {/* Words */}
                  <span className="text-[15px] leading-relaxed">
                    {splitIntoWords(line.text).map((token, i) => {
                      // Skip whitespace tokens
                      if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                      // Punctuation tokens
                      if (/^[^\w']+$/.test(token))
                        return (
                          <span key={i} className="text-gray-400">
                            {token}
                          </span>
                        );
                      // Actual word
                      const saved = isWordSaved(token.toLowerCase());
                      return (
                        <span
                          key={i}
                          onClick={(e) => handleWordClick(token, line.text, line.start, e)}
                          className={`inline-block mx-[1px] px-0.5 rounded cursor-pointer transition-colors ${
                            saved
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'hover:bg-indigo-100 hover:text-indigo-700'
                          }`}
                        >
                          {token}
                        </span>
                      );
                    })}
                  </span>
                </div>

                {/* Bookmark button — save / unsave sentence */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddSentence(line);
                  }}
                  title={sentenceSaved ? '已收藏' : '收藏此句'}
                  className={`flex-shrink-0 p-1 rounded transition-colors cursor-pointer ${
                    sentenceSaved
                      ? 'text-violet-500 hover:text-violet-700'
                      : 'text-gray-300 hover:text-violet-400 opacity-0 group-hover:opacity-100'
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
