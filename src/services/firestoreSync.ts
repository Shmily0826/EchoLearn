/**
 * Firestore-based cloud sync.
 *
 * Data structure:
 *   users/{uid}/data/{collection}
 *     where collection is: vocabulary | sentences | sessions
 *     each document: { items: [...], updatedAt: <timestamp ms> }
 *     (dailyPlan is intentionally excluded from sync — it is local-only)
 *
 * Merge strategy:
 *   - Compare local + cloud items by id
 *   - Items only in local  → keep
 *   - Items only in cloud  → keep
 *   - Items in both        → keep the one with the later updatedAt
 *                             (or the cloud version if timestamps are equal)
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  deleteDoc,
  getDocs,
  query,
  where,
  collection,
} from 'firebase/firestore';
import type { DocumentReference, DocumentData } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  loadVocabulary,
  saveVocabulary,
  loadSentences,
  saveSentences,
  loadAllSessions,
  saveAllSessions,
  loadCurrentSession,
  saveCurrentSession,
} from '../utils/storage';
import type {
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
} from '../types';

// ── Types ──────────────────────────────────────────────────────

type SyncCollection = 'vocabulary' | 'sentences' | 'sessions' | 'dailyPlan';

interface CloudDoc<T> {
  items: T[];
  updatedAt: number;
}

export interface SyncResult {
  ok: boolean;
  counts?: Record<string, number>;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────

const LAST_SYNC_KEY = 'echolearn_firebase_last_sync';
const SYNC_PENDING_KEY = 'echolearn_firebase_sync_pending';

function getCollectionRef(uid: string, collection: SyncCollection): DocumentReference<DocumentData> {
  return doc(db, 'users', uid, 'data', collection);
}

/**
 * Cloud writes are only allowed for email-verified accounts (see
 * firestore.rules). Throw early so the caller can surface a clear message
 * instead of a confusing permission-denied error.
 */
function assertVerified(uid: string): void {
  const u = auth.currentUser;
  if (!u || u.uid !== uid || !u.emailVerified) {
    throw new Error('auth/email-not-verified');
  }
}

/**
 * Delete all cloud data belonging to a user (their sync docs + any feedback
 * they submitted). Used by account deletion. Best-effort: errors are surfaced
 * to the caller but do not abort the surrounding deletion flow.
 */
export async function deleteUserData(uid: string): Promise<void> {
  const collections: SyncCollection[] = ['vocabulary', 'sentences', 'sessions'];
  await Promise.allSettled(collections.map((c) => deleteDoc(getCollectionRef(uid, c))));

  const fbSnap = await getDocs(
    query(collection(db, 'feedback'), where('userId', '==', uid)),
  );
  await Promise.allSettled(fbSnap.docs.map((d) => deleteDoc(d.ref)));
}

/**
 * Merge two arrays of items by `id` field.
 * For duplicates, keep the item with the later `updatedAt`/`addedAt`
 * (or the cloud version on a tie).
 */
export function mergeById<T extends { id: string; addedAt?: number; updatedAt?: number }>(
  local: T[],
  cloud: T[],
): T[] {
  const map = new Map<string, T>();

  // Cloud items first
  for (const item of cloud) {
    map.set(item.id, item);
  }

  // Local items: add if missing, or replace if local is newer
  for (const item of local) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      // Keep whichever was mutated more recently; prefer cloud on tie.
      const localTime = item.updatedAt ?? item.addedAt ?? 0;
      const cloudTime = existing.updatedAt ?? existing.addedAt ?? 0;
      if (localTime > cloudTime) {
        map.set(item.id, item);
      }
      // else keep cloud version
    }
  }

  return Array.from(map.values());
}

/**
 * Merge sessions list — sessions have id + createdAt instead of addedAt.
 */
function mergeSessions(
  local: VideoStudySession[],
  cloud: VideoStudySession[],
): VideoStudySession[] {
  const map = new Map<string, VideoStudySession>();

  for (const s of cloud) {
    map.set(s.id, s);
  }

  for (const s of local) {
    const existing = map.get(s.id);
    if (!existing) {
      map.set(s.id, s);
    } else {
      const localTime = s.updatedAt ?? s.createdAt ?? 0;
      const cloudTime = existing.updatedAt ?? existing.createdAt ?? 0;
      if (localTime > cloudTime) {
        map.set(s.id, s);
      } else {
        // Cloud wins on timestamp, but it may have heavy fields stripped.
        // Restore transcriptData / transcriptLines / aiAnalysis from local.
        map.set(s.id, {
          ...existing,
          transcriptData: existing.transcriptData ?? s.transcriptData,
          transcriptLines:
            existing.transcriptLines && existing.transcriptLines.length > 0
              ? existing.transcriptLines
              : s.transcriptLines,
          aiAnalysis: existing.aiAnalysis ?? s.aiAnalysis,
        });
      }
    }
  }

  // Sort by createdAt desc
  return Array.from(map.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ── Collect local data ─────────────────────────────────────────

interface AllLocalData {
  vocabulary: VocabularyItem[];
  sentences: SentenceItem[];
  sessions: VideoStudySession[];
}

function collectLocalData(): AllLocalData {
  return {
    vocabulary: loadVocabulary(),
    sentences: loadSentences(),
    sessions: loadAllSessions(),
  };
}

// ── Firestore-safe helpers ──────────────────────────────────────

/**
 * Remove all keys whose value is `undefined` from an object.
 * Firestore setDoc() rejects `{ field: undefined }` — the key must
 * not exist at all.  This utility makes any object safe to write.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Strip heavy fields from a session so it stays under Firestore's 1 MB
 * document limit.  Uses destructuring to *omit* the keys entirely
 * (setting them to `undefined` would make Firestore reject the write).
 */
function stripSession(s: VideoStudySession): VideoStudySession {
  // The omitted values are intentional: transcript fields can exceed
  // Firestore's document limit and are retained locally instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { transcriptData, transcriptLines, aiAnalysis, ...lightweight } = s;
  return stripUndefined(lightweight as Record<string, unknown>) as unknown as VideoStudySession;
}

// ── Upload ─────────────────────────────────────────────────────

async function uploadCollection<T extends { id: string }>(
  uid: string,
  collection: SyncCollection,
  items: T[],
): Promise<void> {
  const ref = getCollectionRef(uid, collection);
  // Strip undefined values from every item to prevent Firestore errors
  const cleanItems = items.map((item) => stripUndefined(item as Record<string, unknown>));
  await setDoc(ref, {
    items: cleanItems,
    updatedAt: Date.now(),
    serverUpdatedAt: serverTimestamp(),
  });
}

/**
 * Upload all local data to Firestore.
 */
export async function uploadToCloud(uid: string): Promise<SyncResult> {
  try {
    assertVerified(uid);
    const data = collectLocalData();
    console.log('[Sync] Upload →', { uid, vocab: data.vocabulary.length, sentences: data.sentences.length, sessions: data.sessions.length });

    const results = await Promise.allSettled([
      uploadCollection(uid, 'vocabulary', data.vocabulary),
      uploadCollection(uid, 'sentences', data.sentences),
      uploadCollection(uid, 'sessions', data.sessions.map(stripSession)),
    ]);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message ?? String(r.reason));

    if (errors.length === results.length) {
      // All failed
      console.error('[Sync] Upload FAILED (all):', errors);
      markSyncPending();
      return { ok: false, error: errors.join('; ') };
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    if (errors.length > 0) markSyncPending();
    else localStorage.removeItem(SYNC_PENDING_KEY);

    if (errors.length > 0) {
      console.warn('[Sync] Upload partial:', errors);
    } else {
      console.log('[Sync] Upload OK');
    }

    const result: SyncResult = {
      ok: true,
      counts: {
        vocabulary: data.vocabulary.length,
        sentences: data.sentences.length,
        sessions: data.sessions.length,
      },
    };
    if (errors.length > 0) {
      result.error = errors.join('; ');
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Download + Merge ───────────────────────────────────────────

async function downloadCollection<T>(
  uid: string,
  collection: SyncCollection,
): Promise<T[]> {
  const ref = getCollectionRef(uid, collection);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const data = snap.data() as CloudDoc<T>;
  return data.items ?? [];
}

/**
 * Download cloud data and merge with local data.
 * Saves merged result back to both localStorage and Firestore.
 */
async function syncWithCloudOnce(uid: string): Promise<SyncResult> {
  try {
    assertVerified(uid);
    const local = collectLocalData();
    console.log('[Sync] Sync →', { uid, localVocab: local.vocabulary.length, localSentences: local.sentences.length, localSessions: local.sessions.length });

    // Download all cloud collections in parallel (dailyPlan excluded — local only)
    const dlResults = await Promise.allSettled([
      downloadCollection<VocabularyItem>(uid, 'vocabulary'),
      downloadCollection<SentenceItem>(uid, 'sentences'),
      downloadCollection<VideoStudySession>(uid, 'sessions'),
    ]);

    const cloudVocab = dlResults[0].status === 'fulfilled' ? dlResults[0].value : [];
    const cloudSentences = dlResults[1].status === 'fulfilled' ? dlResults[1].value : [];
    const cloudSessions = dlResults[2].status === 'fulfilled' ? dlResults[2].value : [];
    console.log('[Sync] Cloud ↓', { cloudVocab: cloudVocab.length, cloudSentences: cloudSentences.length, cloudSessions: cloudSessions.length });

    const dlErrors: string[] = [];
    dlResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = ['vocabulary', 'sentences', 'sessions'][i];
        dlErrors.push(`${name}: ${r.reason?.message ?? String(r.reason)}`);
      }
    });

    const downloadFailed = dlResults.map((result) => result.status === 'rejected');
    if (downloadFailed.every(Boolean)) {
      const error = dlErrors.join('; ');
      console.error('[Sync] Pull FAILED (all):', error);
      return { ok: false, error };
    }

    // Merge each collection. A failed download is not treated as an empty
    // collection: doing so could overwrite valid cloud data on the next push.
    const mergedVocab = mergeById(local.vocabulary, cloudVocab);
    const mergedSentences = mergeById(local.sentences, cloudSentences);
    const mergedSessions = mergeSessions(local.sessions, cloudSessions);
    console.log('[Sync] Merged', { vocab: mergedVocab.length, sentences: mergedSentences.length, sessions: mergedSessions.length });

    // Save merged data to localStorage (dailyPlan stays as-is locally)
    saveVocabulary(mergedVocab);
    saveSentences(mergedSentences);
    saveAllSessions(mergedSessions);

    // Restore current session from merged list (the most recent one)
    const currentSession = loadCurrentSession();
    if (currentSession) {
      const found = mergedSessions.find((s) => s.id === currentSession.id);
      if (found) {
        saveCurrentSession(found);
      } else if (mergedSessions.length > 0) {
        saveCurrentSession(mergedSessions[0]);
      }
    }

    // Upload merged data back to cloud (so cloud has the merged result too)
    const uploadTasks: Array<Promise<void> | null> = [
      downloadFailed[0] ? null : uploadCollection(uid, 'vocabulary', mergedVocab),
      downloadFailed[1] ? null : uploadCollection(uid, 'sentences', mergedSentences),
      downloadFailed[2] ? null : uploadCollection(uid, 'sessions', mergedSessions.map(stripSession)),
    ];
    const ulResults = await Promise.all(uploadTasks.map((task) => task ? task.then(
      () => ({ status: 'fulfilled' as const }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ) : Promise.resolve({ status: 'skipped' as const })));

    const ulErrors: string[] = [];
    ulResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = ['vocabulary', 'sentences', 'sessions'][i];
        ulErrors.push(`${name}: ${r.reason?.message ?? String(r.reason)}`);
      }
    });

    const allErrors = [...dlErrors, ...ulErrors];

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    if (allErrors.length > 0) markSyncPending();
    else localStorage.removeItem(SYNC_PENDING_KEY);

    const counts = {
      vocabulary: mergedVocab.length,
      sentences: mergedSentences.length,
      sessions: mergedSessions.length,
    };

    const result: SyncResult = { ok: true, counts };
    if (allErrors.length > 0) {
      result.error = allErrors.join('; ');
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const syncInFlight = new Map<string, Promise<SyncResult>>();

/** Coalesce simultaneous auth/mount/manual sync triggers for one account. */
export function syncWithCloud(uid: string): Promise<SyncResult> {
  const existing = syncInFlight.get(uid);
  if (existing) return existing;
  const request = syncWithCloudOnce(uid).finally(() => syncInFlight.delete(uid));
  syncInFlight.set(uid, request);
  return request;
}

// ── Status ─────────────────────────────────────────────────────

/**
 * Lightweight push: upload only vocabulary and/or sentences to Firestore.
 * Skips sessions (which are large) for quick sync after data changes.
 */
export async function pushItemsToCloud(
  uid: string,
  collections: Array<'vocabulary' | 'sentences'> = ['vocabulary', 'sentences'],
): Promise<SyncResult> {
  try {
    assertVerified(uid);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const promises: Promise<void>[] = [];
  if (collections.includes('vocabulary')) {
    promises.push(uploadCollection(uid, 'vocabulary', loadVocabulary()));
  }
  if (collections.includes('sentences')) {
    promises.push(uploadCollection(uid, 'sentences', loadSentences()));
  }
  const results = await Promise.allSettled(promises);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason?.message ?? String(r.reason));
  if (errors.length > 0) {
    markSyncPending();
    console.error('[Sync] Push failed:', errors);
    return { ok: false, error: errors.join('; ') };
  }
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  localStorage.removeItem(SYNC_PENDING_KEY);
  return { ok: true };
}

/**
 * Upload sessions to Firestore with heavy fields stripped.
 * Called automatically after session save/update (debounced by the caller).
 */
export async function pushSessionToCloud(uid: string): Promise<void> {
  try {
    assertVerified(uid);
    const sessions = loadAllSessions().map(stripSession);
    await uploadCollection(uid, 'sessions', sessions);
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    localStorage.removeItem(SYNC_PENDING_KEY);
  } catch (err) {
    markSyncPending();
    console.error('[Sync] Session push failed:', err);
    throw err;
  }
}

export function getLastSyncTime(): number | null {
  const val = localStorage.getItem(LAST_SYNC_KEY);
  return val ? Number(val) : null;
}

export function isSyncPending(): boolean {
  return localStorage.getItem(SYNC_PENDING_KEY) === 'true';
}

export function markSyncPending(): void {
  localStorage.setItem(SYNC_PENDING_KEY, 'true');
}

/**
 * Format a timestamp as a human-readable relative time string.
 */
export function formatLastSync(ts: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(ts).toLocaleDateString();
}
