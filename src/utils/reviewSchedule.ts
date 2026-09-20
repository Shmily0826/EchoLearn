import { todayStartMs } from './storage';

/** Anything the review schedule tracks. */
export interface ScheduledItem {
  mastered?: boolean;
  nextReviewAt: number;
}

export type ReviewCardOf<TW extends ScheduledItem, TS extends ScheduledItem> =
  | { kind: 'word'; item: TW }
  | { kind: 'sentence'; item: TS };

export type ReviewTypeFilter = 'all' | 'words' | 'sentences';

/**
 * The whole day is the due window: an item scheduled for today is due now, even
 * if its slot earlier in the day has already passed.
 */
export function reviewWindowEnd(): number {
  return todayStartMs() + 24 * 60 * 60 * 1000;
}

/**
 * `nextReviewAt: 0` on a non-mastered item means it was never scheduled — legacy
 * rows predating the schedule. They are reported as unscheduled rather than due
 * and are not bulk-mutated at read time.
 */
export function isUnscheduled(item: ScheduledItem): boolean {
  return !item.mastered && !(item.nextReviewAt > 0);
}

/**
 * The single definition of "due" used by the Dashboard count, the Review landing
 * count and the Review queue itself. Mastered items re-enter once their
 * long-term refresher interval elapses.
 */
export function isDue(item: ScheduledItem, windowEnd: number = reviewWindowEnd()): boolean {
  return item.nextReviewAt > 0 && item.nextReviewAt <= windowEnd;
}

/** Collect the cards a session of this type filter covers, in store order. */
export function collectReviewCards<TW extends ScheduledItem, TS extends ScheduledItem>(
  vocabulary: TW[],
  sentences: TS[],
  filter: ReviewTypeFilter,
): Array<ReviewCardOf<TW, TS>> {
  const cards: Array<ReviewCardOf<TW, TS>> = [];
  if (filter !== 'sentences') {
    for (const v of vocabulary) cards.push({ kind: 'word' as const, item: v });
  }
  if (filter !== 'words') {
    for (const s of sentences) cards.push({ kind: 'sentence' as const, item: s });
  }
  return cards;
}

/** The 'due' pool — counts and queues both come from here, so they cannot drift. */
export function selectDueCards<TW extends ScheduledItem, TS extends ScheduledItem>(
  vocabulary: TW[],
  sentences: TS[],
  filter: ReviewTypeFilter,
  windowEnd: number = reviewWindowEnd(),
): Array<ReviewCardOf<TW, TS>> {
  return collectReviewCards(vocabulary, sentences, filter).filter((c) => isDue(c.item, windowEnd));
}
