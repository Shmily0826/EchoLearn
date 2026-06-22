import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import YouTubeEmbed, { type PlayerHandle } from '../components/YouTubeEmbed';
import TranscriptViewer from '../components/TranscriptViewer';
import TranscriptImporter from '../components/TranscriptImporter';
import AIAnalysisPanel from '../components/AIAnalysisPanel';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import { parseYouTubeId, parseStartTime } from '../utils/youtube';
import { normalizeTranscriptToSentences } from '../utils/transcriptNormalizer';
import { analyzeTranscript } from '../services/aiAnalysis';
import { fetchYouTubeTranscript } from '../services/youtubeTranscript';
import { translateWord, translateSentence } from '../services/translationService';
import { CEFR_LEVELS, type CEFRLevel } from '../services/cefrWordList';
import { getVideoTitle } from '../services/youtubeApi';
import {
  loadVocabulary,
  addVocabularyItem,
  removeVocabularyItem,
  updateVocabularyItem,
  loadSentences,
  addSentenceItem,
  removeSentenceItem,
  updateSentenceItem,
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

  // Mobile tab state for switching between Video / Transcript / Saved
  const [mobileTab, setMobileTab] = useState<'video' | 'transcript' | 'saved'>('video');

  // AI analysis state
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // CEFR level range for vocabulary extraction
  const [cefrMin, setCefrMin] = useState<CEFRLevel>(
    () => (localStorage.getItem('echolearn_cefr_min') as CEFRLevel) || 'B1',
  );
  const [cefrMax, setCefrMax] = useState<CEFRLevel>(
    () => (localStorage.getItem('echolearn_cefr_max') as CEFRLevel) || 'C2',
  );

  // AI analysis output counts
  const [vocabCount, setVocabCount] = useState(
    () => Number(localStorage.getItem('echolearn_vocab_count')) || 8,
  );
  const [sentenceCount, setSentenceCount] = useState(
    () => Number(localStorage.getItem('echolearn_sentence_count')) || 4,
  );

  // Streaming progress
  const [streamChars, setStreamChars] = useState(0);

  // Auto-fetch status
  const [fetchingCaption, setFetchingCaption] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);

  // Ref to track if we've done the initial restore
  const restoredRef = useRef(false);
  // Track which session ID we've loaded, so we can detect new sessions from Dashboard
  const loadedSessionIdRef = useRef<string | null>(null);
  const { pathname } = useLocation();

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
      loadedSessionIdRef.current = saved.id;
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

      // Auto-fetch captions if no transcript exists for this video
      const hasTranscript =
        !!saved.transcriptData || saved.transcriptLines.length > 0;
      if (saved.youtubeId && !hasTranscript) {
        setFetchingCaption(true);
        setCaptionError(null);
        fetchYouTubeTranscript(saved.youtubeId)
          .then(({ lines }) => {
            if (lines.length > 0) {
              const sLines = normalizeTranscriptToSentences(lines);
              setRawBlocks(lines);
              setSentenceLines(sLines);
              const updated: VideoStudySession = {
                ...saved,
                transcriptLines: lines,
                transcriptData: { rawBlocks: lines, sentenceLines: sLines },
                updatedAt: Date.now(),
              };
              saveCurrentSession(updated);
              setSession(updated);
            }
          })
          .catch((err) => {
            setCaptionError(
              err instanceof Error ? err.message : 'Unknown error fetching captions',
            );
          })
          .finally(() => setFetchingCaption(false));
      }
    }

    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, []);

  // ── Detect new session from Dashboard navigation ──────────
  // Because all pages are always mounted (display:none), the initial
  // useEffect only runs once. When the user clicks a video in Dashboard,
  // it saves a new session to localStorage and navigates to /study.
  // We detect this by watching pathname and comparing session IDs.
  useEffect(() => {
    if (pathname !== '/study') return;

    const saved = loadCurrentSession();
    if (!saved) return;

    // If this is the same session we already loaded, skip
    if (saved.id === loadedSessionIdRef.current) return;

    // New session detected — reload everything
    loadedSessionIdRef.current = saved.id;
    setSession(saved);
    setVideoId(saved.youtubeId);
    setUrlInput(saved.youtubeUrl);
    setSessionTitle(saved.title);
    setStartTime(undefined);
    setAnalysis(null);
    setStreamChars(0);
    setCaptionError(null);

    if (saved.title.startsWith('http') || saved.title === saved.youtubeUrl) {
      getVideoTitle(saved.youtubeUrl).then((info) => {
        if (info?.title) setSessionTitle(info.title);
      });
    }

    if (saved.transcriptData) {
      setRawBlocks(saved.transcriptData.rawBlocks);
      setSentenceLines(saved.transcriptData.sentenceLines);
    } else if (saved.transcriptLines.length > 0) {
      const blocks = saved.transcriptLines;
      const sLines = normalizeTranscriptToSentences(blocks);
      setRawBlocks(blocks);
      setSentenceLines(sLines);
    } else {
      // No transcript — clear and auto-fetch
      setRawBlocks([]);
      setSentenceLines([]);
    }

    if (saved.aiAnalysis) {
      setAnalysis(saved.aiAnalysis);
    }

    // Auto-fetch captions if no transcript exists
    const hasTranscript =
      !!saved.transcriptData || saved.transcriptLines.length > 0;
    if (saved.youtubeId && !hasTranscript) {
      setFetchingCaption(true);
      setCaptionError(null);
      fetchYouTubeTranscript(saved.youtubeId)
        .then(({ lines }) => {
          if (lines.length > 0) {
            const sLines = normalizeTranscriptToSentences(lines);
            setRawBlocks(lines);
            setSentenceLines(sLines);
            const updated: VideoStudySession = {
              ...saved,
              transcriptLines: lines,
              transcriptData: { rawBlocks: lines, sentenceLines: sLines },
              updatedAt: Date.now(),
            };
            saveCurrentSession(updated);
            setSession(updated);
          }
        })
        .catch((err) => {
          setCaptionError(
            err instanceof Error ? err.message : 'Unknown error fetching captions',
          );
        })
        .finally(() => setFetchingCaption(false));
    }

    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, [pathname]);

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
      return;
    }

    // Auto-fetch captions from YouTube
    setFetchingCaption(true);
    setCaptionError(null);
    fetchYouTubeTranscript(id)
      .then(({ lines }) => {
        if (lines.length > 0) {
          importTranscript(lines);
        }
      })
      .catch((err) => {
        setCaptionError(
          err instanceof Error ? err.message : 'Unknown error fetching captions',
        );
      })
      .finally(() => setFetchingCaption(false));
  }, [urlInput, rawBlocks, sentenceLines, sessionTitle, persistSession, importTranscript]);

  // ── Import transcript (from TranscriptImporter) ─────────────
  const handleImportTranscript = useCallback(
    (lines: TranscriptLine[]) => {
      importTranscript(lines);
    },
    [importTranscript],
  );

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
    setCaptionError(null);
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

    // Persist preferences
    localStorage.setItem('echolearn_cefr_min', cefrMin);
    localStorage.setItem('echolearn_cefr_max', cefrMax);
    localStorage.setItem('echolearn_vocab_count', String(vocabCount));
    localStorage.setItem('echolearn_sentence_count', String(sentenceCount));

    setAnalyzing(true);
    setStreamChars(0);
    try {
      const result = await analyzeTranscript(
        text,
        cefrMin,
        cefrMax,
        vocabCount,
        sentenceCount,
        (chunk) => setStreamChars((prev) => prev + chunk.length),
      );
      setAnalysis(result);
      persistAnalysis(result);
    } catch {
      // silently ignore
    } finally {
      setAnalyzing(false);
      setStreamChars(0);
    }
  }, [displayMode, sentenceLines, rawBlocks, cefrMin, cefrMax, vocabCount, sentenceCount, persistAnalysis]);

  // ── Vocab / sentence handlers ─────────────────────────────
  const handleAddVocabulary = useCallback((item: VocabularyItem) => {
    setVocabulary(addVocabularyItem(item));
    // Auto-translate meaningCn if empty
    if (!item.meaningCn) {
      translateWord(item.word, item.context).then((meaningCn) => {
        if (meaningCn) {
          setVocabulary(updateVocabularyItem(item.id, { meaningCn }));
        }
      }).catch(() => { /* silent */ });
    }
  }, []);

  const handleAddSentence = useCallback((item: SentenceItem) => {
    setSentences(addSentenceItem(item));
    // Auto-translate meaningCn if empty
    if (!item.meaningCn) {
      translateSentence(item.text).then((meaningCn) => {
        if (meaningCn) {
          setSentences(updateSentenceItem(item.id, { meaningCn }));
        }
      }).catch(() => { /* silent */ });
    }
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
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
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
                className="px-2 py-0.5 text-sm text-gray-600 dark:text-gray-400 border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-400 focus:outline-none rounded transition-colors w-full sm:w-[420px] dark:bg-slate-800"
                placeholder="Session title..."
              />
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
              placeholder="Paste YouTube URL here..."
              className="flex-1 sm:w-80 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent dark:bg-slate-800 dark:text-gray-200 min-w-0"
            />
            <button
              onClick={handleLoadVideo}
              className="px-3 sm:px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer whitespace-nowrap"
            >
              Load Video
            </button>
            {session && (
              <button
                onClick={handleClearSession}
                className="px-3 sm:px-4 py-1.5 text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors font-medium cursor-pointer whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Mobile tab switcher — only visible on small screens */}
        <div className="lg:hidden flex mb-3 bg-gray-100 dark:bg-slate-700 rounded-xl p-1 gap-1">
          {(['video', 'transcript', 'saved'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                mobileTab === tab
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {tab === 'video' ? 'Video' : tab === 'transcript' ? 'Transcript' : `Saved (${filteredVocabulary.length + filteredSentences.length})`}
            </button>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Left: video — always visible on desktop, conditional on mobile */}
          <div className={`w-full lg:w-[55%] flex-shrink-0 ${mobileTab === 'video' ? '' : 'hidden lg:block'}`}>
            {videoId ? (
              <YouTubeEmbed ref={playerRef} youtubeId={videoId} startTime={startTime} />
            ) : (
              <div className="w-full aspect-video rounded-xl bg-gray-100 dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center">
                <div className="text-center">
                  <svg
                    className="mx-auto w-12 h-12 text-gray-300 dark:text-gray-500 mb-3"
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
                  <p className="text-gray-400 dark:text-gray-500 text-sm">Paste a YouTube URL above to start</p>
                </div>
              </div>
            )}

            {/* Quick info */}
            {videoId && (
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span>Video ID: {videoId}</span>
                {startTime !== undefined && <span>Start: {startTime}s</span>}
                {session && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    session.status === 'studying'
                      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      : session.status === 'completed'
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                  }`}>
                    {session.status}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right: Transcript — always visible on desktop, conditional on mobile */}
          <div className={`flex-1 flex flex-col min-w-0 h-[50vh] lg:h-[calc(100vh-160px)] ${mobileTab === 'transcript' ? '' : 'hidden lg:flex'}`}>
            {/* Toolbar — fixed, never scrolls */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0 flex-wrap gap-1.5 sm:gap-2">
              <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Transcript
              </h2>
              <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
                {/* Caption fetch status */}
                {fetchingCaption && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500">
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Fetching captions...
                  </span>
                )}
                {/* Count selectors + CEFR + Analyze (only when transcript loaded) */}
                {displayLines.length > 0 && (
                  <>
                    {/* Vocab / Sentence count */}
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-gray-400 dark:text-gray-500">Words:</span>
                      <select
                        value={vocabCount}
                        onChange={(e) => setVocabCount(Number(e.target.value))}
                        className="px-1 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
                      >
                        {[4, 6, 8, 10, 12, 15, 20].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span className="text-gray-300 dark:text-gray-500 ml-1">Sents:</span>
                      <select
                        value={sentenceCount}
                        onChange={(e) => setSentenceCount(Number(e.target.value))}
                        className="px-1 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
                      >
                        {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    {/* CEFR level range selector */}
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-gray-400 dark:text-gray-500 mr-0.5">Level:</span>
                      <select
                        value={cefrMin}
                        onChange={(e) => {
                          const v = e.target.value as CEFRLevel;
                          setCefrMin(v);
                          if (CEFR_LEVELS.indexOf(v) > CEFR_LEVELS.indexOf(cefrMax)) {
                            setCefrMax(v);
                          }
                        }}
                        className="px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
                      >
                        {CEFR_LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                      <span className="text-gray-300 dark:text-gray-500">–</span>
                      <select
                        value={cefrMax}
                        onChange={(e) => {
                          const v = e.target.value as CEFRLevel;
                          setCefrMax(v);
                          if (CEFR_LEVELS.indexOf(v) < CEFR_LEVELS.indexOf(cefrMin)) {
                            setCefrMin(v);
                          }
                        }}
                        className="px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
                      >
                        {CEFR_LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {/* Analyze button */}
                {displayLines.length > 0 && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzing ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {streamChars > 0 ? `${streamChars} chars` : 'Analyzing...'}
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
                  <div className="flex items-center bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5">
                    <button
                      onClick={() => setDisplayMode('sentence')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        displayMode === 'sentence'
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      Sentence
                    </button>
                    <button
                      onClick={() => setDisplayMode('caption')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        displayMode === 'caption'
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      Caption
                    </button>
                  </div>
                )}
                {videoId && sentenceLines.length === 0 && rawBlocks.length === 0 && (
                  <span />
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {displayMode === 'sentence'
                    ? `${sentenceLines.length} sentences`
                    : `${rawBlocks.length} blocks`}
                </span>
              </div>
            </div>

            {/* Scrollable content area — single scroll, no nesting */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
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
            ) : fetchingCaption ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <svg className="animate-spin w-8 h-8 mb-3 text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm">Fetching captions from YouTube...</p>
                <p className="text-xs mt-1 text-gray-300 dark:text-gray-500">This may take a few seconds</p>
              </div>
            ) : captionError ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-5 max-w-md text-center">
                  <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">Caption auto-fetch failed</p>
                  <p className="text-xs text-red-500/70 dark:text-red-400/60 mb-3 whitespace-pre-line">{captionError}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">You can paste or upload the transcript manually below.</p>
                </div>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => {
                      if (videoId) {
                        setCaptionError(null);
                        setFetchingCaption(true);
                        fetchYouTubeTranscript(videoId)
                          .then(({ lines }) => {
                            if (lines.length > 0) {
                              const sLines = normalizeTranscriptToSentences(lines);
                              setRawBlocks(lines);
                              setSentenceLines(sLines);
                              if (session) {
                                const updated = { ...session, transcriptLines: lines, transcriptData: undefined };
                                saveCurrentSession(updated);
                                setSession(updated);
                              }
                            }
                          })
                          .catch((err) => {
                            setCaptionError(err instanceof Error ? err.message : 'Unknown error');
                          })
                          .finally(() => setFetchingCaption(false));
                      }
                    }}
                    className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer"
                  >
                    Retry
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => setCaptionError(null)}
                    className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer"
                  >
                    Dismiss & use manual import
                  </button>
                </div>
              </div>
            ) : videoId ? (
              <TranscriptImporter onImport={handleImportTranscript} />
            ) : (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                <p>No video loaded yet.</p>
                <p className="mt-1">Load a YouTube video to get started.</p>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* AI Analysis Panel — show on transcript tab (mobile) or always (desktop) */}
        {analysis && (
          <div className={`${mobileTab === 'transcript' ? '' : 'hidden lg:block'}`}>
            <AIAnalysisPanel
              analysis={analysis}
              videoId={videoId || 'unknown'}
              onAddVocabulary={handleAddVocabulary}
              onAddSentence={handleAddSentence}
              savedWords={savedWords}
              savedSentences={savedSentencesSet}
              onClose={() => setAnalysis(null)}
            />
          </div>
        )}

        {/* Bottom: Saved items — show on saved tab (mobile) or always (desktop) */}
        <div className={`mt-8 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm ${mobileTab === 'saved' ? '' : 'hidden lg:block'}`}>
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-slate-700">
            <button
              onClick={() => setActiveTab('vocab')}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'vocab'
                  ? 'text-amber-700 dark:text-amber-400 border-b-2 border-amber-500'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              Vocabulary ({filteredVocabulary.length})
            </button>
            <button
              onClick={() => setActiveTab('sentences')}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'sentences'
                  ? 'text-violet-700 dark:text-violet-400 border-b-2 border-violet-500'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
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
            className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 group"
          >
            <div className="flex items-start justify-between">
              <span
                className="text-base font-semibold text-amber-800 dark:text-amber-300 cursor-pointer hover:text-amber-900 dark:hover:text-amber-200 hover:underline"
                onClick={(e) => handleWordClick(item.word, e)}
                title="Click to look up in dictionary"
              >
                {item.word}
              </span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-xs cursor-pointer"
              >
                Remove
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">"{item.context}"</p>
            <div className="flex items-center gap-2 mt-1.5">
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
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
        Click any sentence in the transcript to save it as a key sentence.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-3 group"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-violet-800 dark:text-violet-300 leading-relaxed">{item.text}</p>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 dark:text-gray-500 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-xs whitespace-nowrap cursor-pointer"
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default StudyPage;
