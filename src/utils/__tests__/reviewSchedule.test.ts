import { describe, expect, it } from 'vitest';
import {
  collectReviewCards,
  isDue,
  isUnscheduled,
  reviewWindowEnd,
  selectDueCards,
} from '../reviewSchedule';

const DAY = 24 * 60 * 60 * 1000;

const word = (id: string, over: Partial<{ nextReviewAt: number; mastered: boolean }> = {}) => ({
  id,
  mastered: false,
  nextReviewAt: 0,
  ...over,
});

describe('reviewSchedule — the one definition of due', () => {
  const windowEnd = reviewWindowEnd();

  it('treats an item scheduled earlier today as due', () => {
    expect(isDue(word('a', { nextReviewAt: windowEnd - DAY }), windowEnd)).toBe(true);
  });

  it('treats an item scheduled later today as due', () => {
    expect(isDue(word('a', { nextReviewAt: windowEnd - 1_000 }), windowEnd)).toBe(true);
  });

  it('does not treat a future item as due', () => {
    expect(isDue(word('a', { nextReviewAt: windowEnd + DAY }), windowEnd)).toBe(false);
  });

  it('does not treat an unscheduled item as due (this is what made the counts lie)', () => {
    expect(isDue(word('a', { nextReviewAt: 0 }), windowEnd)).toBe(false);
  });

  it('lets a mastered item become due again as a refresher', () => {
    expect(isDue(word('a', { nextReviewAt: windowEnd - 1_000, mastered: true }), windowEnd)).toBe(true);
  });

  it('reports a non-mastered zero as unscheduled but a mastered zero as mastered', () => {
    expect(isUnscheduled(word('a', { nextReviewAt: 0 }))).toBe(true);
    expect(isUnscheduled(word('a', { nextReviewAt: 0, mastered: true }))).toBe(false);
    expect(isUnscheduled(word('a', { nextReviewAt: windowEnd }))).toBe(false);
  });
});

describe('reviewSchedule — one pool for counts and queues', () => {
  const windowEnd = reviewWindowEnd();
  const vocabulary = [
    word('due-word', { nextReviewAt: windowEnd - 1_000 }),
    word('future-word', { nextReviewAt: windowEnd + DAY }),
    word('legacy-word', { nextReviewAt: 0 }),
    word('mastered-refresher', { nextReviewAt: windowEnd - 1_000, mastered: true }),
  ];
  const sentences = [
    word('due-sentence', { nextReviewAt: windowEnd - 1_000 }),
    word('future-sentence', { nextReviewAt: windowEnd + DAY }),
  ];

  it('selects the same cards a due session would queue', () => {
    const due = selectDueCards(vocabulary, sentences, 'all', windowEnd);
    expect(due.map((c) => c.item.id)).toEqual(['due-word', 'mastered-refresher', 'due-sentence']);
    expect(due.length).toBe(3);
  });

  it('keeps the type filter honest about both kinds', () => {
    expect(selectDueCards(vocabulary, sentences, 'words', windowEnd).every((c) => c.kind === 'word')).toBe(true);
    expect(selectDueCards(vocabulary, sentences, 'sentences', windowEnd).every((c) => c.kind === 'sentence')).toBe(true);
    expect(collectReviewCards(vocabulary, sentences, 'sentences').length).toBe(2);
    expect(collectReviewCards(vocabulary, sentences, 'all').length).toBe(6);
  });

  it('labels the full pool as the full pool, not as the unmastered subset', () => {
    const all = collectReviewCards(vocabulary, sentences, 'all');
    const unmastered = all.filter((c) => !c.item.mastered).length;
    expect(all.length).toBe(6);
    expect(unmastered).toBe(5);
  });
});
