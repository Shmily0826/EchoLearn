import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import {
  loadSentences,
  removeSentenceItem,
  updateSentenceItem,
  loadAllSessions,
} from '../utils/storage';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import { exportSentencesCSV, exportSentencesPDF } from '../services/exportService';
import { translateSentences } from '../services/translationService';
import type { SentenceItem, VideoStudySession } from '../types';

interface DictPopupState {
  word: string;
  x: number;
  y: number;
}

/** Split a sentence into word and punctuation tokens for rendering. */
function splitTokens(text: string): string[] {
  return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
}

/** Format a nextReviewAt timestamp as a short label. */
function reviewLabel(nextReviewAt: number, mastered: boolean, t: (key: string, vars?: Record<string, string | number>) => string): { text: string; color: string } {
  if (mastered) return { text: t('reviewLabel.mastered'), color: 'text-green-600' };
  if (nextReviewAt === 0) return { text: t('reviewLabel.mastered'), color: 'text-green-600' };
  const now = Date.now();
  if (nextReviewAt <= now) return { text: t('reviewLabel.dueNow'), color: 'text-red-500' };
  const days = Math.ceil((nextReviewAt - now) / (24 * 60 * 60 * 1000));
  if (days === 1) return { text: t('reviewLabel.dueTomorrow'), color: 'text-amber-500' };
  if (days <= 7) return { text: t('reviewLabel.dueIn', { n: days }), color: 'text-amber-500' };
  return { text: t('reviewLabel.dueIn', { n: days }), color: 'text-gray-400' };
}

const SentencesPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [sessions, setSessions] = useState<VideoStudySession[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingMeaningId, setEditingMeaningId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    setSentences(loadSentences());
    setSessions(loadAllSessions());
  }, []);

  // Build videoId -> title map
  const titleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      map.set(s.youtubeId, s.title || s.youtubeUrl);
    }
    return map;
  }, [sessions]);

  const getVideoTitle = (item: SentenceItem) =>
    item.sourceVideoTitle || titleMap.get(item.sourceVideoId) || item.sourceVideoId;

  const handleRemove = useCallback((id: string) => {
    if (!window.confirm(t('sent.deleteConfirm'))) return;
    setSentences(removeSentenceItem(id));
  }, [t]);

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({
      word,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  // ── myOwnSentence editing ──────────────────────────────────
  const handleStartEditOwn = (item: SentenceItem) => {
    setEditingId(item.id);
    setEditText(item.myOwnSentence);
  };

  const handleSaveOwn = useCallback(
    (id: string) => {
      setSentences(updateSentenceItem(id, { myOwnSentence: editText }));
      setEditingId(null);
      setEditText('');
    },
    [editText],
  );

  const handleCancelOwn = () => {
    setEditingId(null);
    setEditText('');
  };

  // ── meaningCn editing ──────────────────────────────────────
  const handleStartEditMeaning = (item: SentenceItem) => {
    setEditingMeaningId(item.id);
    setEditMeaning(item.meaningCn);
  };

  const handleSaveMeaning = useCallback(
    (id: string) => {
      setSentences(updateSentenceItem(id, { meaningCn: editMeaning }));
      setEditingMeaningId(null);
      setEditMeaning('');
    },
    [editMeaning],
  );

  const handleCancelMeaning = () => {
    setEditingMeaningId(null);
    setEditMeaning('');
  };

  const handleBackfillTranslations = useCallback(async () => {
    const empty = sentences.filter((s) => !s.meaningCn);
    if (empty.length === 0) return;
    setBackfilling(true);
    try {
      const translations = await translateSentences(
        empty.map((s) => ({ id: s.id, text: s.text })),
      );
      let updated = [...sentences];
      for (const [id, meaningCn] of Object.entries(translations)) {
        updated = updateSentenceItem(id, { meaningCn });
      }
      setSentences(updated);
    } finally {
      setBackfilling(false);
    }
  }, [sentences]);

  // Search
  const filtered = sentences.filter(
    (s) =>
      !search ||
      s.text.toLowerCase().includes(search.toLowerCase()) ||
      s.meaningCn.toLowerCase().includes(search.toLowerCase()),
  );

  const dueCount = useMemo(() => {
    const now = Date.now();
    return sentences.filter((s) => !s.mastered && s.nextReviewAt <= now).length;
  }, [sentences]);

  const masteredCount = useMemo(() => {
    return sentences.filter((s) => s.mastered).length;
  }, [sentences]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Dictionary popup */}
      {dictPopup && (
        <WordDictionaryPopup
          word={dictPopup.word}
          x={dictPopup.x}
          y={dictPopup.y}
          onClose={() => setDictPopup(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{t('sent.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {`${sentences.length} ${t('sent.sentences')}`} &middot; {`${masteredCount} ${t('sent.mastered')}`}
            {dueCount > 0 && <span className="text-amber-500"> &middot; {`${dueCount} ${t('sent.due')}`}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sent.searchPh')}
            className="w-full sm:w-52 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent dark:bg-slate-800 dark:text-gray-200"
          />
          <button
            onClick={() => navigate('/review')}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
          >
            {t('sent.review')}{dueCount > 0 ? ` (${dueCount})` : ''}
          </button>
          {/* Backfill translations */}
          {sentences.some((s) => !s.meaningCn) && (
            <button
              onClick={handleBackfillTranslations}
              disabled={backfilling}
              className="px-3 py-1.5 text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors font-medium cursor-pointer disabled:opacity-60"
            >
              {backfilling ? t('sent.translating') : t('sent.autoTranslate')}
            </button>
          )}
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExport(!showExport)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
            >
              {t('sent.export')}
            </button>
            {showExport && sentences.length > 0 && (
              <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { exportSentencesCSV(filtered); setShowExport(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  {t('sent.exportCSV')}
                </button>
                <button
                  onClick={() => { exportSentencesPDF(filtered); setShowExport(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  {t('sent.exportPDF')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-10 text-center">
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            {sentences.length === 0
              ? t('sent.noSentences')
              : t('sent.noMatch')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 group hover:shadow-sm transition-shadow"
            >
              {/* Original sentence — words are clickable */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed flex-1">
                  {splitTokens(item.text).map((token, i) => {
                    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                    if (/^[^\w']+$/.test(token))
                      return (
                        <span key={i} className="text-gray-400">{token}</span>
                      );
                    return (
                      <span
                        key={i}
                        onClick={(e) => handleWordClick(token, e)}
                        className="inline-block mx-[1px] px-0.5 rounded cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                      >
                        {token}
                      </span>
                    );
                  })}
                </p>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-xs cursor-pointer"
                >
                  {t('sent.delete')}
                </button>
              </div>

              {/* Chinese meaning — editable */}
              {editingMeaningId === item.id ? (
                <div className="flex gap-1.5 mb-3">
                  <input
                    type="text"
                    value={editMeaning}
                    onChange={(e) => setEditMeaning(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveMeaning(item.id);
                      if (e.key === 'Escape') handleCancelMeaning();
                    }}
                    autoFocus
                    placeholder={t('sent.editTransPh')}
                    className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => handleSaveMeaning(item.id)}
                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer"
                  >
                    {t('sent.save')}
                  </button>
                </div>
              ) : (
                <p
                  className="text-sm text-gray-500 dark:text-gray-400 mb-3 cursor-pointer hover:text-indigo-600 transition-colors"
                  onClick={() => handleStartEditMeaning(item)}
                  title="Click to edit translation"
                >
                  {item.meaningCn || (
                    <span className="text-gray-400 italic text-xs">
                      {t('sent.clickAddTrans')}
                    </span>
                  )}
                </p>
              )}

              {/* My own sentence — editable */}
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 mb-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  {t('sent.myOwn')}
                </p>
                {editingId === item.id ? (
                  <div className="flex gap-1.5">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveOwn(item.id);
                        }
                        if (e.key === 'Escape') handleCancelOwn();
                      }}
                      autoFocus
                      rows={2}
                      placeholder={t('sent.writePh')}
                      className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                    />
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleSaveOwn(item.id)}
                        className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer"
                      >
                        {t('sent.save')}
                      </button>
                      <button
                        onClick={handleCancelOwn}
                        className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                      >
                        {t('sent.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:text-indigo-600 transition-colors min-h-[20px]"
                    onClick={() => handleStartEditOwn(item)}
                    title="Click to write your own sentence"
                  >
                    {item.myOwnSentence || (
                      <span className="text-gray-400 italic text-xs">
                        {t('sent.clickWrite')}
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className="shrink-0 text-[10px] font-mono text-gray-400">
                    @{formatTime(item.startTime)}
                  </span>
                  <span className="text-[10px] font-mono text-gray-400 truncate max-w-[120px] sm:max-w-[200px]" title={getVideoTitle(item)}>
                    {getVideoTitle(item)}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400 hidden sm:inline">
                    {new Date(item.addedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-[10px] font-medium whitespace-nowrap ${reviewLabel(item.nextReviewAt, item.mastered, t).color}`}>
                    {reviewLabel(item.nextReviewAt, item.mastered, t).text}
                  </span>
                  {!item.mastered && (
                    <span className="text-[9px] text-gray-400 whitespace-nowrap">{item.reviewCount}/5</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default SentencesPage;
