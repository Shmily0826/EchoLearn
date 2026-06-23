import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import {
  loadVocabulary,
  loadSentences,
  updateVocabularyItem,
  updateSentenceItem,
  todayStartMs,
  tomorrowMs,
  computeNextReviewAt,
} from '../utils/storage';
import type { VocabularyItem, SentenceItem } from '../types';

// ─── Swipe gesture hook ─────────────────────────────────────

interface SwipeCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
}

function useSwipeGesture(cbs: SwipeCallbacks, threshold = 60) {
  const startX = useRef(0);
  const startY = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < threshold) return;
    if (absDx > absDy) {
      if (dx < 0) cbs.onSwipeLeft?.();
      else cbs.onSwipeRight?.();
    } else {
      if (dy < 0) cbs.onSwipeUp?.();
    }
  }, [cbs, threshold]);

  return { onTouchStart, onTouchEnd };
}

// ─── Union type for review cards ────────────────────────────

type ReviewCard =
  | { kind: 'word'; item: VocabularyItem }
  | { kind: 'sentence'; item: SentenceItem };

type ReviewMode = 'due' | 'all';
type TypeFilter = 'all' | 'words' | 'sentences';

// ─── ReviewPage ─────────────────────────────────────────────

const ReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [_mode, setMode] = useState<ReviewMode>('due');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sessionActive, setSessionActive] = useState(false);
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ remembered: 0, forgot: 0 });

  useEffect(() => {
    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, []);

  // ── Computed stats ──────────────────────────────────────
  const todayEnd = todayStartMs() + 24 * 60 * 60 * 1000;

  const dueWordCount = useMemo(() => vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= todayEnd).length, [vocabulary, todayEnd]);
  const dueSentenceCount = useMemo(() => sentences.filter((s) => !s.mastered && s.nextReviewAt <= todayEnd).length, [sentences, todayEnd]);
  const dueCount = dueWordCount + dueSentenceCount;

  const unmasteredWordCount = useMemo(() => vocabulary.filter((v) => !v.mastered).length, [vocabulary]);
  const unmasteredSentenceCount = useMemo(() => sentences.filter((s) => !s.mastered).length, [sentences]);
  const unmasteredCount = unmasteredWordCount + unmasteredSentenceCount;

  const masteredCount = useMemo(() => {
    const w = vocabulary.filter((v) => v.mastered).length;
    const s = sentences.filter((ss) => ss.mastered).length;
    return w + s;
  }, [vocabulary, sentences]);

  // ── Start session ──────────────────────────────────────
  const startSession = useCallback(
    (selectedMode: ReviewMode, filter: TypeFilter = 'all') => {
      const due: ReviewCard[] = [];
      const allUnmastered: ReviewCard[] = [];

      if (filter !== 'sentences') {
        for (const v of vocabulary) {
          if (!v.mastered) {
            allUnmastered.push({ kind: 'word', item: v });
            if (v.nextReviewAt <= todayEnd) due.push({ kind: 'word', item: v });
          }
        }
      }
      if (filter !== 'words') {
        for (const s of sentences) {
          if (!s.mastered) {
            allUnmastered.push({ kind: 'sentence', item: s });
            if (s.nextReviewAt <= todayEnd) due.push({ kind: 'sentence', item: s });
          }
        }
      }

      const pool = selectedMode === 'due' ? due : allUnmastered;
      const shuffled = [...pool].sort(() => Math.random() - 0.5);

      setMode(selectedMode);
      setTypeFilter(filter);
      setQueue(shuffled);
      setCurrentIdx(0);
      setRevealed(false);
      setDoneIds(new Set());
      setStats({ remembered: 0, forgot: 0 });
      setSessionActive(true);
    },
    [vocabulary, sentences, todayEnd],
  );

  // ── Card actions ───────────────────────────────────────
  const currentCard = queue[currentIdx];

  const advance = useCallback(() => {
    if (currentIdx + 1 < queue.length) {
      setCurrentIdx((i) => i + 1);
      setRevealed(false);
    } else {
      setSessionActive(false);
    }
  }, [currentIdx, queue.length]);

  const handleRemember = useCallback(() => {
    if (!currentCard) return;
    const newCount = currentCard.item.reviewCount + 1;
    const now = Date.now();
    const nextAt = computeNextReviewAt(newCount);
    const isMastered = newCount >= 5;

    const patch = {
      reviewCount: newCount,
      lastReviewedAt: now,
      nextReviewAt: isMastered ? 0 : nextAt,
      mastered: isMastered,
    };

    if (currentCard.kind === 'word') {
      setVocabulary(updateVocabularyItem(currentCard.item.id, patch));
    } else {
      setSentences(updateSentenceItem(currentCard.item.id, patch));
    }
    setDoneIds((prev) => new Set(prev).add(currentCard.item.id));
    setStats((s) => ({ ...s, remembered: s.remembered + 1 }));
    advance();
  }, [currentCard, advance]);

  const handleForgot = useCallback(() => {
    if (!currentCard) return;
    const patch = {
      reviewCount: currentCard.item.reviewCount,
      lastReviewedAt: Date.now(),
      nextReviewAt: tomorrowMs(),
      mastered: false,
    };

    if (currentCard.kind === 'word') {
      setVocabulary(updateVocabularyItem(currentCard.item.id, patch));
    } else {
      setSentences(updateSentenceItem(currentCard.item.id, patch));
    }
    setDoneIds((prev) => new Set(prev).add(currentCard.item.id));
    setStats((s) => ({ ...s, forgot: s.forgot + 1 }));
    advance();
  }, [currentCard, advance]);

  const handleSkip = useCallback(() => {
    advance();
  }, [advance]);

  // ── Swipe gesture for mobile flashcard interaction ────
  const swipeHandlers = useMemo(() => ({
    onSwipeUp: () => { if (!revealed) setRevealed(true); },
    onSwipeLeft: () => { if (revealed) handleForgot(); },
    onSwipeRight: () => { if (revealed) handleRemember(); },
  }), [revealed, handleForgot, handleRemember]);
  const swipeProps = useSwipeGesture(swipeHandlers);

  // ── Sentence browsing: mark as read and advance ────────
  const handleSentenceRead = useCallback(() => {
    if (!currentCard || currentCard.kind !== 'sentence') return;
    const newCount = currentCard.item.reviewCount + 1;
    const now = Date.now();
    const nextAt = computeNextReviewAt(newCount);
    const isMastered = newCount >= 5;

    const patch = {
      reviewCount: newCount,
      lastReviewedAt: now,
      nextReviewAt: isMastered ? 0 : nextAt,
      mastered: isMastered,
    };

    setSentences(updateSentenceItem(currentCard.item.id, patch));
    setDoneIds((prev) => new Set(prev).add(currentCard.item.id));
    setStats((s) => ({ ...s, remembered: s.remembered + 1 }));
    advance();
  }, [currentCard, advance]);

  // ── Play pronunciation ─────────────────────────────────
  const playAudio = useCallback(() => {
    if (!currentCard) return;
    if (currentCard.kind === 'word' && currentCard.item.audioUrl) {
      new Audio(currentCard.item.audioUrl).play().catch(() => {});
    } else {
      // Use browser TTS for sentences or words without audio
      const text = currentCard.kind === 'word' ? currentCard.item.word : currentCard.item.text;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      }
    }
  }, [currentCard]);

  // ── Reset to landing ────────────────────────────────────
  const handleReset = useCallback(() => {
    setSessionActive(false);
    setDoneIds(new Set());
    setStats({ remembered: 0, forgot: 0 });
    // Reload latest data
    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    if (!sessionActive || !currentCard) return;
    const isSentenceCard = currentCard.kind === 'sentence';

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Sentence browsing mode: no reveal, just advance
      if (isSentenceCard) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === '2') {
          e.preventDefault();
          handleSentenceRead();
        }
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          playAudio();
        }
        return;
      }

      // Word flashcard mode
      if (!revealed) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          setRevealed(true);
        }
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          playAudio();
        }
      } else if (revealed) {
        if (e.key === '1') handleForgot();
        else if (e.key === '2') handleRemember();
        else if (e.key === '3' || e.key === 'ArrowRight') handleSkip();
        else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          playAudio();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessionActive, revealed, currentCard, handleForgot, handleRemember, handleSkip, handleSentenceRead, playAudio]);

  // ── Landing: show stats + mode buttons ─────────────────
  if (!sessionActive) {
    const totalItems = vocabulary.length + sentences.length;

    // Session complete screen
    if (doneIds.size > 0) {
      const accuracy =
        stats.remembered + stats.forgot > 0
          ? Math.round((stats.remembered / (stats.remembered + stats.forgot)) * 100)
          : 0;

      // Recalculate counts after this session
      const newDueCount = (() => {
        const now = Date.now();
        const w = vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= now).length;
        const s = sentences.filter((ss) => !ss.mastered && ss.nextReviewAt <= now).length;
        return w + s;
      })();
      const newUnmasteredCount = vocabulary.filter((v) => !v.mastered).length +
        sentences.filter((ss) => !ss.mastered).length;

      return (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 text-center">
            <svg className="mx-auto w-14 h-14 text-green-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('review.complete')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">{t('review.keepItUp')}</p>
            <div className="grid grid-cols-3 gap-6 mb-8">
              <div>
                <p className="text-3xl font-bold text-indigo-600">{doneIds.size}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.reviewed')}</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-green-600">{accuracy}%</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.accuracy')}</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-amber-600">{stats.forgot}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.toReviewAgain')}</p>
              </div>
            </div>

            {/* Remaining info */}
            {(newDueCount > 0 || newUnmasteredCount > 0) && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                {newDueCount > 0
                  ? `${newDueCount} ${t('review.itemsDue')}`
                  : t('review.noDue')}{' '}
                &middot; {newUnmasteredCount} {t('review.unmasteredTotal')}
              </p>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {newDueCount > 0 && (
                <button
                  onClick={() => {
                    handleReset();
                    setTimeout(() => startSession('due', typeFilter), 50);
                  }}
                  className="w-full px-5 py-3 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
                >
                  {t('review.continueDue', { n: newDueCount })}
                </button>
              )}
              {newUnmasteredCount > 0 && newUnmasteredCount !== newDueCount && (
                <button
                  onClick={() => {
                    handleReset();
                    setTimeout(() => startSession('all', typeFilter), 50);
                  }}
                  className="w-full px-5 py-3 text-sm bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
                >
                  {t('review.allUnmasBtn', { n: newUnmasteredCount })}
                </button>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => navigate('/vocabulary')}
                  className="flex-1 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
                >
                  {t('vocab.title')}
                </button>
                <button
                  onClick={() => navigate('/sentences')}
                  className="flex-1 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
                >
                  {t('review.sentences')}
                </button>
                <button
                  onClick={() => navigate('/')}
                  className="flex-1 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
                >
                  {t('review.dashboard')}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Landing screen
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{t('review.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('review.subtitle')}
          </p>
        </div>

        {totalItems === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 text-center">
            <p className="text-gray-400 dark:text-gray-500 text-sm">{t('review.noItems')}</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
              {t('review.saveFirst')}
            </p>
            <button
              onClick={() => navigate('/study')}
              className="mt-4 px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
            >
              {t('review.goStudy')}
            </button>
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-amber-600">{dueCount}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.dueToday')}</p>
                <p className="text-[10px] text-gray-300 dark:text-gray-500 mt-0.5">{dueWordCount}W / {dueSentenceCount}S</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-indigo-600">{unmasteredCount}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.unmastered')}</p>
                <p className="text-[10px] text-gray-300 dark:text-gray-500 mt-0.5">{unmasteredWordCount}W / {unmasteredSentenceCount}S</p>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{masteredCount}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('review.mastered')}</p>
              </div>
            </div>

            {/* Type filter */}
            <div className="flex gap-1 mb-6">
              {([
                { key: 'all' as TypeFilter, label: t('review.mixed') },
                { key: 'words' as TypeFilter, label: t('review.wordsOnly') },
                { key: 'sentences' as TypeFilter, label: t('review.sentOnly') },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTypeFilter(key)}
                  className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                    typeFilter === key
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Start buttons */}
            <div className="space-y-3">
              <button
                onClick={() => startSession('due', typeFilter)}
                disabled={dueCount === 0 || (typeFilter === 'words' && dueWordCount === 0) || (typeFilter === 'sentences' && dueSentenceCount === 0)}
                className="w-full px-5 py-4 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-left flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold">{t('review.reviewDue')}</p>
                  <p className="text-xs text-indigo-200 mt-0.5">
                    {t('review.spacedHint')}
                  </p>
                </div>
                <span className="text-lg font-bold">
                  {typeFilter === 'words' ? dueWordCount : typeFilter === 'sentences' ? dueSentenceCount : dueCount}
                </span>
              </button>

              <button
                onClick={() => startSession('all', typeFilter)}
                disabled={unmasteredCount === 0 || (typeFilter === 'words' && unmasteredWordCount === 0) || (typeFilter === 'sentences' && unmasteredSentenceCount === 0)}
                className="w-full px-5 py-4 text-sm bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-left flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold">{t('review.allUnmastered')}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {t('review.allHint')}
                  </p>
                </div>
                <span className="text-lg font-bold text-gray-400">
                  {typeFilter === 'words' ? unmasteredWordCount : typeFilter === 'sentences' ? unmasteredSentenceCount : unmasteredCount}
                </span>
              </button>
            </div>

            {/* Keyboard hint — hidden on mobile */}
            <p className="hidden sm:block text-[11px] text-gray-400 dark:text-gray-500 mt-6 text-center">
              Keyboard shortcuts: Space/R Reveal &middot; P Play &middot; 1 Forgot &middot; 2 Remember &middot; 3 Skip
            </p>
          </>
        )}
      </div>
    );
  }

  // ── Active session: flashcard UI ────────────────────────
  const total = queue.length;
  const progress = total > 0 ? ((currentIdx + (revealed ? 0.5 : 0)) / total) * 100 : 0;

  if (!currentCard) {
    setSessionActive(false);
    return null;
  }

  const primaryText = currentCard.kind === 'word' ? currentCard.item.word : currentCard.item.text;
  const meaningCn = currentCard.item.meaningCn;
  const context = currentCard.kind === 'word' ? currentCard.item.context : undefined;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Progress */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">
          {currentIdx + 1} / {total}
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-600">{stats.remembered} {t('review.remembered')}</span>
          <span className="text-red-500">{stats.forgot} {t('review.forgot')}</span>
          <button
            onClick={() => setSessionActive(false)}
            className="text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            {t('review.end')}
          </button>
        </div>
      </div>
      <div className="w-full h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full mb-8 overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Flashcard */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-8 shadow-sm min-h-[300px] flex flex-col">
        {/* Header badge */}
        <div className="flex items-start justify-between mb-6">
          <span
            className={`shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full ${
              currentCard.kind === 'word'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-violet-100 text-violet-700'
            }`}
          >
            {currentCard.kind === 'word' ? t('review.word') : t('review.sentence')}
          </span>
          {currentCard.item.reviewCount > 0 && (
            <span className="text-[10px] text-gray-400">
              {currentCard.item.reviewCount}x reviewed
            </span>
          )}
        </div>

        {/* ── Sentence browsing mode: show everything at once ── */}
        {currentCard.kind === 'sentence' ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-start gap-3 mb-6">
              <p className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed flex-1">
                {primaryText}
              </p>
              <button
                onClick={playAudio}
                className="shrink-0 p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                title="Play pronunciation (P)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                  <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                </svg>
              </button>
            </div>
            {meaningCn && (
              <p className="text-lg text-indigo-700 font-medium mb-4">{meaningCn}</p>
            )}
            {currentCard.item.myOwnSentence && (
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-4 py-3 mb-4">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">{t('sent.myOwn')}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{currentCard.item.myOwnSentence}</p>
              </div>
            )}
            <div className="mt-auto pt-4 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={handleSentenceRead}
                className="w-full px-4 py-3 text-sm bg-indigo-50 dark:bg-indigo-950 text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors font-medium cursor-pointer"
              >
                {t('review.next')} <span className="hidden sm:inline text-[10px] text-indigo-400 ml-1">Space / Enter</span>
              </button>
            </div>
          </div>
        ) : (
          /* ── Word flashcard mode: reveal then judge ── */
          <div className="flex-1 flex flex-col" {...swipeProps}>
            <div className="flex items-start gap-3 mb-8">
              <p className="text-3xl font-bold text-gray-800 dark:text-gray-200 leading-relaxed flex-1">
                {primaryText}
              </p>
              <button
                onClick={playAudio}
                className="shrink-0 p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                title="Play pronunciation (P)"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.5 3.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5a.75.75 0 01-1.085-.674V3.75z" />
                  <path d="M3.5 8.75a.75.75 0 011.085-.674l6.75 3.5a.75.75 0 010 1.348l-6.75 3.5A.75.75 0 013.5 15.75V8.75z" />
                </svg>
              </button>
            </div>

            {/* Answer (hidden until revealed) */}
            {revealed ? (
              <div className="space-y-3 mb-6 animate-[fadeIn_0.2s_ease-out]">
                {meaningCn && (
                  <p className="text-xl text-indigo-700 font-medium">{meaningCn}</p>
                )}
                {context && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">&ldquo;{context}&rdquo;</p>
                )}
                {currentCard.item.definitionEn && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                    {currentCard.item.definitionEn}
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={() => setRevealed(true)}
                className="mb-6 px-6 py-3 text-sm text-indigo-600 bg-indigo-50 dark:bg-indigo-950 rounded-xl hover:bg-indigo-100 transition-colors font-medium cursor-pointer"
              >
                {t('review.showAnswer')} <span className="text-[10px] text-indigo-400 ml-1">R</span>
              </button>
            )}

            {/* Action buttons — only visible after reveal */}
            {revealed && (
              <div className="mt-auto flex gap-3 pt-4 border-t border-gray-100 dark:border-slate-700">
                <button
                  onClick={handleForgot}
                  className="flex-1 px-4 py-3 text-sm bg-red-50 dark:bg-red-950/30 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-colors font-medium cursor-pointer"
                >
                  {t('review.forgotBtn')} <span className="hidden sm:inline text-[10px] text-red-400 ml-1">1</span>
                </button>
                <button
                  onClick={handleRemember}
                  className="flex-1 px-4 py-3 text-sm bg-green-50 text-green-700 border border-green-200 rounded-xl hover:bg-green-100 transition-colors font-medium cursor-pointer"
                >
                  {t('review.rememberBtn')} <span className="hidden sm:inline text-[10px] text-green-400 ml-1">2</span>
                </button>
                <button
                  onClick={handleSkip}
                  className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors font-medium cursor-pointer"
                >
                  {t('review.skip')} <span className="hidden sm:inline text-[10px] text-gray-400 ml-1">3</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mobile swipe hint */}
        <p className="sm:hidden text-[10px] text-gray-400 dark:text-gray-500 mt-3 text-center">
          {revealed ? t('review.swipeJudge') : t('review.swipeReveal')}
        </p>
      </div>

      {/* Keyboard hint — hidden on mobile */}
      <p className="hidden sm:block text-[11px] text-gray-400 dark:text-gray-500 mt-4 text-center">
        {currentCard.kind === 'sentence'
          ? 'Space / Enter for next \u00B7 P Play'
          : revealed
            ? '1 Forgot \u00B7 2 Remember \u00B7 3 Skip \u00B7 P Play'
            : 'Space / R to reveal \u00B7 P Play'}
      </p>
    </div>
  );
};

export default ReviewPage;
