import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import type { SentenceItem } from '../../types';
import { formatTime } from './formatTime';

const SentenceList: React.FC<{
  items: SentenceItem[];
  onRemove: (id: string) => void;
  onSeek?: (seconds: number) => void;
}> = ({ items, onRemove, onSeek }) => {
  const { t, lang } = useI18n();
  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
        {t('study.clickSent')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-violet-50 dark:bg-indigo-950/40 border border-violet-200 dark:border-indigo-700 rounded-lg p-3 group"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-violet-800 dark:text-indigo-200 leading-relaxed">{item.text}</p>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs whitespace-nowrap cursor-pointer"
            >
              {t('study.remove')}
            </button>
          </div>
          {lang === 'zh' && item.meaningCn && (
            <p className="text-xs text-violet-500 dark:text-indigo-400 mt-1 leading-relaxed">{item.meaningCn}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onSeek?.(item.startTime)}
              className="text-[10px] font-mono text-indigo-500 hover:text-indigo-700 hover:underline cursor-pointer"
              title="Jump to this point in the video"
            >
              @{formatTime(item.startTime)}
            </button>
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
  );
};

export default SentenceList;
