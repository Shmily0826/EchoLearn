import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';
import {
  loadVocabulary,
  loadSentences,
  loadAllSessions,
  loadCurrentSession,
  deleteSession,
  todayStartMs,
  loadDailyPlan,
  addDailyPlanItem,
  updateDailyPlanItem,
  removeDailyPlanItem,
  clearDailyPlan,
  planHasVideoId,
  saveCurrentSession,
  isVideoCompleted,
  removeCompletedVideoId,
  getPageToken,
  savePageToken,
  clearPageToken,
} from '../utils/storage';
import { getRecentVideosFromChannel, hasApiKey } from '../services/youtubeApi';
import { useI18n } from '../i18n/I18nContext';
import { TARGET_CHANNEL } from '../config/targetChannel';
import type {
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
  DailyPlanItem,
  ChannelVideo,
} from '../types';

const CHANNEL_PREFS_KEY = 'echolearn_channel_prefs';

interface ChannelPrefs {
  input: string;
  topic: string;
}

function loadChannelPrefs(): ChannelPrefs {
  try {
    const raw = localStorage.getItem(CHANNEL_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { input: TARGET_CHANNEL.input, topic: TARGET_CHANNEL.topic };
}

function saveChannelPrefs(prefs: ChannelPrefs): void {
  localStorage.setItem(CHANNEL_PREFS_KEY, JSON.stringify(prefs));
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();

  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [sessions, setSessions] = useState<VideoStudySession[]>([]);
  const [currentSession, setCurrentSession] = useState<VideoStudySession | null>(null);

  // Daily plan state
  const [dailyPlan, setDailyPlan] = useState<DailyPlanItem[]>([]);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checkSuccess, setCheckSuccess] = useState(false);

  // Editable channel prefs
  const [channelPrefs, setChannelPrefs] = useState<ChannelPrefs>(loadChannelPrefs);

  // Completed sessions collapse state
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
    setSessions(loadAllSessions());
    setCurrentSession(loadCurrentSession());
    setDailyPlan(loadDailyPlan());
  }, []);

  const { t, lang } = useI18n();

  const statusLabel = (status: string) => {
    const key = `dash.status${status.charAt(0).toUpperCase() + status.slice(1)}`;
    return t(key);
  };

  const handleChannelChange = (field: keyof ChannelPrefs, value: string) => {
    const updated = { ...channelPrefs, [field]: value };
    setChannelPrefs(updated);
    saveChannelPrefs(updated);
  };

  // Today's review: items where nextReviewAt <= end of today and not mastered
  const todayCount = useMemo(() => {
    const todayEnd = todayStartMs() + 24 * 60 * 60 * 1000;
    const dueWords = vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= todayEnd).length;
    const dueSentences = sentences.filter((s) => !s.mastered && s.nextReviewAt <= todayEnd).length;
    return dueWords + dueSentences;
  }, [vocabulary, sentences]);

  // ── Chart data ──────────────────────────────────────────────
  const weeklyActivityData = useMemo(() => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en';
    const days: Array<{ day: string; words: number; sentences: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dayStart = d.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const dayLabel = d.toLocaleDateString(locale, { weekday: 'short' });
      days.push({
        day: dayLabel,
        words: vocabulary.filter((v) => v.addedAt >= dayStart && v.addedAt < dayEnd).length,
        sentences: sentences.filter((s) => s.addedAt >= dayStart && s.addedAt < dayEnd).length,
      });
    }
    return days;
  }, [vocabulary, sentences, lang]);

  const masteryData = useMemo(() => {
    const mastered = vocabulary.filter((v) => v.mastered).length;
    const reviewed = vocabulary.filter((v) => !v.mastered && v.reviewCount > 0).length;
    const newWords = vocabulary.filter((v) => !v.mastered && v.reviewCount === 0).length;
    return [
      { name: t('dash.pieMastered'), value: mastered, color: '#10b981' },
      { name: t('dash.pieReviewing'), value: reviewed, color: '#f59e0b' },
      { name: t('dash.pieNew'), value: newWords, color: '#6366f1' },
    ].filter((d) => d.value > 0);
  }, [vocabulary, t]);

  const cumulativeData = useMemo(() => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en';
    const points: Array<{ date: string; words: number; sentences: number; total: number }> = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(23, 59, 59, 999);
      const cutoff = d.getTime();
      const wCount = vocabulary.filter((v) => v.addedAt <= cutoff).length;
      const sCount = sentences.filter((s) => s.addedAt <= cutoff).length;
      points.push({
        date: d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
        words: wCount,
        sentences: sCount,
        total: wCount + sCount,
      });
    }
    return points;
  }, [vocabulary, sentences, lang]);

  const hasChartData = vocabulary.length > 0 || sentences.length > 0;

  const handleContinueSession = () => {
    navigate('/study');
  };

  const handleOpenSession = (session: VideoStudySession) => {
    // Save it as the current session so StudyPage restores it
    saveCurrentSession(session);
    navigate('/study');
  };

  const handleDeleteSession = (id: string) => {
    if (!window.confirm(t('dash.deleteSession'))) return;
    // Find session before deleting to revert plan item
    const allSessions = loadAllSessions();
    const sessionToDelete = allSessions.find((s) => s.id === id);
    if (sessionToDelete) {
      const plan = loadDailyPlan();
      const planItem = plan.find((p) => p.videoId === sessionToDelete.youtubeId);
      if (planItem && planItem.status !== 'planned') {
        updateDailyPlanItem(planItem.id, { status: 'planned' });
      }
      removeCompletedVideoId(sessionToDelete.youtubeId);
    }
    deleteSession(id);
    setSessions(loadAllSessions());
    setDailyPlan(loadDailyPlan());
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }
  };

  // ── Helper to process fetched videos result ───────────────
  const handleVideosResult = useCallback(
    (
      result: { videos: ChannelVideo[]; nextPageToken?: string },
      channelKey: string,
      input: string,
    ) => {
      // Save nextPageToken for next fetch
      if (result.nextPageToken) {
        savePageToken(channelKey, result.nextPageToken);
      }

      // Filter out: (1) already in plan, (2) globally completed
      const newVideos: ChannelVideo[] = [];
      let skippedCompleted = 0;
      for (const v of result.videos) {
        if (planHasVideoId(v.videoId)) continue;
        if (isVideoCompleted(v.videoId)) {
          skippedCompleted++;
          continue;
        }
        newVideos.push(v);
      }

      if (newVideos.length === 0) {
        const msg = skippedCompleted > 0
          ? t('dash.allSkippedCompleted', { n: skippedCompleted })
          : t('dash.allInPlan');
        setCheckMessage(msg);
        setCheckSuccess(true);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      let added = 0;
      for (const video of newVideos) {
        const item: DailyPlanItem = {
          id: `plan_${Date.now()}_${added}`,
          date: today,
          videoId: video.videoId,
          youtubeUrl: video.youtubeUrl,
          title: video.title,
          channelTitle: video.channelTitle,
          thumbnailUrl: video.thumbnailUrl,
          status: 'planned',
          createdAt: Date.now() + added,
        };
        addDailyPlanItem(item);
        added++;
      }

      setDailyPlan(loadDailyPlan());
      const channelName = newVideos[0]?.channelTitle || input;
      const suffix = skippedCompleted > 0
        ? ` (${t('dash.skippedCompleted', { n: skippedCompleted })})`
        : '';
      setCheckMessage(t('dash.addedNFrom', { n: added, channel: channelName }) + suffix);
      setCheckSuccess(true);
    },
    [t],
  );

  // ── Fetch recent videos from configured channel ───────────
  const handleCheckLatest = useCallback(async () => {
    if (!hasApiKey()) {
      setCheckMessage(t('dash.apiKeyMsg'));
      setCheckSuccess(false);
      return;
    }

    setCheckLoading(true);
    setCheckMessage(null);

    // Sanitize input: trim whitespace, extract handle from URL if needed
    let input = channelPrefs.input.trim();
    if (input.startsWith('http')) {
      // Extract handle or channel ID from YouTube URL
      const match = input.match(/youtube\.com\/(@[\w.-]+|channel\/([\w-]+))/);
      if (match) {
        input = match[2] ? match[2] : match[1];
      }
    }

    if (!input) {
      setCheckMessage(t('dash.noVideos'));
      setCheckSuccess(false);
      setCheckLoading(false);
      return;
    }

    // Normalize channel key for pageToken storage
    const channelKey = input.toLowerCase().replace(/^@/, '');

    try {
      const pageToken = getPageToken(channelKey);
      const result = await getRecentVideosFromChannel(input, 10, pageToken);

      if (result.videos.length === 0) {
        // If we got no results with a pageToken, the page may have expired — reset and retry
        if (pageToken) {
          clearPageToken(channelKey);
          const retryResult = await getRecentVideosFromChannel(input, 10);
          if (retryResult.videos.length === 0) {
            setCheckMessage(t('dash.noVideos'));
            setCheckSuccess(false);
            return;
          }
          return handleVideosResult(retryResult, channelKey, input);
        }
        setCheckMessage(t('dash.noVideos'));
        setCheckSuccess(false);
        return;
      }

      handleVideosResult(result, channelKey, input);
    } catch {
      setCheckMessage(t('dash.fetchError'));
      setCheckSuccess(false);
    } finally {
      setCheckLoading(false);
    }
  }, [channelPrefs.input, t, handleVideosResult]);

  // ── Open a daily plan item in StudyPage ────────────────────
  const handleOpenPlanItem = useCallback(
    (item: DailyPlanItem) => {
      // Mark as studying only if not already completed
      if (item.status !== 'completed') {
        const updated = updateDailyPlanItem(item.id, { status: 'studying' });
        setDailyPlan(updated);
      }

      // Create (or find) a session for this video and save it as current
      const existingSession = sessions.find((s) => s.youtubeId === item.videoId);
      if (existingSession) {
        saveCurrentSession(existingSession);
      } else {
        const now = Date.now();
        const newSession: VideoStudySession = {
          id: `session_${now}`,
          youtubeUrl: item.youtubeUrl,
          youtubeId: item.videoId,
          title: item.title,
          transcriptLines: [],
          createdAt: now,
          updatedAt: now,
          status: 'draft',
        };
        saveCurrentSession(newSession);
      }

      navigate('/study');
    },
    [navigate, sessions],
  );

  // ── Remove a plan item ────────────────────────────────────
  const handleDeletePlanItem = useCallback((id: string) => {
    if (!window.confirm(t('dash.deletePlanItem'))) return;
    const updated = removeDailyPlanItem(id);
    setDailyPlan(updated);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Hero */}
      <div className="mb-6 sm:mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
          {t('dash.welcome')}
        </h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed text-sm sm:text-base">
          {t('dash.subtitle')}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-10">
        <StatCard
          label={t('dash.savedWords')}
          value={vocabulary.length}
          color="amber"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          }
        />
        <StatCard
          label={t('dash.savedSentences')}
          value={sentences.length}
          color="violet"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          }
        />
        <StatCard
          label={t('dash.studySessions')}
          value={sessions.length}
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
            </svg>
          }
        />
        <StatCard
          label={t('dash.todayReview')}
          value={todayCount}
          color="green"
          onClick={() => navigate('/review')}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* ── Check Latest Video + Today's Plan ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-10">
        {/* Check Latest Video card */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 flex flex-col">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
            {t('dash.singleChannel')}
          </p>
          <input
            type="text"
            value={channelPrefs.topic}
            onChange={(e) => handleChannelChange('topic', e.target.value)}
            className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1 w-full px-1 py-0.5 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-indigo-400 focus:outline-none rounded transition-colors bg-transparent"
            placeholder={t('dash.topicPh')}
          />
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className="text-xs text-gray-500">{t('dash.channel')}</span>
            {/* Channel type toggle */}
            <div className="flex rounded-md border border-gray-200 dark:border-slate-600 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (!channelPrefs.input.startsWith('@')) {
                    handleChannelChange('input', '@' + channelPrefs.input);
                  }
                }}
                title={t('dash.handleHint')}
                className={`px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-colors ${
                  channelPrefs.input.startsWith('@')
                    ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {t('dash.handleBtn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (channelPrefs.input.startsWith('@')) {
                    handleChannelChange('input', channelPrefs.input.slice(1));
                  }
                }}
                title={t('dash.channelIdHint')}
                className={`px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-colors border-l border-gray-200 dark:border-slate-600 ${
                  !channelPrefs.input.startsWith('@')
                    ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {t('dash.channelIdBtn')}
              </button>
            </div>
            <input
              type="text"
              value={channelPrefs.input}
              onChange={(e) => handleChannelChange('input', e.target.value)}
              className="text-sm font-mono text-indigo-500 flex-1 min-w-[160px] px-1.5 py-0.5 border border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-indigo-400 focus:outline-none rounded transition-colors bg-transparent"
              placeholder={channelPrefs.input.startsWith('@') ? t('dash.handlePh') : t('dash.channelIdPh')}
            />
            {/* Auto-detected type badge */}
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              channelPrefs.input.startsWith('@')
                ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
                : 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
            }`}>
              {channelPrefs.input.startsWith('@') ? t('dash.handleBadge') : t('dash.idBadge')}
            </span>
          </div>

          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-3">
            {t('dash.fetchHint')}
          </p>

          <button
            onClick={handleCheckLatest}
            disabled={checkLoading}
            className="mt-auto w-full px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {checkLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('dash.fetching')}
              </>
            ) : (
              t('dash.fetchBtn')
            )}
          </button>

          {checkMessage && (
            <p className={`text-xs mt-3 ${
              checkSuccess
                ? 'text-green-600'
                : 'text-amber-600'
            }`}>
              {checkMessage}
            </p>
          )}
        </div>

        {/* Today's Plan list */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              {t('dash.todayPlan')}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500">{dailyPlan.length} {t('dash.items')}</span>
              {dailyPlan.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm(t('dash.clearConfirm'))) {
                      setDailyPlan(clearDailyPlan());
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                  title={t('dash.clearAllTitle')}
                >
                  {t('dash.clear')}
                </button>
              )}
            </div>
          </div>

          {dailyPlan.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">{t('dash.noPlan')}</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                {t('dash.addPlan')}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {dailyPlan.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors group cursor-pointer"
                  onClick={() => handleOpenPlanItem(item)}
                >
                  {/* Thumbnail */}
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-16 h-9 rounded object-cover bg-gray-200 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-9 rounded bg-gray-200 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      </svg>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                      {item.title}
                    </p>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.channelTitle}</span>
                  </div>

                  {/* Status dot */}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      item.status === 'studying'
                        ? 'bg-blue-400'
                        : item.status === 'completed'
                          ? 'bg-green-400'
                          : 'bg-gray-300'
                    }`}
                    title={statusLabel(item.status)}
                  />

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePlanItem(item.id);
                    }}
                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 cursor-pointer"
                    title={t('dash.removeTitle')}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Learning Analytics Charts ──────────────────────── */}
      {hasChartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-10">
          {/* Weekly Activity Bar Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">
              {t('dash.weeklyActivity')}
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyActivityData} barGap={2}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                />
                <Bar dataKey="words" fill="#f59e0b" radius={[3, 3, 0, 0]} name={t('dash.chartWords')} />
                <Bar dataKey="sentences" fill="#8b5cf6" radius={[3, 3, 0, 0]} name={t('dash.chartSentences')} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Vocabulary Mastery Pie Chart */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">
              {t('dash.mastery')}
            </p>
            {masteryData.length > 0 ? (
              <div className="flex items-center">
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie
                      data={masteryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {masteryData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2.5 ml-2">
                  {masteryData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {entry.name}
                      </span>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-gray-400 dark:text-gray-500">
                {t('dash.noVocabData')}
              </div>
            )}
          </div>

          {/* Cumulative Learning Progress Area Chart */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">
              {t('dash.learning30d')}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cumulativeData}>
                <defs>
                  <linearGradient id="colorWords" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSentences" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="words"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorWords)"
                  name={t('dash.chartWords')}
                />
                <Area
                  type="monotone"
                  dataKey="sentences"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSentences)"
                  name={t('dash.chartSentences')}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Continue last session */}
      {currentSession && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-4 sm:p-5 mb-6 sm:mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                {t('dash.continueSession')}
              </p>
              <p className="text-base font-medium text-gray-800 dark:text-gray-200 truncate max-w-md">
                {currentSession.title || currentSession.youtubeUrl}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {currentSession.transcriptLines.length} {t('dash.lines')} &middot;{' '}
                {statusLabel(currentSession.status)} &middot;{' '}
                {t('dash.updated')} {new Date(currentSession.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={handleContinueSession}
              className="w-full sm:w-auto px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer shrink-0"
            >
              {t('dash.continue')}
            </button>
          </div>
        </div>
      )}

      {/* Recent sessions */}
      <div>
        {(() => {
          const activeSessions = sessions.filter((s) => s.status !== 'completed');
          const completedSessions = sessions.filter((s) => s.status === 'completed');
          return (
            <>
              {/* Active sessions */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  {t('dash.recentSessions')}
                </h2>
                <div className="flex items-center gap-3">
                  {completedSessions.length > 0 && (
                    <span className="text-xs text-green-500 dark:text-green-400">
                      {completedSessions.length} {t('dash.statusCompleted')}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500">{sessions.length} {t('dash.total')}</span>
                </div>
              </div>

              {sessions.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-10 text-center">
                  <p className="text-gray-400 dark:text-gray-500 text-sm">{t('dash.noSessions')}</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                    {t('dash.startFirst')}
                  </p>
                </div>
              ) : (
                <>
                  {/* Active sessions list */}
                  {activeSessions.length > 0 && (
                    <div className="space-y-2">
                      {activeSessions.map((s) => (
                        <div
                          key={s.id}
                          className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 group hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
                        >
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => handleOpenSession(s)}
                          >
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                              {s.title || s.youtubeUrl}
                            </p>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">
                                {s.youtubeId}
                              </span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                {s.transcriptLines.length} {t('dash.lines')}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                s.status === 'studying'
                                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600'
                                  : 'bg-gray-100 dark:bg-slate-700 text-gray-500'
                              }`}>
                                {statusLabel(s.status)}
                              </span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                {new Date(s.updatedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 sm:ml-4">
                            <button
                              onClick={() => handleOpenSession(s)}
                              className="px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 dark:bg-indigo-950 rounded-lg hover:bg-indigo-100 transition-colors font-medium cursor-pointer"
                            >
                              {t('dash.open')}
                            </button>
                            <button
                              onClick={() => handleDeleteSession(s.id)}
                              className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              {t('dash.delete')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Completed sessions — collapsible */}
                  {completedSessions.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setShowCompleted(!showCompleted)}
                        className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer mb-2"
                      >
                        <svg
                          className={`w-3.5 h-3.5 transition-transform ${showCompleted ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        {t('dash.completedSessions')} ({completedSessions.length})
                      </button>

                      {showCompleted && (
                        <div className="space-y-1.5">
                          {completedSessions.map((s) => {
                            // Count vocab and sentences for this video
                            const vocabCount = vocabulary.filter((v) => v.sourceVideoId === s.youtubeId).length;
                            const sentCount = sentences.filter((sent) => sent.sourceVideoId === s.youtubeId).length;
                            return (
                              <div
                                key={s.id}
                                className="bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-100 dark:border-slate-700/60 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 group opacity-75 hover:opacity-100 transition-opacity"
                              >
                                <div
                                  className="flex-1 min-w-0 cursor-pointer"
                                  onClick={() => handleOpenSession(s)}
                                >
                                  <div className="flex items-center gap-2">
                                    <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                      {s.title || s.youtubeUrl}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3 mt-1 flex-wrap ml-[1.375rem]">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                      {new Date(s.updatedAt).toLocaleDateString()}
                                    </span>
                                    {vocabCount > 0 && (
                                      <span className="text-[10px] text-amber-500 dark:text-amber-400">
                                        {vocabCount} {t('dash.chartWords')}
                                      </span>
                                    )}
                                    {sentCount > 0 && (
                                      <span className="text-[10px] text-violet-500 dark:text-violet-400">
                                        {sentCount} {t('dash.chartSentences')}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                      {s.transcriptLines.length} {t('dash.lines')}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 sm:ml-4">
                                  <button
                                    onClick={() => handleOpenSession(s)}
                                    className="px-3 py-1 text-[11px] text-gray-500 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors font-medium cursor-pointer"
                                  >
                                    {t('dash.review')}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteSession(s.id)}
                                    className="px-2 py-1 text-[11px] text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                  >
                                    {t('dash.delete')}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

// ─── Stat Card ──────────────────────────────────────────────

const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
  amber:  { bg: 'bg-amber-50 dark:bg-amber-950/30',  text: 'text-amber-700',  iconBg: 'bg-amber-100' },
  violet: { bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700', iconBg: 'bg-violet-100' },
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/40',   text: 'text-blue-700',   iconBg: 'bg-blue-100' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/40',  text: 'text-green-700',  iconBg: 'bg-green-100' },
};

const StatCard: React.FC<{
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  onClick?: () => void;
}> = ({ label, value, color, icon, onClick }) => {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div
      className={`${c.bg} rounded-xl p-5 border border-transparent ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`${c.iconBg} ${c.text} p-2 rounded-lg`}>{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
};

export default DashboardPage;
