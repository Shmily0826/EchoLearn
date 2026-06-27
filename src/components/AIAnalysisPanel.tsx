import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type {
  AIAnalysisResult,
  VocabularySuggestion,
  SentenceSuggestion,
  VocabularyItem,
  SentenceItem,
} from '../types';
import { tomorrowMs } from '../utils/storage';

interface AIAnalysisPanelProps {
  analysis: AIAnalysisResult;
  videoId: string;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  onClose: () => void;
}

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  analysis,
  videoId,
  onAddVocabulary,
  onAddSentence,
  savedWords,
  savedSentences,
  onClose,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const { t, lang } = useI18n();

  const handleAddVocab = (sug: VocabularySuggestion) => {
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      word: sug.word,
      lemma: sug.word,
      meaningCn: sug.meaningCn,
      context: sug.context,
      sourceVideoId: videoId,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddVocabulary(item);
  };

  const handleAddSentence = (sug: SentenceSuggestion) => {
    const item: SentenceItem = {
      id: `sent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: sug.text,
      meaningCn: sug.meaningCn,
      sourceVideoId: videoId,
      startTime: 0,
      addedAt: Date.now(),
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddSentence(item);
  };

  return (
    <div className="mt-6 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 dark:from-indigo-950 to-white dark:to-slate-800">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
        >
          <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('ai.title')}</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-full font-medium">DeepSeek</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          title={t('ai.closePanel')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-6">
        {/* Summaries */}
        <div className={lang === 'zh' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}>
          <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('ai.summaryEn')}</h4>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{analysis.summaryEn}</p>
          </div>
          {lang === 'zh' && (
          <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('ai.summaryCn')}</h4>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{analysis.summaryCn}</p>
          </div>
          )}
        </div>

        {/* Note banner — shown when AI couldn't find enough qualifying words */}
        {analysis.note && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">{analysis.note}</p>
          </div>
        )}

        {/* Key Takeaways */}
        {analysis.keyTakeaways.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ai.takeaways')}</h4>
            <div className="space-y-2">
              {analysis.keyTakeaways.map((takeaway, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{takeaway}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vocabulary Suggestions */}
        {analysis.vocabularySuggestions.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ai.vocab')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {analysis.vocabularySuggestions.map((sug) => {
                const saved = savedWords.has(sug.word.toLowerCase());
                return (
                  <div key={sug.word} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-base font-semibold text-amber-800">{sug.word}</span>
                      {saved ? (
                        <span className="text-[10px] text-amber-600 font-medium">{t('ai.saved')}</span>
                      ) : (
                        <button
                          onClick={() => handleAddVocab(sug)}
                          className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors font-medium cursor-pointer"
                        >
                          {t('ai.add')}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">&ldquo;{sug.context}&rdquo;</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{sug.reason}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sentence Suggestions */}
        {analysis.sentenceSuggestions.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ai.sentences')}</h4>
            <div className="space-y-3">
              {analysis.sentenceSuggestions.map((sug) => {
                const saved = savedSentences.has(sug.text);
                return (
                  <div key={sug.text} className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-violet-800 leading-relaxed flex-1">{sug.text}</p>
                      {saved ? (
                        <span className="text-[10px] text-violet-600 font-medium whitespace-nowrap">{t('ai.saved')}</span>
                      ) : (
                        <button
                          onClick={() => handleAddSentence(sug)}
                          className="text-[10px] px-2 py-0.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 transition-colors font-medium cursor-pointer whitespace-nowrap"
                        >
                          {t('ai.add')}
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{sug.reason}</p>
                    {sug.grammarNotes && (
                      <div className="mt-2 pt-2 border-t border-violet-100 dark:border-slate-700">
                        <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                          <span className="font-semibold text-sky-600 dark:text-sky-400">{lang === 'zh' ? '解析: ' : 'Analysis: '}</span>
                          {sug.grammarNotes}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default AIAnalysisPanel;
