import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  loadSentences,
  removeSentenceItem,
  updateSentenceItem,
  loadAllSessions,
} from '../utils/storage';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
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

const SentencesPage: React.FC = () => {
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [sessions, setSessions] = useState<VideoStudySession[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingMeaningId, setEditingMeaningId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);

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
    setSentences(removeSentenceItem(id));
  }, []);

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

  // Search
  const filtered = sentences.filter(
    (s) =>
      !search ||
      s.text.toLowerCase().includes(search.toLowerCase()) ||
      s.meaningCn.toLowerCase().includes(search.toLowerCase()),
  );

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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Sentence Bank</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sentences.length} sentences saved
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sentence / meaning..."
          className="w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
        />
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">
            {sentences.length === 0
              ? 'No sentences saved yet. Click any sentence in a transcript to save it.'
              : 'No matching sentences.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-xl p-5 group hover:shadow-sm transition-shadow"
            >
              {/* Original sentence — words are clickable */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm text-gray-800 leading-relaxed flex-1">
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
                  className="shrink-0 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs cursor-pointer"
                >
                  Delete
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
                    placeholder="输入中文翻译..."
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
                  className="text-sm text-gray-500 mb-3 cursor-pointer hover:text-indigo-600 transition-colors"
                  onClick={() => handleStartEditMeaning(item)}
                  title="Click to edit translation"
                >
                  {item.meaningCn || (
                    <span className="text-gray-400 italic text-xs">
                      Click to add Chinese translation...
                    </span>
                  )}
                </p>
              )}

              {/* My own sentence — editable */}
              <div className="bg-slate-50 rounded-lg px-3 py-2 mb-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  My Own Sentence
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
                      placeholder="Write your own sentence using the same pattern..."
                      className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                    />
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleSaveOwn(item.id)}
                        className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelOwn}
                        className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors min-h-[20px]"
                    onClick={() => handleStartEditOwn(item)}
                    title="Click to write your own sentence"
                  >
                    {item.myOwnSentence || (
                      <span className="text-gray-400 italic text-xs">
                        Click to write your own sentence...
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-gray-400">
                  @{formatTime(item.startTime)}
                </span>
                <span className="text-[10px] font-mono text-gray-400 truncate max-w-[200px]" title={getVideoTitle(item)}>
                  {getVideoTitle(item)}
                </span>
                <span className="text-[10px] text-gray-400">
                  {new Date(item.addedAt).toLocaleDateString()}
                </span>
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
