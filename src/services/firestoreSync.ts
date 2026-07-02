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
} from 'firebase/firestore';
import type { DocumentReference, DocumentData } from 'firebase/firestore';
import { db } from '../lib/firebase';
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
 * Merge two arrays of items by `id` field.
 * For duplicates, keep the item with the higher `addedAt` (or cloud version).
 */
function mergeById<T extends { id: string; addedAt?: number }>(
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
      // Keep whichever was added more recently; prefer cloud on tie
      const localTime = item.addedAt ?? 0;
      const cloudTime = existing.addedAt ?? 0;
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

// ── Upload ─────────────────────────────────────────────────────

async function uploadCollection<T extends { id: string }>(
  uid: string,
  collection: SyncCollection,
  items: T[],
): Promise<void> {
  const ref = getCollectionRef(uid, collection);
  await setDoc(ref, {
    items,
    updatedAt: Date.now(),
    serverUpdatedAt: serverTimestamp(),
  });
}

/**
 * Upload all local data to Firestore.
 */
export async function uploadToCloud(uid: string): Promise<SyncResult> {
  try {
    const data = collectLocalData();

    const results = await Promise.allSettled([
      uploadCollection(uid, 'vocabulary', data.vocabulary),
      uploadCollection(uid, 'sentences', data.sentences),
      uploadCollection(uid, 'sessions', data.sessions.map(s => ({
        ...s,
        // Strip large fields to stay under Firestore 1MB document limit
        transcriptData: undefined,
        transcriptLines: undefined,
        aiAnalysis: undefined,
      }))),
    ]);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message ?? String(r.reason));

    if (errors.length === results.length) {
      // All failed
      return { ok: false, error: errors.join('; ') };
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    localStorage.removeItem(SYNC_PENDING_KEY);

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
export async function syncWithCloud(uid: string): Promise<SyncResult> {
  try {
    const local = collectLocalData();

    // Download all cloud collections in parallel (dailyPlan excluded — local only)
    const dlResults = await Promise.allSettled([
      downloadCollection<VocabularyItem>(uid, 'vocabulary'),
      downloadCollection<SentenceItem>(uid, 'sentences'),
      downloadCollection<VideoStudySession>(uid, 'sessions'),
    ]);

    const cloudVocab = dlResults[0].status === 'fulfilled' ? dlResults[0].value : [];
    const cloudSentences = dlResults[1].status === 'fulfilled' ? dlResults[1].value : [];
    const cloudSessions = dlResults[2].status === 'fulfilled' ? dlResults[2].value : [];

    const dlErrors: string[] = [];
    dlResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = ['vocabulary', 'sentences', 'sessions'][i];
        dlErrors.push(`${name}: ${r.reason?.message ?? String(r.reason)}`);
      }
    });

    // Merge each collection
    const mergedVocab = mergeById(local.vocabulary, cloudVocab);
    const mergedSentences = mergeById(local.sentences, cloudSentences);
    const mergedSessions = mergeSessions(local.sessions, cloudSessions);

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
    const ulResults = await Promise.allSettled([
      uploadCollection(uid, 'vocabulary', mergedVocab),
      uploadCollection(uid, 'sentences', mergedSentences),
      uploadCollection(uid, 'sessions', mergedSessions.map(s => ({
        ...s,
        transcriptData: undefined,
        transcriptLines: undefined,
        aiAnalysis: undefined,
      }))),
    ]);

    const ulErrors: string[] = [];
    ulResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const name = ['vocabulary', 'sentences', 'sessions'][i];
        ulErrors.push(`${name}: ${r.reason?.message ?? String(r.reason)}`);
      }
    });

    const allErrors = [...dlErrors, ...ulErrors];

    // If every download AND every upload failed, report total failure
    if (dlErrors.length === 3 && ulErrors.length === 3) {
      return { ok: false, error: allErrors.join('; ') };
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    localStorage.removeItem(SYNC_PENDING_KEY);

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

// ── Status ─────────────────────────────────────────────────────

/**
 * Lightweight push: upload only vocabulary and/or sentences to Firestore.
 * Skips sessions (which are large) for quick sync after data changes.
 */
export async function pushItemsToCloud(
  uid: string,
  collections: Array<'vocabulary' | 'sentences'> = ['vocabulary', 'sentences'],
): Promise<void> {
  const promises: Promise<void>[] = [];
  if (collections.includes('vocabulary')) {
    promises.push(uploadCollection(uid, 'vocabulary', loadVocabulary()));
  }
  if (collections.includes('sentences')) {
    promises.push(uploadCollection(uid, 'sentences', loadSentences()));
  }
  await Promise.allSettled(promises);
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
}

/**
 * Upload sessions to Firestore with heavy fields stripped.
 * Called automatically after session save/update (debounced by the caller).
 */
export async function pushSessionToCloud(uid: string): Promise<void> {
  const sessions = loadAllSessions().map((s) => ({
    ...s,
    transcriptData: undefined,
    transcriptLines: undefined,
    aiAnalysis: undefined,
  }));
  await uploadCollection(uid, 'sessions', sessions);
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
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
