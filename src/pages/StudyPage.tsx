import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import YouTubeEmbed, { type PlayerHandle } from '../components/YouTubeEmbed';
import TranscriptViewer from '../components/TranscriptViewer';
import { parseYouTubeId, parseStartTime } from '../utils/youtube';
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
import type { TranscriptLine, VocabularyItem, SentenceItem, VideoStudySession } from '../types';

const DEMO_TRANSCRIPT: TranscriptLine[] = [
  { start: 0, end: 5, text: "Welcome to this English learning session." },
  { start: 5, end: 12, text: "Today we're going to practice listening and reading skills." },
  { start: 12, end: 20, text: "Pay attention to the vocabulary and try to catch new words." },
  { start: 20, end: 28, text: "Remember, the key to improvement is consistent practice." },
  { start: 28, end: 36, text: "Don't hesitate to pause and review any sentence you find difficult." },
  { start: 36, end: 44, text: "Let's begin with our first exercise and see how it goes." },
];

const StudyPage: React.FC = () => {
  // ── Session state ──────────────────────────────────────────
  const [session, setSession] = useState<VideoStudySession | null>(null);

  // Video state
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | undefined>(undefined);
  const [sessionTitle, setSessionTitle] = useState('');

  // Transcript state
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [showPastePanel, setShowPastePanel] = useState(false);

  // Saved data state (all items, filtered by current video for display)
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);

  // Tab state for the bottom panel
  const [activeTab, setActiveTab] = useState<'vocab' | 'sentences'>('vocab');

  // Ref to track if we've done the initial restore
  const restoredRef = useRef(false);

  // YouTube player ref & playback time
  const playerRef = useRef<PlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // ── Restore last session on mount ──────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadCurrentSession();
    if (saved) {
      setSession(saved);
      setVideoId(saved.youtubeId);
      setUrlInput(saved.youtubeUrl);
      setTranscriptLines(saved.transcriptLines);
      setSessionTitle(saved.title);
      setStartTime(undefined); // Don't auto-jump on restore
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
    for (let i = 0; i < transcriptLines.length; i++) {
      if (currentTime >= transcriptLines[i].start && currentTime < transcriptLines[i].end) {
        return i;
      }
    }
    return -1;
  }, [currentTime, transcriptLines]);

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
      lines: TranscriptLine[],
      title: string,
      status: VideoStudySession['status'] = 'studying',
    ) => {
      const now = Date.now();
      const updated: VideoStudySession = {
        id: session?.id || `session_${now}`,
        youtubeUrl: yUrl,
        youtubeId: yId,
        title,
        transcriptLines: lines,
        createdAt: session?.createdAt || now,
        updatedAt: now,
        status,
      };
      saveCurrentSession(updated);
      setSession(updated);
    },
    [session],
  );

  // ── Load video ─────────────────────────────────────────────
  const handleLoadVideo = useCallback(() => {
    const id = parseYouTubeId(urlInput);
    if (!id) return;

    const st = parseStartTime(urlInput);
    setVideoId(id);
    setStartTime(st);

    // If no title yet, use the URL as default
    if (!sessionTitle) {
      setSessionTitle(urlInput.trim());
    }

    // If transcript already loaded, save session immediately
    if (transcriptLines.length > 0) {
      persistSession(id, urlInput.trim(), transcriptLines, sessionTitle || urlInput.trim());
    }
  }, [urlInput, transcriptLines, sessionTitle, persistSession]);

  // ── Parse pasted transcript ────────────────────────────────
  const handleParseTranscript = useCallback(() => {
    const rawLines = transcriptText.trim().split('\n').filter((l) => l.trim());
    const parsed: TranscriptLine[] = [];

    rawLines.forEach((line, idx) => {
      const timeMatch = line.match(/^(\d+):(\d+)\s+(.*)/);
      if (timeMatch) {
        const minutes = parseInt(timeMatch[1], 10);
        const seconds = parseInt(timeMatch[2], 10);
        const start = minutes * 60 + seconds;
        const text = timeMatch[3].trim();
        parsed.push({ start, end: start + 5, text });
      } else {
        parsed.push({ start: idx * 5, end: (idx + 1) * 5, text: line.trim() });
      }
    });

    setTranscriptLines(parsed);
    setShowPastePanel(false);

    // Auto-save session if video is loaded
    if (videoId) {
      persistSession(
        videoId,
        urlInput.trim(),
        parsed,
        sessionTitle || urlInput.trim(),
      );
    }
  }, [transcriptText, videoId, urlInput, sessionTitle, persistSession]);

  // ── Load demo transcript ───────────────────────────────────
  const handleUseDemo = useCallback(() => {
    setTranscriptLines(DEMO_TRANSCRIPT);
    setShowPastePanel(false);

    if (videoId) {
      persistSession(
        videoId,
        urlInput.trim(),
        DEMO_TRANSCRIPT,
        sessionTitle || urlInput.trim(),
      );
    }
  }, [videoId, urlInput, sessionTitle, persistSession]);

  // ── Clear current session ──────────────────────────────────
  const handleClearSession = useCallback(() => {
    clearCurrentSession();
    setSession(null);
    setVideoId(null);
    setStartTime(undefined);
    setUrlInput('');
    setSessionTitle('');
    setTranscriptLines([]);
    setTranscriptText('');
  }, []);

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
                  if (videoId && transcriptLines.length > 0) {
                    persistSession(videoId, urlInput.trim(), transcriptLines, sessionTitle);
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
            <button
              onClick={() => setShowPastePanel(!showPastePanel)}
              className="px-4 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer"
            >
              {showPastePanel ? 'Hide' : 'Paste'} Transcript
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

      {/* Transcript paste panel */}
      {showPastePanel && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <p className="text-sm text-gray-500 mb-2">
              Paste your transcript below. Each line can be{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">MM:SS sentence text</code>{' '}
              or just plain text (auto-timestamped).
            </p>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              placeholder={`0:00 Welcome to this English learning session.\n0:05 Today we're going to practice listening and reading skills.\n...`}
              className="w-full h-36 px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleParseTranscript}
                className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
              >
                Apply Transcript
              </button>
              <button
                onClick={handleUseDemo}
                className="px-4 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer"
              >
                Use Demo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* Left: Video */}
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
              <span className="text-xs text-gray-400">
                {transcriptLines.length} lines
              </span>
            </div>

            {transcriptLines.length > 0 ? (
              <TranscriptViewer
                lines={transcriptLines}
                videoId={videoId || 'unknown'}
                onAddVocabulary={handleAddVocabulary}
                onAddSentence={handleAddSentence}
                savedWords={savedWords}
                savedSentences={savedSentencesSet}
                activeLineIndex={activeLineIndex}
                onSeekTo={handleSeekTo}
              />
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                <p>No transcript loaded yet.</p>
                <p className="mt-1">Click "Paste Transcript" to add one.</p>
              </div>
            )}
          </div>
        </div>

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
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

// ─── Vocabulary List Sub-component ──────────────────────────

const VocabularyList: React.FC<{
  items: VocabularyItem[];
  onRemove: (id: string) => void;
}> = ({ items, onRemove }) => {
  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 text-sm py-6">
        Click any word in the transcript to add it to your vocabulary.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-amber-50 border border-amber-200 rounded-lg p-3 group"
        >
          <div className="flex items-start justify-between">
            <span className="text-base font-semibold text-amber-800">
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
          <p className="text-[10px] text-gray-400 mt-1.5">
            {new Date(item.addedAt).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  );
};

// ─── Sentence List Sub-component ────────────────────────────

const SentenceList: React.FC<{
  items: SentenceItem[];
  onRemove: (id: string) => void;
}> = ({ items, onRemove }) => {
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
            <span className="text-[10px] font-mono text-gray-400">
              @{formatTime(item.startTime)}
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
