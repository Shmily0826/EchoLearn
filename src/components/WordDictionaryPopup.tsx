import { useState, useEffect, useRef } from 'react';
import type { DictionaryEntry } from '../types';
import { lookupWord } from '../services/dictionaryService';
import { translateWord } from '../services/translationService';

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
}

/**
 * A reusable popup that shows dictionary information for a word.
 * Used by TranscriptViewer, VocabularyPage, and SentencesPage.
 */
const WordDictionaryPopup: React.FC<WordDictionaryPopupProps> = ({
  word,
  x,
  y,
  onClose,
  actions,
}) => {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [definitionCn, setDefinitionCn] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

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

  // Fetch dictionary data + Chinese translation
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDefinitionCn('');
    lookupWord(word).then((result) => {
      if (cancelled) return;
      if (result) {
        setEntry(result);
        // Fetch Chinese translation in background
        translateWord(word, result.definitionEn).then((cn) => {
          if (!cancelled && cn) setDefinitionCn(cn);
        }).catch(() => { /* silent */ });
      } else {
        setError(true);
        // Still try to translate the word itself
        translateWord(word).then((cn) => {
          if (!cancelled && cn) setDefinitionCn(cn);
        }).catch(() => { /* silent */ });
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [word]);

  const handlePlayAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entry?.audioUrl) {
      new Audio(entry.audioUrl).play().catch(() => {});
    }
  };

  const shouldFlip = y < 280;

  return (
    <div
      ref={popupRef}
      className={`fixed z-50 transform -translate-x-1/2 ${
        shouldFlip ? '' : '-translate-y-full'
      }`}
      style={{ left: Math.min(Math.max(x, 170), window.innerWidth - 170), top: shouldFlip ? y + 24 : y }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 p-4 min-w-[260px] max-w-[min(340px,90vw)] max-h-[70vh] overflow-y-auto relative">
        {/* Close button — visible on mobile */}
        <button
          onClick={onClose}
          className="md:hidden absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Word + phonetic */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg font-bold text-gray-800 dark:text-gray-200">{word}</span>
          {entry?.phonetic && (
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono">{entry.phonetic}</span>
          )}
          {entry?.audioUrl && (
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
        {entry?.partOfSpeech && (
          <span className="inline-block text-[11px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 rounded-full font-medium mb-2">
            {entry.partOfSpeech}
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
          <div className="mb-3">
            {entry.definitionEn && (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{entry.definitionEn}</p>
            )}
            {definitionCn && (
              <p className="text-sm text-indigo-600 dark:text-indigo-400 leading-relaxed mt-1">{definitionCn}</p>
            )}
            {entry.example && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 italic leading-relaxed">
                &ldquo;{entry.example}&rdquo;
              </p>
            )}
            {entry.synonyms.length > 0 && (
              <div className="mt-2 flex items-start gap-1 flex-wrap">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-px">syn:</span>
                {entry.synonyms.slice(0, 5).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 rounded">{s}</span>
                ))}
              </div>
            )}
            {entry.antonyms.length > 0 && (
              <div className="mt-1 flex items-start gap-1 flex-wrap">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-px">ant:</span>
                {entry.antonyms.slice(0, 5).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 rounded">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">Dictionary entry not found.</p>
            {definitionCn && (
              <p className="text-sm text-indigo-600 dark:text-indigo-400 leading-relaxed mt-1">{definitionCn}</p>
            )}
          </div>
        )}

        {/* Actions slot */}
        {actions}
      </div>
    </div>
  );
};

export default WordDictionaryPopup;
