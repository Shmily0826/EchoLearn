import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  loadVocabulary,
  removeVocabularyItem,
  updateVocabularyItem,
  loadAllSessions,
} from '../utils/storage';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import type { VocabularyItem, VideoStudySession } from '../types';

type FilterMode = 'all' | 'mastered' | 'unmastered';
type SortMode = 'newest' | 'az' | 'review' | 'most-reviewed';

interface DictPopupState {
  word: string;
  x: number;
  y: number;
}

/** Format a nextReviewAt timestamp as a short label. */
function reviewLabel(nextReviewAt: number, mastered: boolean): { text: string; color: string } {
  if (mastered) return { text: 'Mastered', color: 'text-green-600' };
  if (nextReviewAt === 0) return { text: 'Mastered', color: 'text-green-600' };
  const now = Date.now();
  if (nextReviewAt <= now) return { text: 'Due now', color: 'text-red-500' };
  const days = Math.ceil((nextReviewAt - now) / (24 * 60 * 60 * 1000));
  if (days === 1) return { text: 'Due tomorrow', color: 'text-amber-500' };
  if (days <= 7) return { text: `Due in ${days}d`, color: 'text-amber-500' };
  return { text: `Due in ${days}d`, color: 'text-gray-400' };
}

const VocabularyPage: React.FC = () => {
  const navigate = useNavigate();
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sessions, setSessions] = useState<VideoStudySession[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('newest');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);

  useEffect(() => {
    setVocabulary(loadVocabulary());
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

  const getVideoTitle = (item: VocabularyItem) =>
    item.sourceVideoTitle || titleMap.get(item.sourceVideoId) || item.sourceVideoId;

  const handleRemove = useCallback((id: string) => {
    setVocabulary(removeVocabularyItem(id));
  }, []);

  const handleToggleMastered = useCallback((item: VocabularyItem) => {
    setVocabulary(updateVocabularyItem(item.id, { mastered: !item.mastered }));
  }, []);

  const handleStartEdit = (item: VocabularyItem) => {
    setEditingId(item.id);
    setEditMeaning(item.meaningCn);
  };

  const handleSaveMeaning = useCallback((id: string) => {
    setVocabulary(updateVocabularyItem(id, { meaningCn: editMeaning }));
    setEditingId(null);
    setEditMeaning('');
  }, [editMeaning]);

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditMeaning('');
  };

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({
      word,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  // Search + filter + sort
  const filtered = useMemo(() => {
    let items = vocabulary.filter((v) => {
      const matchesSearch =
        !search ||
        v.word.toLowerCase().includes(search.toLowerCase()) ||
        v.context.toLowerCase().includes(search.toLowerCase()) ||
        v.meaningCn.toLowerCase().includes(search.toLowerCase());
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
  }, [vocabulary, search, filter, sort]);

  const masteredCount = vocabulary.filter((v) => v.mastered).length;
  const dueCount = useMemo(() => {
    const now = Date.now();
    return vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= now).length;
  }, [vocabulary]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
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
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Vocabulary</h1>
          <p className="text-sm text-gray-500 mt-1">
            {vocabulary.length} words &middot; {masteredCount} mastered
            {dueCount > 0 && <span className="text-amber-500"> &middot; {dueCount} due</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search word / meaning..."
            className="w-52 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          />
          <button
            onClick={() => navigate('/review')}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
          >
            Review{dueCount > 0 ? ` (${dueCount})` : ''}
          </button>
        </div>
      </div>

      {/* Filter tabs + sort */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          {(['all', 'unmastered', 'mastered'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                filter === f
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {f === 'all' ? 'All' : f === 'mastered' ? 'Mastered' : 'Unmastered'}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
        >
          <option value="newest">Newest first</option>
          <option value="az">A - Z</option>
          <option value="review">Review soonest</option>
          <option value="most-reviewed">Most reviewed</option>
        </select>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">
            {vocabulary.length === 0
              ? 'No words saved yet. Click any word in a transcript to add it.'
              : 'No matching words.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`bg-white border rounded-xl p-4 group hover:shadow-sm transition-shadow overflow-hidden ${
                item.mastered ? 'border-green-200' : 'border-gray-200'
              }`}
            >
              {/* Top row: word + phonetic + mastered badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    onClick={(e) => handleWordClick(item.word, e)}
                    className="text-lg font-semibold text-gray-800 truncate cursor-pointer hover:text-indigo-600 transition-colors"
                    title="Click to look up in dictionary"
                  >
                    {item.word}
                  </span>
                  {item.phonetic && (
                    <span className="text-xs text-gray-400 font-mono">{item.phonetic}</span>
                  )}
                  {item.audioUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        new Audio(item.audioUrl).play().catch(() => {});
                      }}
                      title="Play pronunciation"
                      className="p-0.5 text-indigo-400 hover:text-indigo-600 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                        <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                      </svg>
                    </button>
                  )}
                  {item.mastered && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded">
                      mastered
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="shrink-0 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs cursor-pointer"
                >
                  Delete
                </button>
              </div>

              {/* Part of speech + definition (if available from dictionary) */}
              {item.partOfSpeech && (
                <span className="inline-block text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded-full font-medium mb-1.5">
                  {item.partOfSpeech}
                </span>
              )}
              {item.definitionEn && (
                <p className="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-2">
                  {item.definitionEn}
                </p>
              )}

              {/* Chinese meaning — editable */}
              {editingId === item.id ? (
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={editMeaning}
                    onChange={(e) => setEditMeaning(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveMeaning(item.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    autoFocus
                    placeholder="输入中文释义..."
                    className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => handleSaveMeaning(item.id)}
                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <p
                  className="text-sm text-gray-500 mb-2 cursor-pointer hover:text-indigo-600 transition-colors"
                  onClick={() => handleStartEdit(item)}
                  title="Click to edit meaning"
                >
                  {item.meaningCn || (
                    <span className="text-gray-400 italic text-xs">
                      Click to add meaning...
                    </span>
                  )}
                </p>
              )}

              {/* Example sentence */}
              <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">
                &ldquo;{item.context}&rdquo;
              </p>

              {/* Footer: source + date + toggle */}
              <div className="mt-3 pt-2 border-t border-gray-100 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-gray-400 truncate flex-1 min-w-0" title={getVideoTitle(item)}>
                    {getVideoTitle(item)}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {new Date(item.addedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-medium ${reviewLabel(item.nextReviewAt, item.mastered).color}`}>
                    {reviewLabel(item.nextReviewAt, item.mastered).text}
                  </span>
                  <button
                    onClick={() => handleToggleMastered(item)}
                    className={`text-[10px] font-medium cursor-pointer transition-colors ${
                      item.mastered
                        ? 'text-green-600 hover:text-green-700'
                        : 'text-gray-400 hover:text-indigo-600'
                    }`}
                  >
                    {item.mastered ? 'Unmark' : 'Mark mastered'}
                  </button>
                </div>
              </div>

              {/* Review progress bar */}
              {!item.mastered && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
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
      )}
    </div>
  );
};

export default VocabularyPage;
