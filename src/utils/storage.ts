import type { VocabularyItem, SentenceItem, VideoStudySession, DailyPlanItem } from '../types';

const VOCAB_KEY = 'echolearn_vocabulary';
const SENTENCE_KEY = 'echolearn_sentences';
const SESSION_KEY = 'echolearn_session';
const SESSIONS_LIST_KEY = 'echolearn_sessions_list';
const PLAN_KEY = 'echolearn_daily_plan';

// ─── Spaced Repetition Helpers ───────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns unix ms for "tomorrow" at the same time of day. */
export function tomorrowMs(): number {
  return Date.now() + DAY_MS;
}

/** Returns unix ms for the start of today (midnight local). */
export function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Given the current reviewCount (after incrementing),
 * compute the next review date.
 *   1 -> 3 days
 *   2 -> 7 days
 *   3 -> 14 days
 *   4 -> 30 days
 *   >=5 -> mastered (returns 0 to indicate no further review)
 */
export function computeNextReviewAt(reviewCount: number): number {
  const intervals: Record<number, number> = {
    1: 3,
    2: 7,
    3: 14,
    4: 30,
  };
  const days = intervals[reviewCount] ?? 0;
  if (days === 0) return 0; // mastered — no further review
  return Date.now() + days * DAY_MS;
}

// ─── Migration ───────────────────────────────────────────────

/**
 * Migrate legacy VocabularyItem data that used `timestamp` instead of `addedAt`,
 * and was missing `meaningCn` / `mastered` fields.
 */
function migrateVocabItem(raw: Record<string, unknown>): VocabularyItem {
  return {
    id: (raw.id as string) || '',
    word: (raw.word as string) || '',
    meaningCn: (raw.meaningCn as string) || '',
    context: (raw.context as string) || '',
    sourceVideoId: (raw.sourceVideoId as string) || '',
    sourceVideoTitle: (raw.sourceVideoTitle as string) || undefined,
    addedAt: (raw.addedAt as number) ?? (raw.timestamp as number) ?? Date.now(),
    mastered: (raw.mastered as boolean) ?? false,
    reviewCount: (raw.reviewCount as number) ?? 0,
    lastReviewedAt: (raw.lastReviewedAt as number) ?? 0,
    nextReviewAt: (raw.nextReviewAt as number) ?? ((raw.addedAt as number) ?? Date.now()) + DAY_MS,
  };
}

/**
 * Migrate legacy SentenceItem data that used `timestamp` instead of `addedAt`,
 * and was missing `meaningCn` / `myOwnSentence` fields.
 */
function migrateSentenceItem(raw: Record<string, unknown>): SentenceItem {
  return {
    id: (raw.id as string) || '',
    text: (raw.text as string) || '',
    meaningCn: (raw.meaningCn as string) || '',
    sourceVideoId: (raw.sourceVideoId as string) || '',
    sourceVideoTitle: (raw.sourceVideoTitle as string) || undefined,
    startTime: (raw.startTime as number) ?? 0,
    addedAt: (raw.addedAt as number) ?? (raw.timestamp as number) ?? Date.now(),
    myOwnSentence: (raw.myOwnSentence as string) || '',
    mastered: (raw.mastered as boolean) ?? false,
    reviewCount: (raw.reviewCount as number) ?? 0,
    lastReviewedAt: (raw.lastReviewedAt as number) ?? 0,
    nextReviewAt: (raw.nextReviewAt as number) ?? ((raw.addedAt as number) ?? Date.now()) + DAY_MS,
  };
}

// ─── Session ─────────────────────────────────────────────────

/** Load the current (most recent) session, or null if none exists. */
export function loadCurrentSession(): VideoStudySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist the current session. Pass null to clear it. */
export function saveCurrentSession(session: VideoStudySession | null): void {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    const list = loadAllSessions();
    const idx = list.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      list[idx] = session;
    } else {
      list.unshift(session);
    }
    localStorage.setItem(SESSIONS_LIST_KEY, JSON.stringify(list));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

/** Clear the current session entirely. */
export function clearCurrentSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Load all saved sessions (history). */
export function loadAllSessions(): VideoStudySession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Delete a session from the history list by id. */
export function deleteSession(id: string): void {
  const list = loadAllSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSIONS_LIST_KEY, JSON.stringify(list));
  const current = loadCurrentSession();
  if (current && current.id === id) {
    clearCurrentSession();
  }
}

/** Replace the entire sessions list (used by cloud sync). */
export function saveAllSessions(sessions: VideoStudySession[]): void {
  localStorage.setItem(SESSIONS_LIST_KEY, JSON.stringify(sessions));
}

// ─── Vocabulary ──────────────────────────────────────────────

export function loadVocabulary(): VocabularyItem[] {
  try {
    const raw = localStorage.getItem(VOCAB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed.map(migrateVocabItem);
  } catch {
    return [];
  }
}

export function loadVocabularyByVideo(videoId: string): VocabularyItem[] {
  return loadVocabulary().filter((v) => v.sourceVideoId === videoId);
}

export function saveVocabulary(items: VocabularyItem[]): void {
  localStorage.setItem(VOCAB_KEY, JSON.stringify(items));
}

export function addVocabularyItem(item: VocabularyItem): VocabularyItem[] {
  const items = loadVocabulary();
  const itemKey = (item.lemma || item.word).toLowerCase();
  const exists = items.some(
    (v) =>
      (v.lemma || v.word).toLowerCase() === itemKey &&
      v.sourceVideoId === item.sourceVideoId,
  );
  if (exists) return items;
  const updated = [item, ...items];
  saveVocabulary(updated);
  return updated;
}

export function removeVocabularyItem(id: string): VocabularyItem[] {
  const items = loadVocabulary().filter((v) => v.id !== id);
  saveVocabulary(items);
  return items;
}

/** Update a vocabulary item by id (partial merge). */
export function updateVocabularyItem(
  id: string,
  patch: Partial<VocabularyItem>,
): VocabularyItem[] {
  const items = loadVocabulary().map((v) =>
    v.id === id ? { ...v, ...patch } : v,
  );
  saveVocabulary(items);
  return items;
}

// ─── Sentences ───────────────────────────────────────────────

export function loadSentences(): SentenceItem[] {
  try {
    const raw = localStorage.getItem(SENTENCE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed.map(migrateSentenceItem);
  } catch {
    return [];
  }
}

export function loadSentencesByVideo(videoId: string): SentenceItem[] {
  return loadSentences().filter((s) => s.sourceVideoId === videoId);
}

export function saveSentences(items: SentenceItem[]): void {
  localStorage.setItem(SENTENCE_KEY, JSON.stringify(items));
}

export function addSentenceItem(item: SentenceItem): SentenceItem[] {
  const items = loadSentences();
  const exists = items.some(
    (s) => s.text === item.text && s.sourceVideoId === item.sourceVideoId,
  );
  if (exists) return items;
  const updated = [item, ...items];
  saveSentences(updated);
  return updated;
}

export function removeSentenceItem(id: string): SentenceItem[] {
  const items = loadSentences().filter((s) => s.id !== id);
  saveSentences(items);
  return items;
}

/** Update a sentence item by id (partial merge). */
export function updateSentenceItem(
  id: string,
  patch: Partial<SentenceItem>,
): SentenceItem[] {
  const items = loadSentences().map((s) =>
    s.id === id ? { ...s, ...patch } : s,
  );
  saveSentences(items);
  return items;
}

// ─── Daily Plan ──────────────────────────────────────────────

export function loadDailyPlan(): DailyPlanItem[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDailyPlan(items: DailyPlanItem[]): void {
  localStorage.setItem(PLAN_KEY, JSON.stringify(items));
}

export function addDailyPlanItem(item: DailyPlanItem): DailyPlanItem[] {
  const items = loadDailyPlan();
  const exists = items.some((i) => i.videoId === item.videoId);
  if (exists) return items;
  const updated = [item, ...items];
  saveDailyPlan(updated);
  return updated;
}

export function removeDailyPlanItem(id: string): DailyPlanItem[] {
  const items = loadDailyPlan().filter((i) => i.id !== id);
  saveDailyPlan(items);
  return items;
}

export function clearDailyPlan(): DailyPlanItem[] {
  saveDailyPlan([]);
  return [];
}

export function updateDailyPlanItem(
  id: string,
  patch: Partial<DailyPlanItem>,
): DailyPlanItem[] {
  const items = loadDailyPlan().map((i) =>
    i.id === id ? { ...i, ...patch } : i,
  );
  saveDailyPlan(items);
  return items;
}

/** Check whether a videoId already exists in the daily plan. */
export function planHasVideoId(videoId: string): boolean {
  return loadDailyPlan().some((i) => i.videoId === videoId);
}

// ─── Completed Video Tracking ─────────────────────────────────

const COMPLETED_VIDEOS_KEY = 'echolearn_completed_videos';

/** Load the set of permanently completed video IDs. */
export function loadCompletedVideoIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COMPLETED_VIDEOS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Record a video as permanently completed. */
export function addCompletedVideoId(videoId: string): void {
  const ids = loadCompletedVideoIds();
  ids.add(videoId);
  localStorage.setItem(COMPLETED_VIDEOS_KEY, JSON.stringify([...ids]));
}

/** Remove a video from the completed list (e.g. when user resumes studying). */
export function removeCompletedVideoId(videoId: string): void {
  const ids = loadCompletedVideoIds();
  ids.delete(videoId);
  localStorage.setItem(COMPLETED_VIDEOS_KEY, JSON.stringify([...ids]));
}

/** Check whether a video has been completed. */
export function isVideoCompleted(videoId: string): boolean {
  return loadCompletedVideoIds().has(videoId);
}

// ─── Page Token Storage (per channel) ──────────────────────────

const PAGE_TOKEN_KEY = 'echolearn_page_tokens';

type PageTokenMap = Record<string, string>;

function loadPageTokens(): PageTokenMap {
  try {
    const raw = localStorage.getItem(PAGE_TOKEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePageTokens(map: PageTokenMap): void {
  localStorage.setItem(PAGE_TOKEN_KEY, JSON.stringify(map));
}

/** Get the stored nextPageToken for a channel (normalized key). */
export function getPageToken(channelKey: string): string | undefined {
  return loadPageTokens()[channelKey];
}

/** Save a nextPageToken for a channel. */
export function savePageToken(channelKey: string, token: string): void {
  const map = loadPageTokens();
  map[channelKey] = token;
  savePageTokens(map);
}

/** Clear the pageToken for a channel (reset pagination). */
export function clearPageToken(channelKey: string): void {
  const map = loadPageTokens();
  delete map[channelKey];
  savePageTokens(map);
}

// ─── Local Proxy URL ──────────────────────────────────────────

const PROXY_URL_KEY = 'echolearn_local_proxy_url';
const DEFAULT_PROXY_URL = 'https://proxy.echo-learn.uk';

/** Get the configured local proxy URL, or the default. */
export function getLocalProxyUrl(): string {
  return localStorage.getItem(PROXY_URL_KEY) || DEFAULT_PROXY_URL;
}

/** Save a custom local proxy URL. */
export function saveLocalProxyUrl(url: string): void {
  localStorage.setItem(PROXY_URL_KEY, url.replace(/\/+$/, '')); // trim trailing slashes
}

/** Clear the custom proxy URL (reset to default). */
export function clearLocalProxyUrl(): void {
  localStorage.removeItem(PROXY_URL_KEY);
}

/** Check if the local proxy is reachable (quick health check). */
export async function checkLocalProxy(): Promise<{ ok: boolean; error?: string }> {
  const url = getLocalProxyUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, error: data.status };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
