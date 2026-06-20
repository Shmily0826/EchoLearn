import { useEffect, useState, useCallback } from 'react';
import {
  loadVocabulary,
  removeVocabularyItem,
  updateVocabularyItem,
} from '../utils/storage';
import type { VocabularyItem } from '../types';

type FilterMode = 'all' | 'mastered' | 'unmastered';

const VocabularyPage: React.FC = () => {
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');

  useEffect(() => {
    setVocabulary(loadVocabulary());
  }, []);

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

  // Search + filter
  const filtered = vocabulary.filter((v) => {
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

  const masteredCount = vocabulary.filter((v) => v.mastered).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Vocabulary</h1>
          <p className="text-sm text-gray-500 mt-1">
            {vocabulary.length} words &middot; {masteredCount} mastered
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search word / meaning..."
          className="w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6">
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
              className={`bg-white border rounded-xl p-4 group hover:shadow-sm transition-shadow ${
                item.mastered ? 'border-green-200' : 'border-gray-200'
              }`}
            >
              {/* Top row: word + mastered badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg font-semibold text-gray-800 truncate">
                    {item.word}
                  </span>
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
                "{item.context}"
              </p>

              {/* Footer: source + date + toggle */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-400">
                    {item.sourceVideoId}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(item.addedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => handleToggleMastered(item)}
                  className={`text-xs font-medium cursor-pointer transition-colors ${
                    item.mastered
                      ? 'text-green-600 hover:text-green-700'
                      : 'text-gray-400 hover:text-indigo-600'
                  }`}
                >
                  {item.mastered ? 'Unmark' : 'Mark mastered'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VocabularyPage;
