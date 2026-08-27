import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { pushItemsToCloud } from '../services/firestoreSync';
import {
  loadVocabulary,
  removeVocabularyItem,
  updateVocabularyItem,
  addVocabularyItem,
  loadAllSessions,
} from '../utils/storage';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import { exportVocabularyCSV, exportVocabularyPDF } from '../services/exportService';
import { translateWords, translateWord } from '../services/translationService';
import { enrichVocabularyItem, isMissingEnglishDefinition } from '../services/vocabularyEnrichment';
import { isLocalNoTranslation } from '../services/aiAnalysis';
import { jumpToSource, formatTimestamp, youtubeUrlAt } from '../utils/jumpToSource';
import { extractSentence } from '../utils/sentence';
import type { VocabularyItem, VideoStudySession } from '../types';

type FilterMode = 'all' | 'mastered' | 'unmastered';
type SortMode = 'newest' | 'az' | 'review' | 'most-reviewed';
type ViewMode = 'card' | 'list';

function nowMs(): number {
  return Date.now();
}

interface DictPopupState {
  word: string;
  context?: string;
  x: number;
  y: number;
  /** True when opened from the dictionary-search card (not a saved word) — shows an "Add to vocabulary" action. */
  fromLookup?: boolean;
}

/** Format a nextReviewAt timestamp as a short label. */
function reviewLabel(nextReviewAt: number, mastered: boolean, t: (key: string, vars?: Record<string, string | number>) => string): { text: string; color: string } {
  if (mastered) return { text: t('reviewLabel.mastered'), color: 'text-green-600 dark:text-green-400' };
  if (nextReviewAt === 0) return { text: t('reviewLabel.mastered'), color: 'text-green-600 dark:text-green-400' };
  const now = Date.now();
  if (nextReviewAt <= now) return { text: t('reviewLabel.dueNow'), color: 'text-red-500 dark:text-red-400' };
  const days = Math.ceil((nextReviewAt - now) / (24 * 60 * 60 * 1000));
  if (days === 1) return { text: t('reviewLabel.dueTomorrow'), color: 'text-amber-500' };
  if (days <= 7) return { text: t('reviewLabel.dueIn', { n: days }), color: 'text-amber-500' };
  return { text: t('reviewLabel.dueIn', { n: days }), color: 'text-gray-400' };
}

/**
 * Return a short example for a vocab card. New items already store a single
 * sentence in `context`; this also trims legacy items whose `context` is still a
 * long caption line. Prefers the dictionary `example` when available.
 */
function getCompactExample(item: VocabularyItem): string {
  if (item.example) return item.example;
  return extractSentence(item.context, item.word);
}

const VocabularyPage: React.FC = () => {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCloudSync = useCallback(() => {
    if (!user?.uid) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushItemsToCloud(user.uid).catch(() => { /* silent */ });
    }, 2000);
  }, [user]);

  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>(loadVocabulary);
  const [sessions] = useState<VideoStudySession[]>(loadAllSessions);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);
  const [dictCurrentWord, setDictCurrentWord] = useState('');
  const [expandedContextIds, setExpandedContextIds] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingDefinitions, setBackfillingDefinitions] = useState(false);
  const [backfillDefinitionsError, setBackfillDefinitionsError] = useState<string | null>(null);

  // Listen for cross-page data changes (e.g., StudyPage saving a word)
  useEffect(() => {
    const handler = () => setVocabulary(loadVocabulary());
    window.addEventListener('echolearn:vocab-changed', handler);
    return () => window.removeEventListener('echolearn:vocab-changed', handler);
  }, []);

  // Build videoId -> title map
  const titleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      map.set(s.youtubeId, s.title || s.youtubeUrl);
    }
    return map;
  }, [sessions]);

  const getVideoTitle = (item: VocabularyItem) =>
    item.sourceVideoTitle || titleMap.get(item.sourceVideoId) || item.sourceVideoId;

  /**
   * Jump back to the exact moment in the video where this word was saved.
   * Falls back to YouTube when the study session has since been deleted.
   */
  const handleJumpToSource = useCallback(
    (item: VocabularyItem) => {
      if (!item.sourceVideoId) return;
      const { ok } = jumpToSource(item.sourceVideoId, item.sourceTimestamp, navigate);
      if (!ok) {
        window.open(youtubeUrlAt(item.sourceVideoId, item.sourceTimestamp), '_blank', 'noopener');
      }
    },
    [navigate],
  );

  const handleRemove = useCallback((id: string) => {
    if (!window.confirm(t('vocab.deleteConfirm'))) return;
    setVocabulary(removeVocabularyItem(id));
    triggerCloudSync();
  }, [t, triggerCloudSync]);

  const handleToggleMastered = useCallback((item: VocabularyItem) => {
    setVocabulary(updateVocabularyItem(item.id, { mastered: !item.mastered }));
    triggerCloudSync();
  }, [triggerCloudSync]);

  const handleStartEdit = (item: VocabularyItem) => {
    setEditingId(item.id);
    setEditMeaning(item.meaningCn);
  };

  const handleSaveMeaning = useCallback((id: string) => {
    setVocabulary(updateVocabularyItem(id, { meaningCn: editMeaning }));
    setEditingId(null);
    setEditMeaning('');
    triggerCloudSync();
  }, [editMeaning, triggerCloudSync]);

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditMeaning('');
  };

  const handleBackfillTranslations = useCallback(async () => {
    const empty = vocabulary.filter((v) => isLocalNoTranslation(v.meaningCn));
    if (empty.length === 0) return;
    setBackfilling(true);
    try {
      const translations = await translateWords(
        empty.map((v) => ({ id: v.id, word: v.word, context: v.context })),
      );
      let updated = [...vocabulary];
      for (const [id, meaningCn] of Object.entries(translations)) {
        updated = updateVocabularyItem(id, { meaningCn });
      }
      setVocabulary(updated);
      triggerCloudSync();
    } finally {
      setBackfilling(false);
    }
  }, [vocabulary]);

  const handleBackfillDefinitions = useCallback(async () => {
    const missing = vocabulary.filter((item) => isMissingEnglishDefinition(item.definitionEn));
    if (missing.length === 0) return;
    setBackfillingDefinitions(true);
    setBackfillDefinitionsError(null);
    const failedWords: string[] = [];
    try {
      // Process in small batches so a large legacy library cannot overwhelm
      // the dictionary service or the browser's request queue.
      for (let index = 0; index < missing.length; index += 4) {
        const batch = missing.slice(index, index + 4);
        const results = await Promise.all(batch.map(async (item) => {
          try {
            return { id: item.id, word: item.word, patch: await enrichVocabularyItem(item) };
          } catch (error) {
            console.warn(`[vocabulary] English enrichment failed for "${item.word}"`, error);
            return { id: item.id, word: item.word, patch: {} };
          }
        }));
        let updated = loadVocabulary();
        for (const { id, word, patch } of results) {
          if (Object.keys(patch).length > 0) updated = updateVocabularyItem(id, patch);
          if (isMissingEnglishDefinition(patch.definitionEn)) failedWords.push(word);
        }
        setVocabulary(updated);
      }
      if (failedWords.length > 0) {
        const uniqueFailedWords = [...new Set(failedWords)];
        setBackfillDefinitionsError(
          uniqueFailedWords.length === missing.length
            ? 'English definitions could not be loaded. Check the local API connection and try again.'
            : `Some English definitions could not be loaded: ${uniqueFailedWords.slice(0, 4).join(', ')}${uniqueFailedWords.length > 4 ? '…' : ''}`,
        );
      }
      triggerCloudSync();
    } finally {
      setBackfillingDefinitions(false);
    }
  }, [vocabulary, triggerCloudSync]);

  const handleWordClick = (word: string, context: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({
      word,
      context,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  /** Open the dictionary popup for an arbitrary (not-yet-saved) word — the "look up in dictionary" search card. */
  const handleLookupInDictionary = (term: string, rect?: DOMRect) => {
    const w = term.trim();
    if (!w) return;
    setDictCurrentWord(w);
    setDictPopup({
      word: w,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top : 120,
      fromLookup: true,
    });
  };

  /** Save the word currently shown in the dictionary popup (used by the search-card "Add to vocabulary" action). */
  const handleDictAddWord = useCallback((word: string) => {
    const w = word.trim();
    if (!w) return;
    const alreadySaved = vocabulary.some(
      (v) => v.word.toLowerCase() === w.toLowerCase() && v.sourceVideoId === '',
    );
    if (alreadySaved) {
      setDictPopup(null);
      return;
    }
    const newId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const item: VocabularyItem = {
      id: newId,
      word: w,
      meaningCn: '',
      context: '',
      sourceVideoId: '',
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: 0,
    };
    setVocabulary(addVocabularyItem(item));
    triggerCloudSync();
    setDictPopup(null);
    // Use the same enrichment path as transcript and AI saves so manually
    // searched words also receive an English definition.
    void enrichVocabularyItem(item).then((patch) => {
      if (Object.keys(patch).length === 0) return;
      setVocabulary(updateVocabularyItem(newId, patch));
      triggerCloudSync();
    });
  }, [vocabulary, triggerCloudSync]);

  /** Re-translate a single item whose meaning is empty or the local-no-translation placeholder. */
  const handleTranslateOne = useCallback((item: VocabularyItem) => {
    if (!isLocalNoTranslation(item.meaningCn)) return;
    translateWord(item.word, item.context).then((meaningCn) => {
      if (meaningCn) {
        setVocabulary(updateVocabularyItem(item.id, { meaningCn }));
        triggerCloudSync();
      }
    }).catch(() => { /* silent */ });
  }, [triggerCloudSync]);

  /** Toggle the expand/collapse state of a card's example sentence. */
  const toggleContextExpand = useCallback((id: string) => {
    setExpandedContextIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Search + filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let items = vocabulary.filter((v) => {
      const matchesSearch =
        !q ||
        v.word.toLowerCase().includes(q) ||
        v.context.toLowerCase().includes(q) ||
        // English mode: search the visible English definition; Chinese mode: the Chinese meaning.
        (lang === 'en'
          ? (v.definitionEn?.toLowerCase().includes(q) ?? false)
          : v.meaningCn.toLowerCase().includes(q));
      const matchesFilter =
        filter === 'all'
          ? true
          : filter === 'mastered'
            ? v.mastered
            : !v.mastered;
      return matchesSearch && matchesFilter;
    });

    switch (sort) {
      case 'newest':
        items = [...items].sort((a, b) => b.addedAt - a.addedAt);
        break;
      case 'az':
        items = [...items].sort((a, b) => a.word.localeCompare(b.word));
        break;
      case 'review':
        items = [...items].sort((a, b) => {
          if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
          return a.nextReviewAt - b.nextReviewAt;
        });
        break;
      case 'most-reviewed':
        items = [...items].sort((a, b) => b.reviewCount - a.reviewCount);
        break;
    }
    return items;
  }, [vocabulary, search, filter, sort, lang]);

  const masteredCount = vocabulary.filter((v) => v.mastered).length;
  const dueCount = useMemo(() => {
    const now = nowMs();
    return vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= now).length;
  }, [vocabulary]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Dictionary popup */}
      {dictPopup && (
        <WordDictionaryPopup
          word={dictPopup.word}
          x={dictPopup.x}
          y={dictPopup.y}
          onClose={() => setDictPopup(null)}
          onWordChange={setDictCurrentWord}
          actions={
            dictPopup.fromLookup ? (
              <button
                onClick={() => handleDictAddWord(dictCurrentWord || dictPopup.word)}
                className="mt-3 w-full px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
              >
                {t('study.addToVocab')}
              </button>
            ) : undefined
          }
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{t('vocab.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {`${vocabulary.length} ${t('vocab.words')}`} &middot; {`${masteredCount} ${t('vocab.mastered')}`}
            {dueCount > 0 && <span className="text-amber-500"> &middot; {`${dueCount} ${t('vocab.due')}`}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('vocab.searchPh')}
            className="w-full sm:w-52 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent dark:bg-slate-800 dark:text-gray-200"
          />
          <button
            onClick={() => navigate('/review')}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
          >
            {t('vocab.review')}{dueCount > 0 ? ` (${dueCount})` : ''}
          </button>
          {/* Backfill translations */}
          {vocabulary.some((v) => isLocalNoTranslation(v.meaningCn)) && (
            <button
              onClick={handleBackfillTranslations}
              disabled={backfilling}
              className="px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors font-medium cursor-pointer disabled:opacity-60"
            >
              {backfilling ? t('vocab.translating') : t('vocab.autoTranslate')}
            </button>
          )}
          {vocabulary.some((v) => isMissingEnglishDefinition(v.definitionEn)) && (
            <button
              onClick={handleBackfillDefinitions}
              disabled={backfillingDefinitions}
              className="px-3 py-1.5 text-sm text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors font-medium cursor-pointer disabled:opacity-60"
            >
              {backfillingDefinitions ? t('vocab.loadingDefinitions') : t('vocab.fillEnglishDefs')}
            </button>
          )}
          {backfillDefinitionsError && (
            <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">
              {backfillDefinitionsError}
            </p>
          )}
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExport(!showExport)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
            >
              {t('vocab.export')}
            </button>
            {showExport && vocabulary.length > 0 && (
              <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { exportVocabularyCSV(filtered, lang); setShowExport(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  {t('vocab.exportCSV')}
                </button>
                <button
                  onClick={() => { exportVocabularyPDF(filtered, lang); setShowExport(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  {t('vocab.exportPDF')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter tabs + sort */}
      <div className="flex flex-col items-stretch gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {(['all', 'unmastered', 'mastered'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                filter === f
                  ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-slate-900'
              }`}
            >
              {f === 'all' ? t('vocab.all') : f === 'mastered' ? t('vocab.mastered') : t('vocab.unmastered')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer dark:bg-slate-800"
          >
            <option value="newest">{t('vocab.newest')}</option>
            <option value="az">{t('vocab.az')}</option>
            <option value="review">{t('vocab.reviewSoonest')}</option>
            <option value="most-reviewed">{t('vocab.mostReviewed')}</option>
          </select>
          <button
            onClick={() => setViewMode(viewMode === 'card' ? 'list' : 'card')}
            className="text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors cursor-pointer flex items-center gap-1"
            title={viewMode === 'card' ? t('vocab.listView') : t('vocab.cardView')}
          >
            {viewMode === 'card' ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v1.5a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v1.5A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            )}
            <span className="hidden sm:inline">{viewMode === 'card' ? t('vocab.listView') : t('vocab.cardView')}</span>
          </button>
        </div>
      </div>

      {/* Dictionary-search card: look up any word not yet saved */}
      {(() => {
        const term = search.trim();
        const exactSaved = term !== '' && vocabulary.some((v) => v.word.toLowerCase() === term.toLowerCase());
        if (!term || exactSaved) return null;
        return (
          <div className="mb-5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 min-w-0">
              {t('vocab.lookupHint', { term })}
            </p>
            <button
              onClick={(e) => handleLookupInDictionary(term, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              className="shrink-0 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
            >
              {t('vocab.lookupBtn')}
            </button>
          </div>
        );
      })()}

      {/* Cards / List */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-10 text-center">
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            {vocabulary.length === 0
              ? t('vocab.noWords')
              : t('vocab.noMatch')}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`bg-white dark:bg-slate-800 border rounded-xl p-4 group hover:shadow-sm transition-shadow overflow-hidden ${
                item.mastered ? 'border-green-200' : 'border-gray-200 dark:border-slate-700'
              }`}
            >
              {/* Top row: word + phonetic + mastered badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    onClick={(e) => handleWordClick(item.word, item.context, e)}
                    className="text-lg font-semibold text-gray-800 dark:text-gray-200 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                    title="Click to look up in dictionary"
                  >
                    {item.word}
                  </span>
                  {item.phonetic && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{item.phonetic}</span>
                  )}
                  {item.audioUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        new Audio(item.audioUrl).play().catch(() => {});
                      }}
                      title="Play pronunciation"
                      className="p-1.5 md:p-0.5 text-indigo-400 hover:text-indigo-600 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                        <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                      </svg>
                    </button>
                  )}
                  {item.mastered && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 rounded">
                      {t('vocab.masteredBadge')}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-xs cursor-pointer"
                >
                  {t('vocab.delete')}
                </button>
              </div>

              {/* Part of speech tag (dictionary data) */}
              {item.partOfSpeech && (
                <span className="inline-block text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-500 rounded-full font-medium mb-1.5">
                  {item.partOfSpeech}
                </span>
              )}

              {/* English dictionary definition: shown as a faint hint ABOVE the meaning in
                  Chinese mode (preserving the original layout), and as the primary meaning in
                  English mode. */}
              {lang === 'zh' && item.definitionEn && (
                <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed mb-2 line-clamp-2">
                  {item.definitionEn}
                </p>
              )}

              {/* Meaning block — language aware.
                  English mode: show the English dictionary definition (definitionEn), never the
                  Chinese meaningCn (DESIGN RULE: English UI must not show Chinese).
                  Chinese mode: keep the full experience (meaningCn + inline edit). */}
              {lang === 'en' ? (
                item.definitionEn ? (
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
                    {item.definitionEn}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic mb-2">{t('vocab.noEnglishDef')}</p>
                )
              ) : editingId === item.id ? (
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={editMeaning}
                    onChange={(e) => setEditMeaning(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveMeaning(item.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    onBlur={() => handleSaveMeaning(item.id)}
                    autoFocus
                    placeholder={t('vocab.editMeaningPh')}
                    className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => handleSaveMeaning(item.id)}
                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer"
                  >
                    {t('vocab.save')}
                  </button>
                </div>
              ) : isLocalNoTranslation(item.meaningCn) ? (
                <p
                  className="text-sm text-indigo-500 dark:text-indigo-400 mb-2 cursor-pointer hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors italic"
                  onClick={() => handleTranslateOne(item)}
                  title="Click to translate"
                >
                  {item.meaningCn ? t('vocab.translateRetry') : t('vocab.clickAdd')}
                </p>
              ) : (
                <p
                  className="text-sm text-indigo-700 dark:text-indigo-300 font-medium mb-2 cursor-pointer hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors"
                  onClick={() => handleStartEdit(item)}
                  title="Click to edit meaning"
                >
                  {item.meaningCn}
                </p>
              )}

              {/* Example sentence — prefer a short dictionary example or the single
                  sentence containing the word; keep it to 2 lines by default with an
                  expand toggle to reveal the full original context. */}
              <div>
                {(() => {
                  const compact = getCompactExample(item);
                  const full = item.fullContext || item.context;
                  const isExpanded = expandedContextIds.has(item.id);
                  const displayText = isExpanded ? full : compact;
                  const needsToggle = !!item.fullContext && item.fullContext !== item.context && item.fullContext.length > 90;
                  return (
                    <>
                      <p
                        className={`text-sm text-gray-600 dark:text-gray-400 leading-relaxed ${
                          isExpanded ? '' : 'line-clamp-2'
                        }`}
                      >
                        &ldquo;{displayText}&rdquo;
                      </p>
                      {needsToggle && (
                        <button
                          onClick={() => toggleContextExpand(item.id)}
                          className="mt-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer transition-colors"
                        >
                          {isExpanded ? t('wordCard.collapse') : t('wordCard.expand')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Footer: source + date + toggle */}
              <div className="mt-3 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {item.sourceVideoId ? (
                    <button
                      type="button"
                      onClick={() => handleJumpToSource(item)}
                      title={`${getVideoTitle(item)}${
                        item.sourceTimestamp !== undefined ? ` @ ${formatTimestamp(item.sourceTimestamp)}` : ''
                      }`}
                      className="group flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 truncate flex-1 min-w-0 cursor-pointer transition-colors"
                    >
                      <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M6.3 4.2a1 1 0 011.02.05l7 4.5a1 1 0 010 1.7l-7 4.5A1 1 0 015.8 14.1V5.5a1 1 0 01.5-.87z" />
                      </svg>
                      <span className="truncate group-hover:underline">{getVideoTitle(item)}</span>
                      {item.sourceTimestamp !== undefined && (
                        <span className="shrink-0 font-mono opacity-80">
                          {formatTimestamp(item.sourceTimestamp)}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-400 truncate flex-1 min-w-0">
                      {getVideoTitle(item)}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {new Date(item.addedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-medium whitespace-nowrap ${reviewLabel(item.nextReviewAt, item.mastered, t).color}`}>
                    {reviewLabel(item.nextReviewAt, item.mastered, t).text}
                  </span>
                  <button
                    onClick={() => handleToggleMastered(item)}
                    className={`text-[10px] font-medium cursor-pointer transition-colors shrink-0 ${
                      item.mastered
                        ? 'text-green-600 dark:text-green-400 hover:text-green-700'
                        : 'text-gray-400 hover:text-indigo-600'
                    }`}
                  >
                    {item.mastered ? t('vocab.unmark') : t('vocab.markMastered')}
                  </button>
                </div>
              </div>

              {/* Review progress bar */}
              {!item.mastered && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="flex-1 h-1 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 rounded-full transition-all"
                      style={{ width: `${Math.min(item.reviewCount / 5 * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400">{item.reviewCount}/5</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ── List view ── */
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full table-fixed text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-700 text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-gray-400 dark:text-gray-500 w-[22%]">{t('vocab.title')}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-400 dark:text-gray-500 hidden sm:table-cell w-[18%]">{t('vocab.searchPh')}</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-400 dark:text-gray-500 hidden md:table-cell w-[24%]">Context</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-400 dark:text-gray-500 hidden lg:table-cell w-[22%]">Source</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-400 dark:text-gray-500 text-right whitespace-nowrap w-[14%]">Review</th>
                <th className="px-2 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const rl = reviewLabel(item.nextReviewAt, item.mastered, t);
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-gray-50 dark:border-slate-700/50 last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors ${
                      item.mastered ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          onClick={(e) => handleWordClick(item.word, item.context, e)}
                          className="font-semibold text-gray-800 dark:text-gray-200 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                          title="Look up in dictionary"
                        >
                          {item.word}
                        </span>
                        {item.phonetic && (
                          <span className="text-xs text-gray-400 font-mono shrink-0">{item.phonetic}</span>
                        )}
                        {item.audioUrl && (
                          <button
                            onClick={(e) => { e.stopPropagation(); new Audio(item.audioUrl).play().catch(() => {}); }}
                            className="shrink-0 p-0.5 text-indigo-400 hover:text-indigo-600 cursor-pointer"
                          >
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                              <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                            </svg>
                          </button>
                        )}
                        {item.mastered && (
                          <span className="shrink-0 px-1 py-0.5 text-[9px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 rounded">
                            {t('vocab.masteredBadge')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      {lang === 'en' ? (
                        item.definitionEn ? (
                          <span className="text-gray-700 dark:text-gray-300 line-clamp-1" title={item.definitionEn}>
                            {item.definitionEn}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic text-xs">{t('vocab.noEnglishDef')}</span>
                        )
                      ) : editingId === item.id ? (
                        <input
                          type="text"
                          value={editMeaning}
                          onChange={(e) => setEditMeaning(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMeaning(item.id); if (e.key === 'Escape') handleCancelEdit(); }}
                          onBlur={() => handleSaveMeaning(item.id)}
                          autoFocus
                          className="w-full max-w-[160px] px-2 py-0.5 text-xs border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      ) : isLocalNoTranslation(item.meaningCn) ? (
                        <span
                          className="text-indigo-500 dark:text-indigo-400 cursor-pointer hover:text-indigo-700 italic line-clamp-1"
                          onClick={() => handleTranslateOne(item)}
                          title="Click to translate"
                        >
                          {item.meaningCn ? t('vocab.translateRetry') : t('vocab.clickAdd')}
                        </span>
                      ) : (
                        <span
                          className="text-indigo-700 dark:text-indigo-300 font-medium cursor-pointer hover:text-indigo-800 dark:hover:text-indigo-200 line-clamp-1"
                          onClick={() => handleStartEdit(item)}
                          title="Click to edit"
                        >
                          {item.meaningCn}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {(() => {
                        const ctx = item.fullContext || extractSentence(item.context, item.word);
                        return (
                          <span className="text-gray-500 dark:text-gray-400 line-clamp-2" title={ctx}>
                            &ldquo;{ctx}&rdquo;
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      {item.sourceVideoId ? (
                        <button
                          type="button"
                          onClick={() => handleJumpToSource(item)}
                          title={`${getVideoTitle(item)}${
                            item.sourceTimestamp !== undefined ? ` @ ${formatTimestamp(item.sourceTimestamp)}` : ''
                          }`}
                          className="group flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 max-w-full cursor-pointer transition-colors"
                        >
                          <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M6.3 4.2a1 1 0 011.02.05l7 4.5a1 1 0 010 1.7l-7 4.5A1 1 0 015.8 14.1V5.5a1 1 0 01.5-.87z" />
                          </svg>
                          <span className="truncate group-hover:underline">{getVideoTitle(item)}</span>
                          {item.sourceTimestamp !== undefined && (
                            <span className="shrink-0 font-mono opacity-80">
                              {formatTimestamp(item.sourceTimestamp)}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400 truncate block" title={getVideoTitle(item)}>
                          {getVideoTitle(item)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`text-[11px] font-medium ${rl.color}`}>{rl.text}</span>
                        {!item.mastered && (
                          <span className="text-[9px] text-gray-400">{item.reviewCount}/5</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => handleRemove(item.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors cursor-pointer"
                        title={t('vocab.delete')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.577 5.969c-.318-.892-.512-1.828-.577-2.777M5.964 4.91c.067-.455.186-.902.35-1.332M5.964 4.91a8.236 8.236 0 001.33 0m-1.33 0L5.97 3.396A2.25 2.25 0 018.184 1.5h7.632a2.25 2.25 0 012.214 1.896l.27 1.514" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VocabularyPage;
