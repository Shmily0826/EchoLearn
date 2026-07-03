import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import YouTubeEmbed, { type PlayerHandle } from '../components/YouTubeEmbed';
import BilibiliEmbed from '../components/BilibiliEmbed';
import TranscriptViewer from '../components/TranscriptViewer';
import TranscriptImporter from '../components/TranscriptImporter';
import AIAnalysisPanel from '../components/AIAnalysisPanel';
import WordDictionaryPopup from '../components/WordDictionaryPopup';
import { parseYouTubeId, parseStartTime } from '../utils/youtube';
import { detectPlatform, parseBilibiliId, parseBilibiliStartTime, parseBilibiliPage } from '../utils/bilibili';
import { normalizeTranscriptToSentences } from '../utils/transcriptNormalizer';
import { lemmatize } from '../utils/lemmatizer';
import { analyzeTranscript } from '../services/aiAnalysis';
import { fetchYouTubeTranscript } from '../services/youtubeTranscript';
import { fetchBilibiliTranscript, getBilibiliVideoTitle } from '../services/bilibiliTranscript';
import { translateWord } from '../services/translationService';
import { lookupWord } from '../services/dictionaryService';
import { pushItemsToCloud, pushSessionToCloud, syncWithCloud } from '../services/firestoreSync';
import { useAuth } from '../contexts/AuthContext';
import { CEFR_LEVELS, type CEFRLevel } from '../services/cefrWordList';
import { useI18n } from '../i18n/I18nContext';
import { getVideoTitle } from '../services/youtubeApi';
import {
  loadVocabulary,
  addVocabularyItem,
  removeVocabularyItem,
  updateVocabularyItem,
  loadSentences,
  addSentenceItem,
  removeSentenceItem,
  loadCurrentSession,
  saveCurrentSession,
  clearCurrentSession,
  addCompletedVideoId,
  removeCompletedVideoId,
  loadDailyPlan,
  updateDailyPlanItem,
  tomorrowMs,
} from '../utils/storage';
import type {
  TranscriptLine,
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
  AIAnalysisResult,
  VideoPlatform,
} from '../types';

type DisplayMode = 'sentence' | 'caption';

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const StudyPage: React.FC = () => {
  const { t, lang } = useI18n();
  const { user } = useAuth();

  // Debounced cloud sync — pushes vocabulary/sentences 2s after last change
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCloudSync = useCallback(() => {
    if (!user?.uid) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      pushItemsToCloud(user.uid).catch(() => { /* silent */ });
    }, 2000);
  }, [user?.uid]);

  // Debounced session sync — pushes sessions 5s after last change (they're larger)
  const sessionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSessionSync = useCallback(() => {
    if (!user?.uid) return;
    if (sessionSyncTimerRef.current) clearTimeout(sessionSyncTimerRef.current);
    sessionSyncTimerRef.current = setTimeout(() => {
      pushSessionToCloud(user.uid).catch(() => { /* silent */ });
    }, 5000);
  }, [user?.uid]);

  // Auto-sync with cloud when StudyPage mounts (pull latest data from other devices)
  useEffect(() => {
    if (!user?.uid) return;
    syncWithCloud(user.uid).then(() => {
      // Refresh state from localStorage after merge
      setVocabulary(loadVocabulary());
      setSentences(loadSentences());
    }).catch(() => { /* silent */ });
  }, [user?.uid]);

  // ── Session state ──────────────────────────────────────────
  const [session, setSession] = useState<VideoStudySession | null>(null);

  // Video state
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | undefined>(undefined);
  const [sessionTitle, setSessionTitle] = useState('');
  const [platform, setPlatform] = useState<VideoPlatform>('youtube');
  const [biliPage, setBiliPage] = useState<number | undefined>(undefined);

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

  // Analysis error state
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Ref to track if we've done the initial restore
  const restoredRef = useRef(false);
  // Track which session ID we've loaded, so we can detect new sessions from Dashboard
  const loadedSessionIdRef = useRef<string | null>(null);
  const { pathname } = useLocation();

  // YouTube player ref & playback time
  const playerRef = useRef<PlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(
    () => Number(localStorage.getItem('echolearn_playback_rate')) || 1,
  );

  // ── Playback position memory ───────────────────────────────
  const lastPosSaveRef = useRef(0);
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const [speedToast, setSpeedToast] = useState(false);
  const speedToastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Sleep timer ────────────────────────────────────────────
  const [sleepMinutes, setSleepMinutes] = useState(0); // 0 = off
  const [sleepRemaining, setSleepRemaining] = useState(0); // seconds
  const [sleepToast, setSleepToast] = useState(false);

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
      setPlatform(saved.platform || 'youtube');
      setUrlInput(saved.youtubeUrl);
      setSessionTitle(saved.title);
      setStartTime(saved.lastPosition && saved.lastPosition > 10 ? saved.lastPosition : undefined);
      if (saved.lastPosition && saved.lastPosition > 10) {
        const mins = Math.floor(saved.lastPosition / 60);
        const secs = saved.lastPosition % 60;
        setResumeToast(t('study.resumedAt', { time: `${mins}:${String(secs).padStart(2, '0')}` }));
        setTimeout(() => setResumeToast(null), 5000);
      }
      setBiliPage(undefined);

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
      } else if ((saved.transcriptLines?.length ?? 0) > 0) {
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
        !!saved.transcriptData || (saved.transcriptLines?.length ?? 0) > 0;
      if (saved.youtubeId && !hasTranscript) {
        setFetchingCaption(true);
        setCaptionError(null);
        const fetcher = (saved.platform === 'bilibili')
          ? fetchBilibiliTranscript(saved.youtubeId)
          : fetchYouTubeTranscript(saved.youtubeId);
        fetcher
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
    setPlatform(saved.platform || 'youtube');
    setUrlInput(saved.youtubeUrl);
    setSessionTitle(saved.title);
    setStartTime(saved.lastPosition && saved.lastPosition > 10 ? saved.lastPosition : undefined);
    if (saved.lastPosition && saved.lastPosition > 10) {
      const mins = Math.floor(saved.lastPosition / 60);
      const secs = saved.lastPosition % 60;
      setResumeToast(t('study.resumedAt', { time: `${mins}:${String(secs).padStart(2, '0')}` }));
      setTimeout(() => setResumeToast(null), 5000);
    }
    setBiliPage(undefined);
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
    } else if ((saved.transcriptLines?.length ?? 0) > 0) {
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
      !!saved.transcriptData || (saved.transcriptLines?.length ?? 0) > 0;
    if (saved.youtubeId && !hasTranscript) {
      setFetchingCaption(true);
      setCaptionError(null);
      const fetcher = (saved.platform === 'bilibili')
        ? fetchBilibiliTranscript(saved.youtubeId)
        : fetchYouTubeTranscript(saved.youtubeId);
      fetcher
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

  // ── Poll current playback time every 100ms + save position ──
  useEffect(() => {
    if (!videoId || !playerRef.current) return;
    const id = setInterval(() => {
      if (playerRef.current) {
        try {
          const t = playerRef.current.getCurrentTime();
          setCurrentTime(t);
          // Save playback position every 5 seconds for resume
          const now = Date.now();
          if (now - lastPosSaveRef.current > 5000 && t > 0) {
            lastPosSaveRef.current = now;
            const pos = Math.floor(t);
            localStorage.setItem('echolearn_last_position', String(pos));
            setSession((prev) => {
              if (!prev) return prev;
              const updated = { ...prev, lastPosition: pos };
              // Also persist to localStorage so position survives page reload
              try {
                localStorage.setItem('echolearn_session', JSON.stringify(updated));
              } catch { /* quota exceeded — ignore */ }
              return updated;
            });
          }
        } catch {
          // Player in broken state — skip this tick silently
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [videoId]);

  // ── Apply playback rate to player whenever it changes ───────
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setPlaybackRate(playbackRate);
    }
    localStorage.setItem('echolearn_playback_rate', String(playbackRate));
    // Show speed toast briefly on mobile
    setSpeedToast(true);
    clearTimeout(speedToastTimer.current);
    speedToastTimer.current = setTimeout(() => setSpeedToast(false), 1200);
  }, [playbackRate]);

  // ── Sleep timer countdown ──────────────────────────────────
  useEffect(() => {
    if (sleepMinutes <= 0) return;
    setSleepRemaining(sleepMinutes * 60);
    setSleepToast(false);
  }, [sleepMinutes]);

  useEffect(() => {
    if (sleepRemaining <= 0) return;
    const id = setInterval(() => {
      setSleepRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          // Timer expired — pause video
          try { playerRef.current?.pauseVideo(); } catch { /* noop */ }
          setSleepMinutes(0);
          setSleepToast(true);
          setTimeout(() => setSleepToast(false), 5000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [sleepRemaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () => new Set(filteredVocabulary.map((v) => (v.lemma || lemmatize(v.word)).toLowerCase())),
    [filteredVocabulary],
  );
  const savedSentencesSet = useMemo(
    () => new Set(filteredSentences.map((s) => s.text)),
    [filteredSentences],
  );
  const savedSentenceIds = useMemo(
    () => new Map(filteredSentences.map((s) => [s.text, s.id])),
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
      let pos = session?.lastPosition ?? 0;
      try { pos = Math.floor(playerRef.current?.getCurrentTime?.() ?? pos); } catch { /* noop */ }
      const updated: VideoStudySession = {
        id: session?.id || `session_${now}`,
        youtubeUrl: yUrl,
        youtubeId: yId,
        platform,
        title,
        transcriptLines: raw, // legacy compat
        transcriptData: { rawBlocks: raw, sentenceLines: sLines },
        createdAt: session?.createdAt || now,
        updatedAt: now,
        status,
        lastPosition: pos,
      };
      saveCurrentSession(updated);
      setSession(updated);
      triggerSessionSync();
    },
    [session, platform, triggerSessionSync],
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
    const detected = detectPlatform(urlInput);
    if (!detected) return;

    setPlatform(detected);

    if (detected === 'bilibili') {
      const id = parseBilibiliId(urlInput);
      if (!id) return;
      const st = parseBilibiliStartTime(urlInput);
      const pg = parseBilibiliPage(urlInput);
      setVideoId(id);
      setStartTime(st);
      setBiliPage(pg);

      if (!sessionTitle) {
        setSessionTitle(urlInput.trim());
        getBilibiliVideoTitle(id).then((info) => {
          if (info?.title) setSessionTitle(info.title);
        });
      }

      if (rawBlocks.length > 0) {
        persistSession(id, urlInput.trim(), rawBlocks, sentenceLines, sessionTitle || urlInput.trim());
        return;
      }

      setFetchingCaption(true);
      setCaptionError(null);
      fetchBilibiliTranscript(id)
        .then(({ lines }) => {
          if (lines.length > 0) importTranscript(lines);
        })
        .catch((err) => {
          setCaptionError(err instanceof Error ? err.message : 'Unknown error fetching captions');
        })
        .finally(() => setFetchingCaption(false));
    } else {
      // YouTube (existing logic)
      const id = parseYouTubeId(urlInput);
      if (!id) return;
      const st = parseStartTime(urlInput);
      setVideoId(id);
      setStartTime(st);
      setBiliPage(undefined);

      if (!sessionTitle) {
        setSessionTitle(urlInput.trim());
        getVideoTitle(urlInput).then((info) => {
          if (info?.title) setSessionTitle(info.title);
        });
      }

      if (rawBlocks.length > 0) {
        persistSession(id, urlInput.trim(), rawBlocks, sentenceLines, sessionTitle || urlInput.trim());
        return;
      }

      setFetchingCaption(true);
      setCaptionError(null);
      fetchYouTubeTranscript(id)
        .then(({ lines }) => {
          if (lines.length > 0) importTranscript(lines);
        })
        .catch((err) => {
          setCaptionError(err instanceof Error ? err.message : 'Unknown error fetching captions');
        })
        .finally(() => setFetchingCaption(false));
    }
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
    setPlatform('youtube');
    setBiliPage(undefined);
  }, []);

  // ── Toggle session completion status ───────────────────────
  const handleToggleComplete = useCallback(() => {
    if (!session) return;
    const newStatus = session.status === 'completed' ? 'studying' : 'completed';
    const updated: VideoStudySession = { ...session, status: newStatus, updatedAt: Date.now() };
    saveCurrentSession(updated);
    setSession(updated);
    // Track/untrack in global completed video list
    if (newStatus === 'completed') {
      addCompletedVideoId(session.youtubeId);
    } else {
      removeCompletedVideoId(session.youtubeId);
    }
    // Sync daily plan item status
    const plan = loadDailyPlan();
    const planItem = plan.find((p) => p.videoId === session.youtubeId);
    if (planItem) {
      updateDailyPlanItem(planItem.id, { status: newStatus === 'completed' ? 'completed' : 'studying' });
    }
  }, [session]);

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
    setAnalysisError(null);
    try {
      const result = await analyzeTranscript(
        text,
        cefrMin,
        cefrMax,
        vocabCount,
        sentenceCount,
        (chunk) => setStreamChars((prev) => prev + chunk.length),
        lang,
      );
      setAnalysis(result);
      persistAnalysis(result);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
      setStreamChars(0);
    }
  }, [displayMode, sentenceLines, rawBlocks, cefrMin, cefrMax, vocabCount, sentenceCount, persistAnalysis, lang]);

  // ── Vocab / sentence handlers ─────────────────────────────
  const handleAddVocabulary = useCallback((item: VocabularyItem) => {
    setVocabulary(addVocabularyItem(item));
    triggerCloudSync();
    // Auto-translate meaningCn if empty
    if (!item.meaningCn) {
      translateWord(item.word, item.context).then((meaningCn) => {
        if (meaningCn) {
          setVocabulary(updateVocabularyItem(item.id, { meaningCn }));
          triggerCloudSync();
        }
      }).catch(() => { /* silent */ });
    }
  }, [triggerCloudSync]);

  const handleAddSentence = useCallback((item: SentenceItem) => {
    setSentences(addSentenceItem(item));
    triggerCloudSync();
  }, [triggerCloudSync]);

  const handleRemoveVocabulary = useCallback((id: string) => {
    if (!window.confirm(t('study.deleteWord'))) return;
    setVocabulary(removeVocabularyItem(id));
    triggerCloudSync();
  }, [triggerCloudSync]);

  const handleRemoveSentence = useCallback((id: string) => {
    if (!window.confirm(t('study.deleteSent'))) return;
    setSentences(removeSentenceItem(id));
    triggerCloudSync();
  }, [triggerCloudSync]);

  // Silent toggle — no confirm dialog (used by bookmark button)
  const handleToggleSentenceOff = useCallback((id: string) => {
    setSentences(removeSentenceItem(id));
    triggerCloudSync();
  }, [triggerCloudSync]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="study-main">
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
                placeholder={t('study.sessionTitlePh')}
              />
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
              placeholder={t('study.urlPh')}
              className="flex-1 sm:w-80 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent dark:bg-slate-800 dark:text-gray-200 min-w-0"
            />
            <button
              onClick={handleLoadVideo}
              className="px-3 sm:px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer whitespace-nowrap"
            >
              {t('study.loadVideo')}
            </button>
            {session && (
              <button
                onClick={handleToggleComplete}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium cursor-pointer whitespace-nowrap transition-colors ${
                  session.status === 'completed'
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/60'
                    : 'bg-white dark:bg-slate-800 border border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30'
                }`}
                title={session.status === 'completed' ? t('study.resumeStudying') : t('study.markComplete')}
              >
                {session.status === 'completed' ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('study.completed')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t('study.markComplete')}
                  </span>
                )}
              </button>
            )}
            {session && (
              <button
                onClick={handleClearSession}
                className="px-3 sm:px-4 py-1.5 text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors font-medium cursor-pointer whitespace-nowrap"
              >
                {t('study.clear')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="study-layout flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Left: video — always visible (mobile: above transcript, desktop: left column) */}
          <div className="w-full lg:w-[55%] flex-shrink-0">
            {videoId ? (
              platform === 'bilibili' ? (
                <BilibiliEmbed ref={playerRef} bvid={videoId} page={biliPage} startTime={startTime} />
              ) : (
                <YouTubeEmbed ref={playerRef} youtubeId={videoId} startTime={startTime} playbackRate={playbackRate} />
              )
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
                  <p className="text-gray-400 dark:text-gray-500 text-sm">{t('study.pasteStart')}</p>
                </div>
              </div>
            )}

            {/* Sleep timer toast */}
            {sleepToast && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
                <span>{t('study.timerPaused')}</span>
                <button
                  onClick={() => setSleepToast(false)}
                  className="ml-auto text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Resume position toast */}
            {resumeToast && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span>{resumeToast}</span>
                <button
                  onClick={() => setResumeToast(null)}
                  className="ml-auto text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Quick info */}
            {videoId && (
              <div className="mt-2 flex flex-col gap-1.5">
                {/* Playback speed + timer — merged on mobile */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium shrink-0">
                    {t('study.speed')}:
                  </span>
                  <div className="flex items-center gap-0.5">
                    {SPEED_PRESETS.map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setPlaybackRate(rate)}
                        className={`px-1.5 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                          playbackRate === rate
                            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                  {/* Slider — compact on mobile, wider on desktop */}
                  <div className="flex items-center gap-1 flex-1 min-w-[100px] sm:min-w-[140px] relative">
                    <input
                      type="range"
                      min={0.25}
                      max={3}
                      step={0.05}
                      value={playbackRate}
                      onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                      className="flex-1 h-1 accent-indigo-500 cursor-pointer"
                    />
                    <span className={`text-[10px] font-mono w-10 tabular-nums shrink-0 transition-opacity duration-300 ${
                      speedToast
                        ? 'text-indigo-600 dark:text-indigo-400 font-semibold opacity-100'
                        : 'text-gray-500 dark:text-gray-400 opacity-0 sm:opacity-100'
                    }`}>
                      {playbackRate.toFixed(2)}x
                    </span>
                  </div>
                  {/* Timer — on same row as speed on mobile */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium shrink-0 ml-1">
                      {t('study.timer')}:
                    </span>
                    <div className="flex items-center gap-0.5">
                      {[0, 15, 30, 45, 60].map((min) => (
                        <button
                          key={min}
                          onClick={() => setSleepMinutes(min)}
                          className={`px-1 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                            sleepMinutes === min
                              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {min === 0 ? t('study.timerOff') : `${min}`}
                        </button>
                      ))}
                    </div>
                    {/* Manual minute input */}
                    <input
                      type="number"
                      min={1}
                      max={180}
                      placeholder="min"
                      value=""
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(180, Number(e.target.value) || 0));
                        if (v > 0) setSleepMinutes(v);
                        e.target.value = '';
                      }}
                      className="w-10 px-1 py-0.5 text-[10px] border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none text-center"
                      title={t('study.timerCustom')}
                    />
                  </div>
                </div>
                {sleepRemaining > 0 && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                    {t('study.timerRemaining', {
                      time: `${Math.floor(sleepRemaining / 60)}:${String(sleepRemaining % 60).padStart(2, '0')}`,
                    })}
                  </span>
                )}
                {/* Video info — hidden on mobile, visible on desktop */}
                <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span>{platform === 'bilibili' ? 'Bilibili' : 'YouTube'}: {videoId}</span>
                  {startTime !== undefined && <span>Start: {startTime}s</span>}
                  {session && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      session.status === 'studying'
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        : session.status === 'completed'
                          ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                    }`}>
                      {session.status === 'completed' ? t('study.completed') : session.status === 'studying' ? t('study.resumeStudying') : t('dash.statusDraft')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Mobile inline transcript — visible below video on small screens ── */}
            {videoId && displayLines.length > 0 && (
              <div translate="no" className="notranslate lg:hidden mt-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
                {/* Header with Analyze button on same row */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-slate-700">
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {t('study.subtitles')}
                  </span>
                  <div className="flex items-center gap-2">
                    {fetchingCaption && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-500">
                        <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {t('study.fetchingShort')}
                      </span>
                    )}
                    {displayLines.length > 0 && (
                      <button
                        onClick={handleAnalyze}
                        disabled={analyzing}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {analyzing ? (
                          <>
                            <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            {streamChars > 0 ? `${streamChars}` : t('study.analyzing')}
                          </>
                        ) : (
                          <>
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                            </svg>
                            {analysis ? t('study.reAnalyze') : t('study.analyze')}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {/* Mobile analysis controls — words/sents/level only */}
                {displayLines.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-slate-700 flex-wrap">
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-gray-400">{t('study.words')}</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={vocabCount}
                        onChange={(e) => setVocabCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                        className="w-10 px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none text-center"
                      />
                      <span className="text-gray-300 ml-0.5">{t('study.sents')}</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={sentenceCount}
                        onChange={(e) => setSentenceCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                        className="w-10 px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none text-center"
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-gray-400">{t('study.level')}</span>
                      <select
                        value={cefrMin}
                        onChange={(e) => {
                          const v = e.target.value as CEFRLevel;
                          setCefrMin(v);
                          if (CEFR_LEVELS.indexOf(v) > CEFR_LEVELS.indexOf(cefrMax)) setCefrMax(v);
                        }}
                        className="px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none cursor-pointer"
                      >
                        {CEFR_LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                      <span className="text-gray-300">–</span>
                      <select
                        value={cefrMax}
                        onChange={(e) => {
                          const v = e.target.value as CEFRLevel;
                          setCefrMax(v);
                          if (CEFR_LEVELS.indexOf(v) < CEFR_LEVELS.indexOf(cefrMin)) setCefrMin(v);
                        }}
                        className="px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none cursor-pointer"
                      >
                        {CEFR_LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <MobileTranscriptPanel
                  lines={displayLines}
                  activeLineIndex={activeLineIndex}
                  videoId={videoId || 'unknown'}
                  videoTitle={sessionTitle}
                  savedWords={savedWords}
                  savedSentences={savedSentencesSet}
                  savedSentenceIds={savedSentenceIds}
                  onAddVocabulary={handleAddVocabulary}
                  onAddSentence={handleAddSentence}
                  onRemoveSentence={handleToggleSentenceOff}
                  onSeekTo={(seconds) => playerRef.current?.seekTo(seconds)}
                />
              </div>
            )}
          </div>

          {/* Right: Transcript — always visible on desktop, tab-gated on mobile */}
          <div translate="no" className="notranslate hidden lg:flex flex-1 flex-col min-w-0 h-[calc(100vh-160px)]">
            {/* Toolbar — footer below transcript content */}
            <div className="flex-shrink-0 order-2 flex items-center justify-between px-2 py-1 border-t border-gray-200 dark:border-slate-700 gap-1 sm:gap-2">
              <h2 className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t('study.transcript')}
              </h2>
              <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
                {/* Caption fetch status */}
                {fetchingCaption && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500">
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('study.fetchingCaption')}
                  </span>
                )}
                {/* Count selectors + CEFR + Analyze (only when transcript loaded) */}
                {displayLines.length > 0 && (
                  <>
                    {/* Vocab / Sentence count */}
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-gray-400 dark:text-gray-500">{t('study.words')}</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={vocabCount}
                        onChange={(e) => setVocabCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                        className="w-12 px-1 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 text-center"
                      />
                      <span className="text-gray-300 dark:text-gray-500 ml-1">{t('study.sents')}</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={sentenceCount}
                        onChange={(e) => setSentenceCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                        className="w-12 px-1 py-1 border border-gray-200 dark:border-slate-700 rounded text-[11px] bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 text-center"
                      />
                    </div>
                    {/* CEFR level range selector */}
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-gray-400 dark:text-gray-500 mr-0.5">{t('study.level')}</span>
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
                        {streamChars > 0 ? `${streamChars} ${t('study.chars')}` : t('study.analyzing')}
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        {analysis ? t('study.reAnalyze') : t('study.analyze')}
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
                      {t('study.sentence')}
                    </button>
                    <button
                      onClick={() => setDisplayMode('caption')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                        displayMode === 'caption'
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {t('study.caption')}
                    </button>
                  </div>
                )}
                {videoId && sentenceLines.length === 0 && rawBlocks.length === 0 && (
                  <span />
                )}
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {displayMode === 'sentence'
                    ? `${sentenceLines.length} ${t('study.sentences')}`
                    : `${rawBlocks.length} ${t('study.blocks')}`}
                </span>
              </div>
            </div>

            {/* Scrollable content area — fills full height from top */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 order-1">
            {displayLines.length > 0 ? (
              <TranscriptViewer
                lines={displayLines}
                videoId={videoId || 'unknown'}
                videoTitle={sessionTitle}
                onAddVocabulary={handleAddVocabulary}
                onAddSentence={handleAddSentence}
                onRemoveSentence={handleToggleSentenceOff}
                savedWords={savedWords}
                savedSentences={savedSentencesSet}
                savedSentenceIds={savedSentenceIds}
                activeLineIndex={activeLineIndex}
                onSeekTo={handleSeekTo}
              />
            ) : fetchingCaption ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <svg className="animate-spin w-8 h-8 mb-3 text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm">{t('study.fetchingFull')}</p>
                <p className="text-xs mt-1 text-gray-300 dark:text-gray-500">{t('study.mayTake')}</p>
              </div>
            ) : captionError ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-5 max-w-md text-center">
                  <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">{t('study.fetchFailed')}</p>
                  <p className="text-xs text-red-500/70 dark:text-red-400/60 mb-3 whitespace-pre-line">{captionError}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('study.pasteManual')}</p>
                </div>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => {
                      if (videoId) {
                        setCaptionError(null);
                        setFetchingCaption(true);
                        const retryFetcher = (platform === 'bilibili')
                          ? fetchBilibiliTranscript(videoId)
                          : fetchYouTubeTranscript(videoId);
                        retryFetcher
                          .then(({ lines }) => {
                            if (lines.length > 0) {
                              const sLines = normalizeTranscriptToSentences(lines);
                              setRawBlocks(lines);
                              setSentenceLines(sLines);
                              if (session) {
                                const updated = { ...session, transcriptLines: lines, transcriptData: { rawBlocks: lines, sentenceLines: sLines } };
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
                    {t('study.retry')}
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => setCaptionError(null)}
                    className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer"
                  >
                    {t('study.dismiss')}
                  </button>
                </div>
              </div>
            ) : videoId ? (
              <TranscriptImporter onImport={handleImportTranscript} />
            ) : (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                <p>{t('study.noVideo')}</p>
                <p className="mt-1">{t('study.loadToStart')}</p>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Analysis error banner */}
        {analysisError && (
          <div className="mt-4 flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-600 dark:text-red-400 flex-1">{analysisError}</p>
            <button onClick={() => setAnalysisError(null)} className="text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-300 cursor-pointer">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* AI Analysis Panel */}
        {analysis && (
          <div>
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

        {/* Bottom: Saved items */}
        <div className="mt-8 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
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
              {`${t('study.vocabTab')} (${filteredVocabulary.length})`}
            </button>
            <button
              onClick={() => setActiveTab('sentences')}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'sentences'
                  ? 'text-violet-700 dark:text-violet-400 border-b-2 border-violet-500'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {`${t('study.sentTab')} (${filteredSentences.length})`}
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
  const { t } = useI18n();
  const [dictPopup, setDictPopup] = useState<DictPopupState | null>(null);

  const handleWordClick = (word: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDictPopup({ word, x: rect.left + rect.width / 2, y: rect.top });
  };

  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
        {t('study.clickWord')}
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
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs cursor-pointer"
              >
                {t('study.remove')}
              </button>
            </div>
            {item.meaningCn && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{item.meaningCn}</p>
            )}
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
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-6">
        {t('study.clickSent')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-violet-50 dark:bg-indigo-950/40 border border-violet-200 dark:border-indigo-700 rounded-lg p-3 group"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-violet-800 dark:text-indigo-200 leading-relaxed">{item.text}</p>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs whitespace-nowrap cursor-pointer"
            >
              {t('study.remove')}
            </button>
          </div>
          {item.meaningCn && (
            <p className="text-xs text-violet-500 dark:text-indigo-400 mt-1 leading-relaxed">{item.meaningCn}</p>
          )}
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

// ─── Mobile Transcript Panel (inline below video) ────────────

interface MobileWordPopup {
  word: string;
  context: string;
  startTime: number;
  x: number;
  y: number;
}

const MobileTranscriptPanel: React.FC<{
  lines: TranscriptLine[];
  activeLineIndex: number;
  videoId: string;
  videoTitle: string;
  savedWords: Set<string>;
  savedSentences: Set<string>;
  savedSentenceIds: Map<string, string>;
  onAddVocabulary: (item: VocabularyItem) => void;
  onAddSentence: (item: SentenceItem) => void;
  onRemoveSentence: (id: string) => void;
  onSeekTo: (seconds: number) => void;
}> = ({ lines, activeLineIndex, videoId, videoTitle, savedWords, savedSentences, savedSentenceIds, onAddVocabulary, onAddSentence, onRemoveSentence, onSeekTo }) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Word popup state
  const [popup, setPopup] = useState<MobileWordPopup | null>(null);
  const [dictEntry, setDictEntry] = useState<import('../types').DictionaryEntry | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState(false);

  // Detect user scrolling
  const handleScroll = useCallback(() => {
    userScrolled.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      userScrolled.current = false;
    }, 3000);
  }, []);

  // Auto-scroll to active line — container-relative, never scrolls the page
  useEffect(() => {
    if (userScrolled.current || !activeRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const el = activeRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetScroll =
      container.scrollTop +
      (elRect.top - containerRect.top) -
      container.clientHeight / 4 +
      elRect.height / 2;
    container.scrollTop = Math.max(0, targetScroll);
  }, [activeLineIndex]);

  // Close popup on outside click
  useEffect(() => {
    if (!popup) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [popup]);

  // Dictionary lookup when popup opens
  useEffect(() => {
    if (!popup) return;
    setDictEntry(null);
    setDictLoading(true);
    setDictError(false);
    let cancelled = false;
    lookupWord(popup.word).then((entry) => {
      if (cancelled) return;
      if (entry) setDictEntry(entry);
      else setDictError(true);
      setDictLoading(false);
    });
    return () => { cancelled = true; };
  }, [popup]);

  const handleWordClick = useCallback((word: string, context: string, lineStart: number, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({
      word,
      context,
      startTime: lineStart,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }, []);

  const handleAddWord = useCallback(() => {
    if (!popup) return;
    const lemma = lemmatize(popup.word);
    const item: VocabularyItem = {
      id: `vocab_${Date.now()}`,
      word: lemma,
      lemma,
      meaningCn: dictEntry?.definitionEn || '',
      context: popup.context,
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      sourceTimestamp: popup.startTime,
      addedAt: Date.now(),
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
      phonetic: dictEntry?.phonetic || '',
      audioUrl: dictEntry?.audioUrl || '',
      partOfSpeech: dictEntry?.partOfSpeech || '',
      definitionEn: dictEntry?.definitionEn || '',
      example: dictEntry?.example || '',
      synonyms: dictEntry?.synonyms || [],
      antonyms: dictEntry?.antonyms || [],
      dictionaryProvider: dictEntry?.provider || '',
    };
    onAddVocabulary(item);
    setPopup(null);
  }, [popup, dictEntry, videoId, videoTitle, onAddVocabulary]);

  const handleAddSentence = useCallback((line: TranscriptLine) => {
    const item: SentenceItem = {
      id: `sent_${Date.now()}`,
      text: line.text,
      meaningCn: '',
      sourceVideoId: videoId,
      sourceVideoTitle: videoTitle,
      startTime: line.start,
      addedAt: Date.now(),
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: tomorrowMs(),
    };
    onAddSentence(item);
  }, [videoId, videoTitle, onAddSentence]);

  const handlePlayAudio = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (dictEntry?.audioUrl) {
      new Audio(dictEntry.audioUrl).play().catch(() => {});
    }
  }, [dictEntry]);

  const splitIntoWords = (text: string) => {
    return text.match(/[\w']+|[^\w\s]+|\s+/g) || [];
  };

  const isWordSaved = (word: string) => savedWords.has(lemmatize(word).toLowerCase());
  const isSentenceSaved = (text: string) => savedSentences.has(text);

  const shouldFlip = popup ? popup.y < 280 : false;

  if (lines.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
        {t('study.noSubtitles')}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Word dictionary popup (mobile) */}
      {popup && (
        <div
          ref={popupRef}
          className={`fixed z-50 transform -translate-x-1/2 ${shouldFlip ? '' : '-translate-y-full'}`}
          style={{ left: Math.min(Math.max(popup.x, 170), window.innerWidth - 170), top: shouldFlip ? popup.y + 24 : popup.y }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 p-4 min-w-[260px] max-w-[min(340px,90vw)] max-h-[70vh] overflow-y-auto">
            <button
              onClick={() => setPopup(null)}
              className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-gray-800 dark:text-gray-200">{popup.word}</span>
              {dictEntry?.phonetic && <span className="text-sm text-gray-400 font-mono">{dictEntry.phonetic}</span>}
              {dictEntry?.audioUrl && (
                <button onClick={handlePlayAudio} className="p-1 text-indigo-500 rounded-full cursor-pointer">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" /></svg>
                </button>
              )}
            </div>
            {dictEntry?.partOfSpeech && (
              <span className="inline-block text-[11px] px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full font-medium mb-2">{dictEntry.partOfSpeech}</span>
            )}
            {dictLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Looking up...
              </div>
            )}
            {dictEntry && !dictLoading && (
              <div className="mb-3">
                {dictEntry.definitionEn && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{dictEntry.definitionEn}</p>}
                {dictEntry.example && <p className="text-xs text-gray-400 mt-1.5 italic">&ldquo;{dictEntry.example}&rdquo;</p>}
                {dictEntry.synonyms.length > 0 && (
                  <div className="mt-2 flex items-start gap-1 flex-wrap">
                    <span className="text-[10px] text-gray-400 font-medium mt-px">syn:</span>
                    {dictEntry.synonyms.slice(0, 5).map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 rounded">{s}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {dictError && !dictLoading && <p className="text-xs text-gray-400 mb-3">Dictionary entry not found.</p>}
            <p className="text-[11px] text-gray-400 mb-3 line-clamp-2">&ldquo;{popup.context}&rdquo;</p>
            {isWordSaved(popup.word) ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('study.alreadySaved')}</span>
            ) : (
              <button onClick={handleAddWord} className="w-full px-3 py-2 text-sm bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 font-medium cursor-pointer">
                + {t('study.addToVocab')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transcript lines */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto max-h-[55vh] px-2 py-1"
        style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollBehavior: 'smooth' }}
      >
        {lines.map((line, idx) => {
          const isActive = idx === activeLineIndex;
          const sentenceSaved = isSentenceSaved(line.text);

          return (
            <div
              key={line.id || idx}
              ref={isActive ? activeRef : null}
              className={`px-2 py-1.5 rounded-lg text-sm leading-relaxed transition-colors ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-medium'
                  : sentenceSaved
                    ? 'bg-violet-50 dark:bg-violet-950/20 text-gray-600 dark:text-gray-400'
                    : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <div className="flex-1 min-w-0" onClick={() => onSeekTo(line.start)}>
                  <span
                    className="text-[10px] font-mono mr-1.5 select-none cursor-pointer hover:text-indigo-600"
                    style={{ color: isActive ? '#6366f1' : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSeekTo(line.start); }}
                  >
                    {formatTime(line.start)}
                  </span>
                  {/* Clickable words */}
                  {splitIntoWords(line.text).map((token, i) => {
                    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
                    if (/^[^\w']+$/.test(token)) return <span key={i} className="text-gray-400">{token}</span>;
                    const saved = isWordSaved(token.toLowerCase());
                    return (
                      <span
                        key={i}
                        onClick={(e) => handleWordClick(token, line.text, line.start, e)}
                        className={`inline-block mx-[1px] px-1 py-0.5 rounded cursor-pointer transition-colors ${
                          saved
                            ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                            : 'active:bg-indigo-100'
                        }`}
                      >
                        {token}
                      </span>
                    );
                  })}
                </div>
                {/* Sentence bookmark button — toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sentenceSaved) {
                      const id = savedSentenceIds.get(line.text);
                      if (id) onRemoveSentence(id);
                    } else {
                      handleAddSentence(line);
                    }
                  }}
                  className={`flex-shrink-0 p-1.5 rounded transition-colors cursor-pointer ${
                    sentenceSaved
                      ? 'text-violet-500 dark:text-violet-400'
                      : 'text-gray-300 active:text-violet-400'
                  }`}
                >
                  {sentenceSaved ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5 2h14a1 1 0 011 1v19.143a.5.5 0 01-.766.424L12 18.03l-7.234 4.536A.5.5 0 014 22.143V3a1 1 0 011-1z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StudyPage;
