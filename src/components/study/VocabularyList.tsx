import React, { useState } from 'react';
import WordDictionaryPopup from '../WordDictionaryPopup';
import { useI18n } from '../../i18n/I18nContext';
import type { VocabularyItem } from '../../types';

interface DictPopupState {
  word: string;
  context?: string;
  x: number;
  y: number;
}

/** Split a sentence into word / punctuation / whitespace tokens. */
function splitTokens(text: string): string[] {
  return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
}

const VocabularyList: React.FC<{
  items: VocabularyItem[];
  onRemove: (id: string) => void;
}> = ({ items, onRemove }) => {
  const { t, lang } = useI18n();
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);

  const handleWordClick = (word: string, context: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({ word, context, x: rect.left + rect.width / 2, y: rect.top });
  };

  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
        {t('study.clickWord')}
      </p>
    );
  }

  return (
    <>
      {dictPopup && (
        <WordDictionaryPopup
          word={dictPopup.word}
          x={dictPopup.x}
          y={dictPopup.y}
          onClose={() => setDictPopup(null)}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 group"
          >
            <div className="flex items-start justify-between">
              <button
                type="button"
                className="flex items-center gap-1 text-base font-semibold text-amber-800 dark:text-amber-300 cursor-pointer hover:text-amber-900 dark:hover:text-amber-200 hover:underline bg-transparent border-0 p-0"
                onClick={(e) => handleWordClick(item.word, item.context, e)}
                title={t('study.clickWordDict') ?? 'Click to look up in dictionary'}
              >
                {item.word}
                <svg className="w-3.5 h-3.5 text-amber-600/70 dark:text-amber-400/70 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </button>
              <button
                onClick={() => onRemove(item.id)}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs cursor-pointer"
              >
                {t('study.remove')}
              </button>
            </div>
            {lang === 'en' ? (
              item.definitionEn ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{item.definitionEn}</p>
              ) : null
            ) : (
              item.meaningCn && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{item.meaningCn}</p>
              )
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
              &ldquo;
              {splitTokens(item.context).map((token, i) => {
                if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                if (/^[^\w']+$/.test(token))
                  return <span key={i} className="text-gray-400">{token}</span>;
                return (
                  <span
                    key={i}
                    onClick={(e) => handleWordClick(token, item.context, e)}
                    className="inline-block mx-[1px] px-0.5 rounded cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-300 transition-colors"
                  >
                    {token}
                  </span>
                );
              })}
              &rdquo;
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[200px]" title={item.sourceVideoTitle || item.sourceVideoId}>
                {item.sourceVideoTitle || item.sourceVideoId}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {new Date(item.addedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default VocabularyList;
