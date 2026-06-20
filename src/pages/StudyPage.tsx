import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import YouTubeEmbed, { type PlayerHandle } from '../components/YouTubeEmbed';
import TranscriptViewer from '../components/TranscriptViewer';
import TranscriptImporter from '../components/TranscriptImporter';
import AIAnalysisPanel from '../components/AIAnalysisPanel';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import { parseYouTubeId, parseStartTime } from '../utils/youtube';
import { parseTranscript } from '../utils/transcriptParser';
import { normalizeTranscriptToSentences } from '../utils/transcriptNormalizer';
import { analyzeTranscript } from '../services/aiAnalysis';
import { getVideoTitle } from '../services/youtubeApi';
import {
  loadVocabulary,
  addVocabularyItem,
  removeVocabularyItem,
  loadSentences,
  addSentenceItem,
  removeSentenceItem,
  loadCurrentSession,
  saveCurrentSession,
  clearCurrentSession,
} from '../utils/storage';
import type {
  TranscriptLine,
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
  AIAnalysisResult,
} from '../types';

const DEMO_TRANSCRIPT_TEXT = [
  "Welcome to this English learning session.",
  "Today we're going to practice listening and reading skills.",
  "Pay attention to the vocabulary and try to catch new words.",
  "Remember, the key to improvement is consistent practice.",
  "Don't hesitate to pause and review any sentence you find difficult.",
  "Let's begin with our first exercise and see how it goes.",
].join('\n');

type DisplayMode = 'sentence' | 'caption';

const StudyPage: React.FC = () => {
  // ── Session state ──────────────────────────────────────────
  const [session, setSession] = useState<VideoStudySession | null>(null);

  // Video state
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | undefined>(undefined);
  const [sessionTitle, setSessionTitle] = useState('');

  // Transcript state — raw caption blocks + sentence-level lines
  const [rawBlocks, setRawBlocks] = useState<TranscriptLine[]>([]);
  const [sentenceLines, setSentenceLines] = useState<TranscriptLine[]>([]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('sentence');

  // Saved data state (all items, filtered by current video for display)
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);

  // Tab state for the bottom panel
  const [activeTab, setActiveTab] = useState<'vocab' | 'sentences'>('vocab');

  // AI analysis state
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Ref to track if we've done the initial restore
  const restoredRef = useRef(false);

  // YouTube player ref & playback time
  const playerRef = useRef<PlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // The lines currently shown in TranscriptViewer (depends on display mode)
  const displayLines = displayMode === 'sentence' ? sentenceLines : rawBlocks;

  // ── Restore last session on mount ──────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadCurrentSession();
    if (saved) {
      setSession(saved);
      setVideoId(saved.youtubeId);
      setUrlInput(saved.youtubeUrl);
      setSessionTitle(saved.title);
      setStartTime(undefined); // Don't auto-jump on restore

      // If title looks like a URL, try fetching the real title
      if (saved.title.startsWith('http') || saved.title === saved.youtubeUrl) {
        getVideoTitle(saved.youtubeUrl).then((info) => {
          if (info?.title) setSessionTitle(info.title);
        });
      }

      // Migrate: use transcriptData if available, else treat legacy transcriptLines as rawBlocks
      if (saved.transcriptData) {
        setRawBlocks(saved.transcriptData.rawBlocks);
        setSentenceLines(saved.transcriptData.sentenceLines);
      } else if (saved.transcriptLines.length > 0) {
        const blocks = saved.transcriptLines;
        const sLines = normalizeTranscriptToSentences(blocks);
        setRawBlocks(blocks);
        setSentenceLines(sLines);
      }

      // Restore saved AI analysis
      if (saved.aiAnalysis) {
        setAnalysis(saved.aiAnalysis);
      }
    }

    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, []);

  // ── Poll current playback time every 500ms ─────────────────
  useEffect(() => {
    if (!videoId || !playerRef.current) return;
    const id = setInterval(() => {
      if (playerRef.current) {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 500);
    return () => clearInterval(id);
  }, [videoId]);

  // ── Compute which transcript line is currently active ──────
  const activeLineIndex = useMemo(() => {
    for (let i = 0; i < displayLines.length; i++) {
      if (currentTime >= displayLines[i].start && currentTime < displayLines[i].end) {
        return i;
      }
    }
    return -1;
  }, [currentTime, displayLines]);

  // ── Seek to a specific time in the video ───────────────────
  const handleSeekTo = useCallback((seconds: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds);
      playerRef.current.playVideo();
    }
  }, []);

  // ── Filtered data for current video ────────────────────────
  const filteredVocabulary = useMemo(
    () => (videoId ? vocabulary.filter((v) => v.sourceVideoId === videoId) : vocabulary),
    [vocabulary, videoId],
  );
  const filteredSentences = useMemo(
    () => (videoId ? sentences.filter((s) => s.sourceVideoId === videoId) : sentences),
    [sentences, videoId],
  );

  // Derived sets for quick lookup
  const savedWords = useMemo(
    () => new Set(filteredVocabulary.map((v) => v.word.toLowerCase())),
    [filteredVocabulary],
  );
  const savedSentencesSet = useMemo(
    () => new Set(filteredSentences.map((s) => s.text)),
    [filteredSentences],
  );

  // ── Persist session helper ─────────────────────────────────
  const persistSession = useCallback(
    (
      yId: string,
      yUrl: string,
      raw: TranscriptLine[],
      sLines: TranscriptLine[],
      title: string,
      status: VideoStudySession['status'] = 'studying',
    ) => {
      const now = Date.now();
      const updated: VideoStudySession = {
        id: session?.id || `session_${now}`,
        youtubeUrl: yUrl,
        youtubeId: yId,
        title,
        transcriptLines: raw, // legacy compat
        transcriptData: { rawBlocks: raw, sentenceLines: sLines },
        createdAt: session?.createdAt || now,
        updatedAt: now,
        status,
      };
      saveCurrentSession(updated);
      setSession(updated);
    },
    [session],
  );

  // ── Shared: import raw blocks → normalize → persist ────────
  const importTranscript = useCallback(
    (raw: TranscriptLine[]) => {
      const sLines = normalizeTranscriptToSentences(raw);
      setRawBlocks(raw);
      setSentenceLines(sLines);
      if (videoId) {
        persistSession(
          videoId,
          urlInput.trim() || sessionTitle || videoId,
          raw,
          sLines,
          sessionTitle || urlInput.trim() || videoId,
        );
      }
    },
    [videoId, urlInput, sessionTitle, persistSession],
  );

  // ── Load video ─────────────────────────────────────────────
  const handleLoadVideo = useCallback(() => {
    const id = parseYouTubeId(urlInput);
    if (!id) return;

    const st = parseStartTime(urlInput);
    setVideoId(id);
    setStartTime(st);

    // If no title yet, fetch from YouTube oEmbed (no API key needed)
    if (!sessionTitle) {
      setSessionTitle(urlInput.trim()); // temporary fallback
      getVideoTitle(urlInput).then((info) => {
        if (info?.title) {
          setSessionTitle(info.title);
        }
      });
    }

    // If transcript already loaded, save session immediately
    if (rawBlocks.length > 0) {
      persistSession(id, urlInput.trim(), rawBlocks, sentenceLines, sessionTitle || urlInput.trim());
    }
  }, [urlInput, rawBlocks, sentenceLines, sessionTitle, persistSession]);

  // ── Import transcript (from TranscriptImporter) ─────────────
  const handleImportTranscript = useCallback(
    (lines: TranscriptLine[]) => {
      importTranscript(lines);
    },
    [importTranscript],
  );

  // ── Use demo transcript ────────────────────────────────────
  const handleUseDemo = useCallback(() => {
    const parsed = parseTranscript(DEMO_TRANSCRIPT_TEXT);
    if (parsed.length > 0) {
      importTranscript(parsed);
    }
  }, [importTranscript]);

  // ── Clear current session ──────────────────────────────────
  const handleClearSession = useCallback(() => {
    clearCurrentSession();
    setSession(null);
    setVideoId(null);
    setStartTime(undefined);
    setUrlInput('');
    setSessionTitle('');
    setRawBlocks([]);
    setSentenceLines([]);
    setAnalysis(null);
  }, []);

  // ── Persist AI analysis to current session ─────────────────
  const persistAnalysis = useCallback(
    (result: AIAnalysisResult) => {
      if (!session) return;
      const updated: VideoStudySession = { ...session, aiAnalysis: result, updatedAt: Date.now() };
      saveCurrentSession(updated);
      setSession(updated);
    },
    [session],
  );

  // ── Analyze transcript ──────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    const textLines = displayMode === 'sentence' ? sentenceLines : rawBlocks;
    if (textLines.length === 0) return;
    const text = textLines.map((l) => l.text).join(' ');
    setAnalyzing(true);
    try {
      const result = await analyzeTranscript(text);
      setAnalysis(result);
      persistAnalysis(result);
    } catch {
      // silently ignore for mock
    } finally {
      setAnalyzing(false);
    }
  }, [displayMode, sentenceLines, rawBlocks, persistAnalysis]);

  // ── Vocab / sentence handlers ─────────────────────────────
  const handleAddVocabulary = useCallback((item: VocabularyItem) => {
    setVocabulary(addVocabularyItem(item));
  }, []);

  const handleAddSentence = useCallback((item: SentenceItem) => {
    setSentences(addSentenceItem(item));
  }, []);

  const handleRemoveVocabulary = useCallback((id: string) => {
    setVocabulary(removeVocabularyItem(id));
  }, []);

  const handleRemoveSentence = useCallback((id: string) => {
    setSentences(removeSentenceItem(id));
  }, []);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div>
      {/* Study toolbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Session title (editable when a session exists) */}
            {session && (
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                onBlur={() => {
                  if (videoId && rawBlocks.length > 0) {
                    persistSession(videoId, urlInput.trim(), rawBlocks, sentenceLines, sessionTitle);
                  }
                }}
                className="px-2 py-0.5 text-sm text-gray-600 border border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded transition-colors max-w-[240px]"
                placeholder="Session title..."
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
              placeholder="Paste YouTube URL here..."
              className="w-80 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            />
            <button
              onClick={handleLoadVideo}
              className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
            >
              Load Video
            </button>
            {session && (
              <button
                onClick={handleClearSession}
                className="px-4 py-1.5 text-sm bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium cursor-pointer"
              >
                Clear Session
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* Left: video */}
          <div className="w-[55%] flex-shrink-0">
            {videoId ? (
              <YouTubeEmbed ref={playerRef} youtubeId={videoId} startTime={startTime} />
            ) : (
              <div className="w-full aspect-video rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
                <div className="text-center">
                  <svg
                    className="mx-auto w-12 h-12 text-gray-300 mb-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-gray-400 text-sm">Paste a YouTube URL above to start</p>
                </div>
              </div>
            )}

            {/* Quick info */}
            {videoId && (
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                <span>Video ID: {videoId}</span>
                {startTime !== undefined && <span>Start: {startTime}s</span>}
                {session && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    session.status === 'studying'
                      ? 'bg-blue-100 text-blue-600'
                      : session.status === 'completed'
                        ? 'bg-green-100 text-green-600'
                        : 'bg-gray-100 text-gray-500'
                  }`}>
                    {session.status}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right: Transcript */}
          <div className="flex-1 min-h-[400px] max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                Transcript
              </h2>
              <div className="flex items-center gap-3">
                {/* Analyze button */}
                {displayLines.length > 0 && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzing ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        {analysis ? 'Re-analyze' : 'Analyze'}
                      </>
                    )}
                  </button>
                )}
                {/* Display mode toggle */}
                {sentenceLines.length > 0 && rawBlocks.length > 0 && (
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setDisplayMode('sentence')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        displayMode === 'sentence'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Sentence
                    </button>
                    <button
                      onClick={() => setDisplayMode('caption')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        displayMode === 'caption'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Caption
                    </button>
                  </div>
                )}
                {videoId && sentenceLines.length === 0 && rawBlocks.length === 0 && (
                  <button
                    onClick={handleUseDemo}
                    className="text-xs text-indigo-500 hover:text-indigo-700 cursor-pointer"
                  >
                    Use Demo
                  </button>
                )}
                <span className="text-xs text-gray-400">
                  {displayMode === 'sentence'
                    ? `${sentenceLines.length} sentences`
                    : `${rawBlocks.length} blocks`}
                </span>
              </div>
            </div>

            {displayLines.length > 0 ? (
              <TranscriptViewer
                lines={displayLines}
                videoId={videoId || 'unknown'}
                videoTitle={sessionTitle}
                onAddVocabulary={handleAddVocabulary}
                onAddSentence={handleAddSentence}
                savedWords={savedWords}
                savedSentences={savedSentencesSet}
                activeLineIndex={activeLineIndex}
                onSeekTo={handleSeekTo}
              />
            ) : videoId ? (
              <TranscriptImporter onImport={handleImportTranscript} />
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                <p>No video loaded yet.</p>
                <p className="mt-1">Load a YouTube video to get started.</p>
              </div>
            )}
          </div>
        </div>

        {/* AI Analysis Panel */}
        {analysis && (
          <AIAnalysisPanel
            analysis={analysis}
            videoId={videoId || 'unknown'}
            onAddVocabulary={handleAddVocabulary}
            onAddSentence={handleAddSentence}
            savedWords={savedWords}
            savedSentences={savedSentencesSet}
            onClose={() => setAnalysis(null)}
          />
        )}

        {/* Bottom: Saved items */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('vocab')}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'vocab'
                  ? 'text-amber-700 border-b-2 border-amber-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Vocabulary ({filteredVocabulary.length})
            </button>
            <button
              onClick={() => setActiveTab('sentences')}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'sentences'
                  ? 'text-violet-700 border-b-2 border-violet-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Key Sentences ({filteredSentences.length})
            </button>
          </div>

          {/* Tab content */}
          <div className="p-4 max-h-64 overflow-y-auto">
            {activeTab === 'vocab' && (
              <VocabularyList
                items={filteredVocabulary}
                onRemove={handleRemoveVocabulary}
              />
            )}
            {activeTab === 'sentences' && (
              <SentenceList
                items={filteredSentences}
                onRemove={handleRemoveSentence}
                onSeek={handleSeekTo}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

// ─── Vocabulary List Sub-component ──────────────────────────

interface DictPopupState {
  word: string;
  x: number;
  y: number;
}

const VocabularyList: React.FC<{
  items: VocabularyItem[];
  onRemove: (id: string) => void;
}> = ({ items, onRemove }) => {
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({ word, x: rect.left + rect.width / 2, y: rect.top });
  };

  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 text-sm py-6">
        Click any word in the transcript to add it to your vocabulary.
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
            className="bg-amber-50 border border-amber-200 rounded-lg p-3 group"
          >
            <div className="flex items-start justify-between">
              <span
                className="text-base font-semibold text-amber-800 cursor-pointer hover:text-amber-900 hover:underline"
                onClick={(e) => handleWordClick(item.word, e)}
                title="Click to look up in dictionary"
              >
                {item.word}
              </span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs cursor-pointer"
              >
                Remove
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">"{item.context}"</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-gray-400 truncate max-w-[120px]">
                {item.sourceVideoTitle || item.sourceVideoId}
              </span>
              <span className="text-[10px] text-gray-400">
                {new Date(item.addedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

// ─── Sentence List Sub-component ────────────────────────────

const SentenceList: React.FC<{
  items: SentenceItem[];
  onRemove: (id: string) => void;
  onSeek?: (seconds: number) => void;
}> = ({ items, onRemove, onSeek }) => {
  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 text-sm py-6">
        Click any sentence in the transcript to save it as a key sentence.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-violet-50 border border-violet-200 rounded-lg p-3 group"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-violet-800 leading-relaxed">{item.text}</p>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs whitespace-nowrap cursor-pointer"
            >
              Remove
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onSeek?.(item.startTime)}
              className="text-[10px] font-mono text-indigo-500 hover:text-indigo-700 hover:underline cursor-pointer"
              title="Jump to this point in the video"
            >
              @{formatTime(item.startTime)}
            </button>
            <span className="text-[10px] text-gray-400 truncate max-w-[120px]">
              {item.sourceVideoTitle || item.sourceVideoId}
            </span>
            <span className="text-[10px] text-gray-400">
              {new Date(item.addedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default StudyPage;
