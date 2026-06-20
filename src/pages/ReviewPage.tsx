import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ─── Union type for review cards ────────────────────────────

type ReviewCard =
  | { kind: 'word'; item: VocabularyItem }
  | { kind: 'sentence'; item: SentenceItem };

// ─── ReviewPage ─────────────────────────────────────────────

const ReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVocabulary(loadVocabulary());
    setSentences(loadSentences());
  }, []);

  // Items due for review today (nextReviewAt <= today's end, not mastered)
  const dueCards: ReviewCard[] = useMemo(() => {
    const todayEnd = todayStartMs() + 24 * 60 * 60 * 1000;
    const dueWords: ReviewCard[] = vocabulary
      .filter((v) => !v.mastered && v.nextReviewAt <= todayEnd && !doneIds.has(v.id))
      .map((item) => ({ kind: 'word' as const, item }));
    const dueSentences: ReviewCard[] = sentences
      .filter((s) => !s.mastered && s.nextReviewAt <= todayEnd && !doneIds.has(s.id))
      .map((item) => ({ kind: 'sentence' as const, item }));
    // Shuffle
    return [...dueWords, ...dueSentences].sort(() => Math.random() - 0.5);
  }, [vocabulary, sentences, doneIds]);

  const totalDue = useMemo(() => {
    const todayEnd = todayStartMs() + 24 * 60 * 60 * 1000;
    const w = vocabulary.filter((v) => !v.mastered && v.nextReviewAt <= todayEnd).length;
    const s = sentences.filter((ss) => !ss.mastered && ss.nextReviewAt <= todayEnd).length;
    return w + s;
  }, [vocabulary, sentences]);

  // ── Remember handler ───────────────────────────────────────
  const handleRemember = useCallback(
    (card: ReviewCard) => {
      const newCount = card.item.reviewCount + 1;
      const now = Date.now();
      const nextAt = computeNextReviewAt(newCount);
      const isMastered = newCount >= 5;

      const patch = {
        reviewCount: newCount,
        lastReviewedAt: now,
        nextReviewAt: isMastered ? 0 : nextAt,
        mastered: isMastered,
      };

      if (card.kind === 'word') {
        setVocabulary(updateVocabularyItem(card.item.id, patch));
      } else {
        setSentences(updateSentenceItem(card.item.id, patch));
      }
      setDoneIds((prev) => new Set(prev).add(card.item.id));
    },
    [],
  );

  // ── Forgot handler ────────────────────────────────────────
  const handleForgot = useCallback(
    (card: ReviewCard) => {
      const patch = {
        reviewCount: card.item.reviewCount, // no increment
        lastReviewedAt: Date.now(),
        nextReviewAt: tomorrowMs(),
        mastered: false,
      };

      if (card.kind === 'word') {
        setVocabulary(updateVocabularyItem(card.item.id, patch));
      } else {
        setSentences(updateSentenceItem(card.item.id, patch));
      }
      setDoneIds((prev) => new Set(prev).add(card.item.id));
    },
    [],
  );

  // ── Empty state ────────────────────────────────────────────
  if (vocabulary.length === 0 && sentences.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-6">Review</h1>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">No items to review yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Save some words or sentences during your study sessions first.
          </p>
          <button
            onClick={() => navigate('/study')}
            className="mt-4 px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
          >
            Go to Study
          </button>
        </div>
      </div>
    );
  }

  const remaining = dueCards.length;
  const reviewed = totalDue - remaining;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Review</h1>
        <p className="text-sm text-gray-500 mt-1">
          {remaining > 0
            ? `${remaining} items remaining \u00B7 ${reviewed} reviewed today`
            : `All done! ${reviewed} items reviewed today.`}
        </p>
      </div>

      {remaining === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <div className="text-4xl mb-3">
            <svg className="mx-auto w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">You're all caught up!</p>
          <p className="text-gray-400 text-xs mt-1">
            {totalDue > 0
              ? 'Come back tomorrow for your next review session.'
              : 'No items are due for review today.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {dueCards.map((card) => (
            <ReviewItemCard
              key={card.item.id}
              card={card}
              onRemember={handleRemember}
              onForgot={handleForgot}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Single Review Card ─────────────────────────────────────

const ReviewItemCard: React.FC<{
  card: ReviewCard;
  onRemember: (card: ReviewCard) => void;
  onForgot: (card: ReviewCard) => void;
}> = ({ card, onRemember, onForgot }) => {
  const [revealed, setRevealed] = useState(false);
  const { item, kind } = card;

  const primaryText = kind === 'word' ? item.word : item.text;
  const meaningCn = item.meaningCn;
  const context = kind === 'word' ? item.context : undefined;
  const reviewCount = item.reviewCount;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
      {/* Front: word or sentence */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-800">{primaryText}</span>
          <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
            kind === 'word'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-violet-100 text-violet-700'
          }`}>
            {kind === 'word' ? 'word' : 'sentence'}
          </span>
          {reviewCount > 0 && (
            <span className="text-[10px] text-gray-400">
              reviewed {reviewCount}x
            </span>
          )}
        </div>
      </div>

      {/* Answer area */}
      {revealed ? (
        <div className="mb-4 space-y-2">
          {meaningCn && (
            <p className="text-sm text-indigo-700 font-medium">{meaningCn}</p>
          )}
          {context && (
            <p className="text-sm text-gray-600 leading-relaxed">"{context}"</p>
          )}
          {kind === 'sentence' && (
            <p className="text-xs text-gray-400">
              Source: {item.sourceVideoId}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="mb-4 px-4 py-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium cursor-pointer"
        >
          Show Answer
        </button>
      )}

      {/* Action buttons — only visible after reveal */}
      {revealed && (
        <div className="flex gap-3">
          <button
            onClick={() => onForgot(card)}
            className="flex-1 px-4 py-2.5 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium cursor-pointer"
          >
            Forgot
          </button>
          <button
            onClick={() => onRemember(card)}
            className="flex-1 px-4 py-2.5 text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors font-medium cursor-pointer"
          >
            Remember
          </button>
        </div>
      )}
    </div>
  );
};

export default ReviewPage;
