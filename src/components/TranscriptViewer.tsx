import React, { useState, useRef, useEffect } from 'react';
import type { TranscriptLine, VocabularyItem, SentenceItem } from '../types';
import { tomorrowMs } from '../utils/storage';

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

  const handleWordClick = (word: string, context: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({
      word,
      context,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleAddWord = () => {
    if (!popup) return;
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}`,
      word: popup.word,
      meaningCn: '',
      context: popup.context,
      sourceVideoId: videoId,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddVocabulary(item);
    setPopup(null);
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

  const isWordSaved = (word: string) => savedWords.has(word.toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);

  /** Strip punctuation from a word for display but keep it for reference */
  const splitIntoWords = (text: string) => {
    // Match words (including contractions like "don't") and punctuation separately
    return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  };

  return (
    <div className="relative">
      {/* Word popup */}
      {popup && (
        <div
          ref={popupRef}
          className="fixed z-50 transform -translate-x-1/2 -translate-y-full"
          style={{ left: popup.x, top: popup.y }}
        >
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 min-w-[160px]">
            <p className="text-lg font-semibold text-gray-800 mb-1">{popup.word}</p>
            <p className="text-xs text-gray-500 mb-3 line-clamp-2">"{popup.context}"</p>
            {isWordSaved(popup.word) ? (
              <span className="text-xs text-amber-600 font-medium">
                已在生词本中
              </span>
            ) : (
              <button
                onClick={handleAddWord}
                className="w-full px-3 py-1.5 text-sm bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors font-medium cursor-pointer"
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
              onClick={() => handleAddSentence(line)}
            >
              {/* Timestamp — clickable to seek */}
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
                      onClick={(e) => handleWordClick(token, line.text, e)}
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

              {/* Sentence save hint */}
              <div
                className={`text-xs mt-1 transition-opacity ${
                  sentenceSaved
                    ? 'text-violet-500 opacity-100'
                    : 'text-gray-400 opacity-0 group-hover:opacity-100'
                }`}
              >
                {sentenceSaved ? '已加入重点句库' : '点击整句加入重点句库'}
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
