import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  planHasVideoId,
  saveCurrentSession,
} from '../utils/storage';
import { getLatestVideoFromChannel, hasApiKey } from '../services/youtubeApi';
import { TARGET_CHANNEL } from '../config/targetChannel';
import type {
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
  DailyPlanItem,
  ChannelVideo,
} from '../types';

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

  useEffect(() => {
    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
    setSessions(loadAllSessions());
    setCurrentSession(loadCurrentSession());
    setDailyPlan(loadDailyPlan());
  }, []);

  // Today's review: items where nextReviewAt <= end of today and not mastered
  const todayCount = useMemo(() => {
    const todayEnd = todayStartMs() + 24 * 60 * 60 * 1000;
    const dueWords = vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= todayEnd).length;
    const dueSentences = sentences.filter((s) => !s.mastered && s.nextReviewAt <= todayEnd).length;
    return dueWords + dueSentences;
  }, [vocabulary, sentences]);

  const handleContinueSession = () => {
    navigate('/study');
  };

  const handleOpenSession = (session: VideoStudySession) => {
    // Save it as the current session so StudyPage restores it
    localStorage.setItem('echolearn_session', JSON.stringify(session));
    navigate('/study');
  };

  const handleDeleteSession = (id: string) => {
    deleteSession(id);
    setSessions(loadAllSessions());
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }
  };

  // ── Check latest video from configured channel ─────────────
  const handleCheckLatest = useCallback(async () => {
    if (!hasApiKey()) {
      setCheckMessage('Please configure VITE_YOUTUBE_API_KEY in .env.local to check latest videos.');
      return;
    }

    setCheckLoading(true);
    setCheckMessage(null);

    try {
      const video: ChannelVideo | null = await getLatestVideoFromChannel(TARGET_CHANNEL.input);

      if (!video) {
        setCheckMessage('Could not fetch the latest video. Check the channel handle or API key.');
        return;
      }

      if (planHasVideoId(video.videoId)) {
        setCheckMessage('Latest video is already in your plan.');
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const item: DailyPlanItem = {
        id: `plan_${Date.now()}`,
        date: today,
        videoId: video.videoId,
        youtubeUrl: video.youtubeUrl,
        title: video.title,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        status: 'planned',
        createdAt: Date.now(),
      };

      const updated = addDailyPlanItem(item);
      setDailyPlan(updated);
      setCheckMessage(`Added: "${video.title}"`);
    } catch {
      setCheckMessage('An error occurred while fetching the latest video.');
    } finally {
      setCheckLoading(false);
    }
  }, []);

  // ── Open a daily plan item in StudyPage ────────────────────
  const handleOpenPlanItem = useCallback(
    (item: DailyPlanItem) => {
      // Mark as studying
      const updated = updateDailyPlanItem(item.id, { status: 'studying' });
      setDailyPlan(updated);

      // Create (or find) a session for this video and save it as current
      const existingSession = sessions.find((s) => s.youtubeId === item.videoId);
      if (existingSession) {
        localStorage.setItem('echolearn_session', JSON.stringify(existingSession));
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

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          Welcome back
        </h1>
        <p className="mt-2 text-gray-500 max-w-2xl leading-relaxed">
          A focused YouTube-based English learning workspace with transcript
          notes, vocabulary, and review.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Saved Words"
          value={vocabulary.length}
          color="amber"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          }
        />
        <StatCard
          label="Saved Sentences"
          value={sentences.length}
          color="violet"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          }
        />
        <StatCard
          label="Study Sessions"
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
          label="Today's Review"
          value={todayCount}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* ── Check Latest Video + Today's Plan ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-10">
        {/* Check Latest Video card */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
            Single Channel
          </p>
          <p className="text-base font-semibold text-gray-800 mb-1">
            {TARGET_CHANNEL.topic}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Channel: <span className="font-mono text-indigo-500">{TARGET_CHANNEL.input}</span>
            {TARGET_CHANNEL.preferredLevel && (
              <span className="ml-2 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-medium">
                {TARGET_CHANNEL.preferredLevel}
              </span>
            )}
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
                Checking...
              </>
            ) : (
              'Check Latest Video'
            )}
          </button>

          {checkMessage && (
            <p className={`text-xs mt-3 ${
              checkMessage.startsWith('Added') || checkMessage.startsWith('Latest video is already')
                ? 'text-green-600'
                : 'text-amber-600'
            }`}>
              {checkMessage}
            </p>
          )}
        </div>

        {/* Today's Plan list */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400 uppercase tracking-wider">
              Today's Plan
            </p>
            <span className="text-xs text-gray-400">{dailyPlan.length} items</span>
          </div>

          {dailyPlan.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-gray-400 text-sm">No videos in your plan yet.</p>
              <p className="text-gray-400 text-xs mt-1">
                Click "Check Latest Video" to add one.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {dailyPlan.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg p-2.5 border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors group cursor-pointer"
                  onClick={() => handleOpenPlanItem(item)}
                >
                  {/* Thumbnail */}
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-20 h-[45px] rounded object-cover bg-gray-200 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-[45px] rounded bg-gray-200 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      </svg>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-400">{item.channelTitle}</span>
                      <span className="text-[11px] text-gray-300">·</span>
                      <span className="text-[11px] text-gray-400">{item.date}</span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                    item.status === 'studying'
                      ? 'bg-blue-100 text-blue-600'
                      : item.status === 'completed'
                        ? 'bg-green-100 text-green-600'
                        : 'bg-gray-100 text-gray-500'
                  }`}>
                    {item.status}
                  </span>

                  {/* Study button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenPlanItem(item);
                    }}
                    className="px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium opacity-0 group-hover:opacity-100 cursor-pointer flex-shrink-0"
                  >
                    Study
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Continue last session */}
      {currentSession && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                Continue Last Session
              </p>
              <p className="text-base font-medium text-gray-800 truncate max-w-md">
                {currentSession.title || currentSession.youtubeUrl}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {currentSession.transcriptLines.length} lines &middot;{' '}
                {currentSession.status} &middot;{' '}
                updated {new Date(currentSession.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={handleContinueSession}
              className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Recent sessions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
            Recent Sessions
          </h2>
          <span className="text-xs text-gray-400">{sessions.length} total</span>
        </div>

        {sessions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <p className="text-gray-400 text-sm">No study sessions yet.</p>
            <p className="text-gray-400 text-xs mt-1">
              Head to <span className="text-indigo-500">Study</span> to start your first session.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center justify-between group hover:border-gray-300 transition-colors"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => handleOpenSession(s)}
                >
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {s.title || s.youtubeUrl}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] font-mono text-gray-400">
                      {s.youtubeId}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {s.transcriptLines.length} lines
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      s.status === 'studying'
                        ? 'bg-blue-100 text-blue-600'
                        : s.status === 'completed'
                          ? 'bg-green-100 text-green-600'
                          : 'bg-gray-100 text-gray-500'
                    }`}>
                      {s.status}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleOpenSession(s)}
                    className="px-3 py-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium cursor-pointer"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => handleDeleteSession(s.id)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Stat Card ──────────────────────────────────────────────

const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  iconBg: 'bg-amber-100' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', iconBg: 'bg-violet-100' },
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   iconBg: 'bg-blue-100' },
  green:  { bg: 'bg-green-50',  text: 'text-green-700',  iconBg: 'bg-green-100' },
};

const StatCard: React.FC<{
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}> = ({ label, value, color, icon }) => {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`${c.bg} rounded-xl p-5 border border-transparent`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`${c.iconBg} ${c.text} p-2 rounded-lg`}>{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
};

export default DashboardPage;
