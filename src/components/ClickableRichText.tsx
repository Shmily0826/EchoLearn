import React, { useState, useCallback } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { VocabularyItem } from '../types';
import { lemmatize } from '../utils/lemmatizer';
import { tomorrowMs } from '../utils/storage';
import WordDictionaryPopup from './WordDictionaryPopup';

interface ClickableRichTextProps {
  text: string;
  videoId: string;
  videoTitle?: string;
  savedWords: Set<string>;
  onAddVocabulary: (item: VocabularyItem) => void;
  className?: string;
}

interface PopupState {
  word: string;
  x: number;
  y: number;
}

/** Split text into words, punctuation, and whitespace tokens. */
function splitIntoWords(text: string): string[] {
  return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
}

/**
 * Renders English text where every word is clickable for dictionary lookup,
 * just like the transcript. Clicking a word opens the shared WordDictionaryPopup
 * and allows saving it to the vocabulary.
 */
const ClickableRichText: React.FC<ClickableRichTextProps> = ({
  text,
  videoId,
  videoTitle,
  savedWords,
  onAddVocabulary,
  className = '',
}) => {
  const { t } = useI18n();
  const [popup, setPopup] = useState<PopupState | null>(null);
  // The popup may switch to a related word (synonym / definition word); save
  // the currently-displayed word when the user presses "Add to Vocab".
  const [displayedWord, setDisplayedWord] = useState<string>('');

  const isWordSaved = useCallback(
    (word: string) => savedWords.has(lemmatize(word).toLowerCase()),
    [savedWords],
  );

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDisplayedWord(word);
    setPopup({
      word,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleAddWord = () => {
    const word = displayedWord || popup?.word;
    if (!word) return;
    const lemma = lemmatize(word);
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}`,
      word: lemma,
      lemma,
      meaningCn: '', // StudyPage auto-translates if empty
      context: text,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddVocabulary(item);
    setPopup(null);
  };

  return (
    <>
      {popup && (
        <WordDictionaryPopup
          word={popup.word}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
          onWordChange={setDisplayedWord}
          videoId={videoId}
          context={text}
          actions={
            isWordSaved(displayedWord || popup.word) ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t('transcript.wordSaved')}
              </span>
            ) : (
              <button
                onClick={handleAddWord}
                className="w-full px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800 transition-colors font-medium cursor-pointer"
              >
                {t('transcript.addWord')}
              </button>
            )
          }
        />
      )}
      <span className={className}>
        {splitIntoWords(text).map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
          if (/^[^\w']+$/.test(token))
            return (
              <span key={i} className="text-gray-400">
                {token}
              </span>
            );
          const saved = isWordSaved(token);
          return (
            <span
              key={i}
              onClick={(e) => handleWordClick(token, e)}
              className={`inline-block mx-[1px] px-1 md:px-0.5 py-0.5 md:py-0 rounded cursor-pointer transition-colors ${
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
    </>
  );
};

export default ClickableRichText;
