import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type {
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
  DailyPlanItem,
} from '../../types';
import {
  tomorrowMs,
  todayStartMs,
  computeNextReviewAt,
  loadCurrentSession,
  saveCurrentSession,
  clearCurrentSession,
  loadAllSessions,
  deleteSession,
  saveAllSessions,
  loadVocabulary,
  loadVocabularyByVideo,
  saveVocabulary,
  saveSentences,
  addVocabularyItem,
  removeVocabularyItem,
  updateVocabularyItem,
  loadSentences,
  addSentenceItem,
  removeSentenceItem,
  updateSentenceItem,
  loadDailyPlan,
  addDailyPlanItem,
  removeDailyPlanItem,
  updateDailyPlanItem,
  planHasVideoId,
  clearDailyPlan,
  loadCompletedVideoIds,
  addCompletedVideoId,
  removeCompletedVideoId,
  isVideoCompleted,
  getPageToken,
  savePageToken,
  clearPageToken,
  getLocalProxyUrl,
  saveLocalProxyUrl,
  clearLocalProxyUrl,
  getTranslateLang,
  saveTranslateLang,
  clearAllLocalData,
  loadVocabularyTombstones,
  loadSentenceTombstones,
  loadSessionTombstones,
} from '../storage';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Fixtures ──────────────────────────────────────────────────

function makeVocab(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'v1',
    word: 'running',
    lemma: 'run',
    meaningCn: '跑',
    context: 'He was running fast.',
    sourceVideoId: 'vid1',
    addedAt: 1_000,
    mastered: false,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 2_000,
    ...overrides,
  };
}

function makeSentence(overrides: Partial<SentenceItem> = {}): SentenceItem {
  return {
    id: 's1',
    text: 'He was running fast.',
    meaningCn: '他跑得很快。',
    sourceVideoId: 'vid1',
    startTime: 5,
    addedAt: 1_000,
    myOwnSentence: '',
    mastered: false,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 2_000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<VideoStudySession> = {}): VideoStudySession {
  return {
    id: 'sess1',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    youtubeId: 'dQw4w9WgXcQ',
    title: 'Test video',
    transcriptLines: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    status: 'studying',
    ...overrides,
  };
}

function makePlanItem(overrides: Partial<DailyPlanItem> = {}): DailyPlanItem {
  return {
    id: 'p1',
    date: '2026-08-22',
    videoId: 'vid1',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'Test video',
    channelTitle: 'Channel',
    thumbnailUrl: 'https://example.com/t.jpg',
    status: 'planned',
    createdAt: 1_000,
    ...overrides,
  };
}

// ── Test-local window stub (storage dispatches change events) ──

let dispatchedEvents: string[];

beforeEach(() => {
  localStorage.clear();
  dispatchedEvents = [];
  (globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: (e: Event) => {
      dispatchedEvents.push(e.type);
      return true;
    },
  };
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Spaced repetition helpers ─────────────────────────────────

describe('computeNextReviewAt', () => {
  it('follows the 3→7→14→30 day ladder', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00'));
    const now = Date.now();
    expect(computeNextReviewAt(1)).toBe(now + 3 * DAY_MS);
    expect(computeNextReviewAt(2)).toBe(now + 7 * DAY_MS);
    expect(computeNextReviewAt(3)).toBe(now + 14 * DAY_MS);
    expect(computeNextReviewAt(4)).toBe(now + 30 * DAY_MS);
    vi.useRealTimers();
  });

  it('keeps mastered words on a growing maintenance ladder (90/180/365 days)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00'));
    const now = Date.now();
    expect(computeNextReviewAt(5)).toBe(now + 90 * DAY_MS);
    expect(computeNextReviewAt(6)).toBe(now + 180 * DAY_MS);
    expect(computeNextReviewAt(7)).toBe(now + 365 * DAY_MS);
    expect(computeNextReviewAt(8)).toBe(now + 365 * DAY_MS); // stays on longest
    vi.useRealTimers();
  });

  it('returns 0 (never review) for reviewCount 0 or invalid values', () => {
    expect(computeNextReviewAt(0)).toBe(0);
    expect(computeNextReviewAt(-3)).toBe(0);
  });
});

describe('todayStartMs / tomorrowMs', () => {
  it('computes local midnight and now+24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T15:30:45'));
    const midnight = new Date('2026-08-22T00:00:00').getTime();
    expect(todayStartMs()).toBe(midnight);
    expect(tomorrowMs()).toBe(Date.now() + DAY_MS);
    vi.useRealTimers();
  });
});

// ── Sessions ──────────────────────────────────────────────────

describe('session storage', () => {
  it('saves and reloads the current session', () => {
    const s = makeSession();
    saveCurrentSession(s);
    expect(loadCurrentSession()).toEqual(s);
  });

  it('also records the session in the history list', () => {
    saveCurrentSession(makeSession());
    expect(loadAllSessions()).toHaveLength(1);
    expect(dispatchedEvents).toContain('echolearn:sessions-changed');
  });

  it('updates an existing history entry in place instead of duplicating', () => {
    saveCurrentSession(makeSession({ id: 'a', title: 'Before' }));
    saveCurrentSession(makeSession({ id: 'a', title: 'After' }));
    const list = loadAllSessions();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('After');
  });

  it('puts the newest session first in the history list', () => {
    saveCurrentSession(makeSession({ id: 'a' }));
    saveCurrentSession(makeSession({ id: 'b' }));
    const list = loadAllSessions();
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('clearCurrentSession removes only the current session, not the history', () => {
    saveCurrentSession(makeSession());
    clearCurrentSession();
    expect(loadCurrentSession()).toBeNull();
    expect(loadAllSessions()).toHaveLength(1);
  });

  it('notifies consumers when the current session is cleared through saveCurrentSession', () => {
    saveCurrentSession(makeSession());
    dispatchedEvents = [];
    saveCurrentSession(null);
    expect(dispatchedEvents).toContain('echolearn:sessions-changed');
  });

  it('deleteSession removes from history and clears it if it is current', () => {
    saveCurrentSession(makeSession({ id: 'a' }));
    saveCurrentSession(makeSession({ id: 'b' }));
    deleteSession('a');
    expect(loadAllSessions().map((s) => s.id)).toEqual(['b']);
    expect(loadCurrentSession()?.id).toBe('b');
    deleteSession('b');
    expect(loadAllSessions()).toEqual([]);
    expect(loadCurrentSession()).toBeNull();
    expect(loadSessionTombstones()).toEqual({ a: expect.any(Number), b: expect.any(Number) });
  });

  it('deleteSession with an unknown id does not throw', () => {
    saveCurrentSession(makeSession());
    expect(() => deleteSession('nope')).not.toThrow();
    expect(loadAllSessions()).toHaveLength(1);
  });

  it('saveAllSessions replaces the list wholesale (cloud sync path)', () => {
    saveCurrentSession(makeSession({ id: 'a' }));
    saveAllSessions([makeSession({ id: 'x' }), makeSession({ id: 'y' })]);
    expect(loadAllSessions().map((s) => s.id)).toEqual(['x', 'y']);
  });

  it('tolerates corrupted localStorage content', () => {
    localStorage.setItem('echolearn_session', '{broken json');
    localStorage.setItem('echolearn_sessions_list', '[[[');
    expect(loadCurrentSession()).toBeNull();
    expect(loadAllSessions()).toEqual([]);
  });
});

// ── Vocabulary ────────────────────────────────────────────────

describe('vocabulary storage', () => {
  it('starts empty', () => {
    expect(loadVocabulary()).toEqual([]);
  });

  it('adds an item and puts it first', () => {
    addVocabularyItem(makeVocab({ id: 'a', word: 'apple', lemma: 'apple' }));
    addVocabularyItem(makeVocab({ id: 'b', word: 'banana', lemma: 'banana' }));
    expect(loadVocabulary().map((v) => v.word)).toEqual(['banana', 'apple']);
  });

  it('deduplicates by (lemma||word) within the same video', () => {
    addVocabularyItem(makeVocab({ id: 'a', word: 'running', lemma: 'run' }));
    const result = addVocabularyItem(makeVocab({ id: 'b', word: 'runs', lemma: 'run' }));
    expect(result.map((v) => v.id)).toEqual(['a']);
  });

  it('allows the same lemma from different videos', () => {
    addVocabularyItem(makeVocab({ id: 'a', lemma: 'run' }));
    const result = addVocabularyItem(
      makeVocab({ id: 'b', lemma: 'run', sourceVideoId: 'vid2' }),
    );
    expect(result).toHaveLength(2);
  });

  it('deduplicates by word when no lemma is set', () => {
    addVocabularyItem(makeVocab({ id: 'a', word: 'run', lemma: undefined }));
    const result = addVocabularyItem(makeVocab({ id: 'b', word: 'run', lemma: undefined }));
    expect(result.map((v) => v.id)).toEqual(['a']);
  });

  it('removes and updates items by id', () => {
    addVocabularyItem(makeVocab({ id: 'a', lemma: 'apple', word: 'apple' }));
    addVocabularyItem(makeVocab({ id: 'b', word: 'banana', lemma: 'banana' }));
    expect(removeVocabularyItem('a').map((v) => v.id)).toEqual(['b']);
    const updated = updateVocabularyItem('b', { mastered: true });
    expect(updated[0].mastered).toBe(true);
    expect(updated[0].word).toBe('banana'); // merge, not replace
    expect(loadVocabularyTombstones()).toEqual({ a: expect.any(Number) });
  });

  it('filters vocabulary by video', () => {
    addVocabularyItem(makeVocab({ id: 'a', sourceVideoId: 'v1' }));
    addVocabularyItem(makeVocab({ id: 'b', sourceVideoId: 'v2' }));
    expect(loadVocabularyByVideo('v1').map((v) => v.id)).toEqual(['a']);
    expect(loadVocabularyByVideo('nope')).toEqual([]);
  });

  it('dispatches a vocab-changed event on save', () => {
    saveVocabulary([makeVocab()]);
    expect(dispatchedEvents).toContain('echolearn:vocab-changed');
  });

  it('migrates legacy items that used timestamp instead of addedAt', () => {
    const legacy = {
      id: 'old1',
      word: 'cat',
      timestamp: 12345,
      context: 'The cat sat.',
      sourceVideoId: 'vid1',
    };
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([legacy]));
    const items = loadVocabulary();
    expect(items).toHaveLength(1);
    expect(items[0].addedAt).toBe(12345);
    expect(items[0].mastered).toBe(false);
    expect(items[0].meaningCn).toBe('');
  });

  it('preserves valid optional enrichment fields during migration', () => {
    const legacy = {
      id: 'enriched1',
      word: 'running',
      lemma: 'run',
      fullContext: 'He was running fast.',
      sourceVideoId: 'vid1',
      definitionEn: 'moving quickly on foot',
      phonetic: '/rʌn/',
      audioUrl: 'https://example.com/run.mp3',
      partOfSpeech: 'verb',
      example: 'She is running home.',
      synonyms: ['jog'],
      antonyms: ['walk'],
      dictionaryProvider: 'Free Dictionary API',
      sourceTimestamp: 42,
    };
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([legacy]));

    const [item] = loadVocabulary();
    expect(item).toMatchObject({
      lemma: 'run',
      fullContext: 'He was running fast.',
      definitionEn: 'moving quickly on foot',
      phonetic: '/rʌn/',
      audioUrl: 'https://example.com/run.mp3',
      partOfSpeech: 'verb',
      example: 'She is running home.',
      synonyms: ['jog'],
      antonyms: ['walk'],
      dictionaryProvider: 'Free Dictionary API',
      sourceTimestamp: 42,
    });
  });

  it('returns [] when localStorage content is corrupt or not an array', () => {
    localStorage.setItem('echolearn_vocabulary', '{broken json');
    expect(loadVocabulary()).toEqual([]);
    localStorage.setItem('echolearn_vocabulary', '"just a string"');
    expect(loadVocabulary()).toEqual([]);
    localStorage.setItem('echolearn_vocabulary', 'null');
    expect(loadVocabulary()).toEqual([]);
  });
});

// ── Sentences ─────────────────────────────────────────────────

describe('sentence storage', () => {
  it('adds sentences and deduplicates by (text, videoId)', () => {
    addSentenceItem(makeSentence({ id: 'a', text: 'Hello there.' }));
    const dup = addSentenceItem(makeSentence({ id: 'b', text: 'Hello there.' }));
    expect(dup.map((s) => s.id)).toEqual(['a']);
    const other = addSentenceItem(
      makeSentence({ id: 'c', text: 'Hello there.', sourceVideoId: 'vid2' }),
    );
    expect(other).toHaveLength(2);
  });

  it('removes and updates sentences by id', () => {
    addSentenceItem(makeSentence({ id: 'a' }));
    addSentenceItem(makeSentence({ id: 'b', text: 'Second.' }));
    expect(removeSentenceItem('a').map((s) => s.id)).toEqual(['b']);
    const updated = updateSentenceItem('b', { myOwnSentence: 'My own.' });
    expect(updated[0].myOwnSentence).toBe('My own.');
    expect(updated[0].text).toBe('Second.');
    expect(loadSentenceTombstones()).toEqual({ a: expect.any(Number) });
  });

  it('dispatches a sentences-changed event on save', () => {
    saveSentences([makeSentence()]);
    expect(dispatchedEvents).toContain('echolearn:sentences-changed');
  });

  it('tolerates corrupted localStorage content', () => {
    localStorage.setItem('echolearn_sentences', 'not json');
    expect(loadSentences()).toEqual([]);
  });
});

// ── Daily plan ────────────────────────────────────────────────

describe('daily plan storage', () => {
  it('adds plan items and deduplicates by videoId', () => {
    addDailyPlanItem(makePlanItem({ id: 'a', videoId: 'v1' }));
    const dup = addDailyPlanItem(makePlanItem({ id: 'b', videoId: 'v1' }));
    expect(dup.map((p) => p.id)).toEqual(['a']);
    expect(planHasVideoId('v1')).toBe(true);
    expect(planHasVideoId('v2')).toBe(false);
  });

  it('updates and removes plan items', () => {
    addDailyPlanItem(makePlanItem({ id: 'a' }));
    const updated = updateDailyPlanItem('a', { status: 'completed' });
    expect(updated[0].status).toBe('completed');
    expect(removeDailyPlanItem('a')).toEqual([]);
    expect(planHasVideoId('vid1')).toBe(false);
  });

  it('clearDailyPlan empties the plan', () => {
    addDailyPlanItem(makePlanItem({ id: 'a' }));
    expect(clearDailyPlan()).toEqual([]);
    expect(loadDailyPlan()).toEqual([]);
  });

  it('tolerates corrupted localStorage content', () => {
    localStorage.setItem('echolearn_daily_plan', '{{{');
    expect(loadDailyPlan()).toEqual([]);
  });
});

// ── Completed videos ──────────────────────────────────────────

describe('completed video tracking', () => {
  it('records, checks and removes completion', () => {
    expect(isVideoCompleted('v1')).toBe(false);
    addCompletedVideoId('v1');
    addCompletedVideoId('v1'); // idempotent
    expect(isVideoCompleted('v1')).toBe(true);
    expect(loadCompletedVideoIds().size).toBe(1);
    removeCompletedVideoId('v1');
    expect(isVideoCompleted('v1')).toBe(false);
  });

  it('removing an unknown id does not throw', () => {
    expect(() => removeCompletedVideoId('nope')).not.toThrow();
  });

  it('tolerates corrupted localStorage content', () => {
    localStorage.setItem('echolearn_completed_videos', '][');
    expect(loadCompletedVideoIds().size).toBe(0);
  });
});

// ── Page tokens / preferences ─────────────────────────────────

describe('page token storage', () => {
  it('saves, overwrites and clears per-channel tokens', () => {
    expect(getPageToken('chan1')).toBeUndefined();
    savePageToken('chan1', 'tokA');
    expect(getPageToken('chan1')).toBe('tokA');
    savePageToken('chan1', 'tokB');
    expect(getPageToken('chan1')).toBe('tokB');
    savePageToken('chan2', 'other');
    expect(getPageToken('chan2')).toBe('other');
    expect(getPageToken('chan1')).toBe('tokB'); // channels are independent
    clearPageToken('chan1');
    expect(getPageToken('chan1')).toBeUndefined();
    expect(getPageToken('chan2')).toBe('other');
  });

  it('tolerates corrupted localStorage content', () => {
    localStorage.setItem('echolearn_page_tokens', 'nope');
    expect(getPageToken('chan1')).toBeUndefined();
  });
});

describe('preferences', () => {
  it('local proxy URL is empty until explicitly configured', () => {
    expect(getLocalProxyUrl()).toBe('');
  });

  it('saves a custom proxy URL and trims trailing slashes', () => {
    saveLocalProxyUrl('https://my-proxy.dev/');
    expect(getLocalProxyUrl()).toBe('https://my-proxy.dev');
    saveLocalProxyUrl('https://my-proxy.dev///');
    expect(getLocalProxyUrl()).toBe('https://my-proxy.dev');
  });

  it('clearing the proxy URL removes the opt-in configuration', () => {
    saveLocalProxyUrl('https://my-proxy.dev');
    clearLocalProxyUrl();
    expect(getLocalProxyUrl()).toBe('');
  });

  it('translation language defaults to zh and can be changed', () => {
    expect(getTranslateLang()).toBe('zh');
    saveTranslateLang('en');
    localStorage.setItem('echolearn_firebase_last_sync', '123');
    localStorage.setItem('echolearn_firebase_sync_pending', 'true');
    expect(getTranslateLang()).toBe('en');
  });
});

describe('clearAllLocalData', () => {
  it('wipes study data but keeps device preferences', () => {
    addVocabularyItem(makeVocab());
    addSentenceItem(makeSentence());
    saveCurrentSession(makeSession());
    addDailyPlanItem(makePlanItem());
    addCompletedVideoId('v1');
    savePageToken('chan', 'tok');
    saveLocalProxyUrl('https://my-proxy.dev');
    saveTranslateLang('en');

    clearAllLocalData();

    expect(loadVocabulary()).toEqual([]);
    expect(loadSentences()).toEqual([]);
    expect(loadVocabularyTombstones()).toEqual({});
    expect(loadSentenceTombstones()).toEqual({});
    expect(loadSessionTombstones()).toEqual({});
    expect(loadCurrentSession()).toBeNull();
    expect(loadAllSessions()).toEqual([]);
    expect(loadDailyPlan()).toEqual([]);
    expect(loadCompletedVideoIds().size).toBe(0);
    expect(getPageToken('chan')).toBeUndefined();
    // Device preferences deliberately survive.
    expect(getLocalProxyUrl()).toBe('https://my-proxy.dev');
    expect(getTranslateLang()).toBe('en');
    expect(dispatchedEvents).toEqual(expect.arrayContaining([
      'echolearn:vocab-changed',
      'echolearn:sentences-changed',
      'echolearn:sessions-changed',
    ]));
  });
});
