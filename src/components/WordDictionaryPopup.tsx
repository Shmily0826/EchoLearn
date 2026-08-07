import { useState, useEffect, useRef, useCallback } from 'react';
import type { DictionaryEntry } from '../types';
import { lookupWord, isKnownProperNoun } from '../services/dictionaryService';
import { translateWordFast, type TranslateLang } from '../services/translationService';
import { useI18n } from '../i18n/I18nContext';
import ClickableDefinition from './ClickableDefinition';

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
 * Supports recursive lookup: tap any word in the definition to look it up.
 */
const WordDictionaryPopup: React.FC<WordDictionaryPopupProps> = ({
  word: initialWord,
  x,
  y,
  onClose,
  actions,
}) => {
  const [currentWord, setCurrentWord] = useState(initialWord);
  const [wordHistory, setWordHistory] = useState<string[]>([]);
  const [entry, setEntry] = useState<(DictionaryEntry & { lemma?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [definitionCn, setDefinitionCn] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);
  const { lang } = useI18n();
  // In English page mode we deliberately hide the Chinese line and skip the
  // DeepSeek call entirely (pure-English study view, saves token quota).
  const showChinese = lang === 'zh';

  // Reset when initial word changes
  useEffect(() => {
    setCurrentWord(initialWord);
    setWordHistory([]);
  }, [initialWord]);

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
    setLoading(true);
    setError(false);
    setDefinitionCn('');

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

    lookupWord(currentWord).then((result) => {
      if (cancelled) return;
      if (result) {
        setEntry(result);
      } else {
        setError(true);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentWord, showChinese]);

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
        {/* Word + phonetic + back button */}
        <div className="flex items-center gap-2 mb-1">
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
          {/* Real UK/US split when the source provides both (Merriam-Webster),
              otherwise a single IPA. */}
          {entry?.phoneticUk && entry?.phoneticUs && entry.phoneticUk !== entry.phoneticUs ? (
            <span className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 font-mono">
              <span>
                <span className="text-[10px] mr-0.5 opacity-70">UK</span>/{entry.phoneticUk}/
              </span>
              <span>
                <span className="text-[10px] mr-0.5 opacity-70">US</span>/{entry.phoneticUs}/
              </span>
            </span>
          ) : (
            entry?.phonetic && (
              <span className="text-sm text-gray-400 dark:text-gray-500 font-mono">
                <span className="text-[10px] mr-0.5 opacity-70">IPA</span>
                {entry.phonetic}
              </span>
            )
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

        {/* Part of speech — hidden when the list below already labels each row */}
        {entry?.partOfSpeech &&
          !(entry.definitionsEn && entry.definitionsEn.length > 0) && (
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
            {entry.definitionsEn && entry.definitionsEn.length > 0 ? (
              <ul className="space-y-1.5">
                {entry.definitionsEn.map((d, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
                  >
                    {d.pos && (
                      <span className="inline-block text-[10px] px-1.5 py-0.5 mr-1.5 align-middle bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded font-medium">
                        {d.pos}
                      </span>
                    )}
                    <ClickableDefinition text={d.definition} onWordClick={handleLookupWord} />
                  </li>
                ))}
              </ul>
            ) : (
              entry.definitionEn && (
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  <ClickableDefinition text={entry.definitionEn} onWordClick={handleLookupWord} />
                </p>
              )
            )}
            {showChinese && definitionCn && (
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
            {/* Attribution — required by the Merriam-Webster free tier. */}
            {entry.provider === 'Merriam-Webster' && (
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
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mb-3">
            <p className="text-xs text-gray-400">
              {isKnownProperNoun(currentWord)
                ? 'No dictionary entry — this looks like a name, brand, or abbreviation.'
                : 'Dictionary entry not found.'}
            </p>
            {showChinese && definitionCn && (
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
