import { useState } from 'react';
import VocabularyList from './VocabularyList';
import SentenceList from './SentenceList';
import { useI18n } from '../../i18n/I18nContext';
import type { SentenceItem, VocabularyItem } from '../../types';

interface SavedItemsPanelProps {
  vocabulary: VocabularyItem[];
  sentences: SentenceItem[];
  onRemoveVocabulary: (id: string) => void;
  onRemoveSentence: (id: string) => void;
  onSeekSentence: (seconds: number) => void;
}

/** Presentational tab shell for the two saved-item lists. */
export default function SavedItemsPanel({
  vocabulary,
  sentences,
  onRemoveVocabulary,
  onRemoveSentence,
  onSeekSentence,
}: SavedItemsPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'vocab' | 'sentences'>('vocab');

  return (
    <div className="mt-8 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
      <div className="flex border-b border-gray-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('vocab')}
          className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'vocab' ? 'text-amber-700 dark:text-amber-400 border-b-2 border-amber-500' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          {`${t('study.vocabTab')} (${vocabulary.length})`}
        </button>
        <button
          onClick={() => setActiveTab('sentences')}
          className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'sentences' ? 'text-violet-700 dark:text-violet-400 border-b-2 border-violet-500' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          {`${t('study.sentTab')} (${sentences.length})`}
        </button>
      </div>
      <div className="p-4 max-h-64 overflow-y-auto">
        {activeTab === 'vocab' && (
          <VocabularyList items={vocabulary} onRemove={onRemoveVocabulary} />
        )}
        {activeTab === 'sentences' && (
          <SentenceList
            items={sentences}
            onRemove={onRemoveSentence}
            onSeek={onSeekSentence}
          />
        )}
      </div>
    </div>
  );
}
