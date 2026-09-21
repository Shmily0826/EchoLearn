/**
 * Firestore-based cloud sync.
 *
 * Data structure:
 *   users/{uid}/data/{collection}
 *     where collection is: vocabulary | sentences | sessions
 *     each document: { items: [...], tombstones: { [id]: deletedAt }, updatedAt: <timestamp ms> }
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
  getDocs,
  limit,
  query,
  writeBatch,
  collection,
} from 'firebase/firestore';
import type { DocumentReference, DocumentData, WriteBatch } from 'firebase/firestore';
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
  clearCurrentSession,
  loadVocabularyTombstones,
  loadSentenceTombstones,
  loadSessionTombstones,
  saveVocabularyTombstones,
  saveSentenceTombstones,
  saveSessionTombstones,
} from '../utils/storage';
import type { TombstoneMap } from '../utils/storage';
import type {
  VocabularyItem,
  SentenceItem,
  VideoStudySession,
} from '../types';

// ── Types ──────────────────────────────────────────────────────

type SyncCollection = 'vocabulary' | 'sentences' | 'sessions' | 'dailyPlan';

interface CloudDoc<T> {
  items?: T[];
  tombstones?: TombstoneMap;
  updatedAt?: number;
}

interface CollectionData<T> {
  items: T[];
  tombstones: TombstoneMap;
}

export interface SyncResult {
  ok: boolean;
  counts?: Record<string, number>;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────

const LAST_SYNC_KEY = 'echolearn_firebase_last_sync';
const SYNC_PENDING_KEY = 'echolearn_firebase_sync_pending';

/** Clear account-scoped sync markers at an auth boundary. */
export function clearSyncMetadata(): void {
  localStorage.removeItem(LAST_SYNC_KEY);
  localStorage.removeItem(SYNC_PENDING_KEY);
}

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
 * Delete all cloud data belonging to a user, for account deletion.
 *
 * The learning-data documents and the first page of feedback are removed in ONE
 * batched write, because Firestore commits a batched write all-or-none ("either
 * all of the operations succeed, or none of them are applied"): a cleanup that
 * dies halfway cannot leave a learner with half a cloud library. Failures are
 * propagated rather than swallowed, so the caller stops before destroying
 * anything on the device.
 *
 * Feedback beyond the first page is deleted in further bounded batches. Those
 * later batches can fail after the first succeeded, which is reported rather
 * than hidden — feedback is not learning data, and a retry finishes it.
 *
 * The writer's own AI cache subtree (`aiCache/{uid}/analyses/*`) is removed by
 * the same kind of bounded pass. Without it, deleting an account would leave
 * documents that no future client can ever reach again — the rules bind them to
 * a uid that can no longer authenticate — which is precisely the orphan shape
 * this campaign exists to end.
 *
 * An email-unverified account has nothing to delete — the rules deny it every
 * write to `users/*`, `feedback/*` and `aiCache/*` in the first place, and would
 * deny the delete too — so the call is a no-op for that account instead of a
 * guaranteed permission error.
 *
 * LEGACY `feedback/{docId}` documents are NOT reachable here: they live in the
 * `feedback` collection group with ids no client ever kept, and rules have never
 * allowed a client to read or list them. Removing them is an administrator
 * action (see DECISIONS.md), not something this function can promise.
 */
export async function deleteUserData(uid: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.uid !== uid || !current.emailVerified) return;

  // Safety interlock. There is no transaction that spans Firestore and Firebase
  // Auth, so if the cloud documents were the learner's ONLY copy, a successful
  // cloud delete followed by a failed `deleteUser` would be irreversible data
  // loss. Refuse that state instead of performing it: this device can export or
  // re-sync from the right device first.
  const cloudDocs = await Promise.all(SYNC_COLLECTIONS.map((name) => getDoc(getCollectionRef(uid, name))));
  const cloudHasData = cloudDocs.some((snap) => {
    const items = (snap.data() as CloudDoc<unknown> | undefined)?.items;
    return Array.isArray(items) && items.length > 0;
  });
  if (cloudHasData && !hasLocalSyncableData()) throw new NoLocalCopyError();

  const failed: string[] = [];
  // The sync documents ride along with the first feedback batch so a single
  // commit covers every piece of learning data.
  const carryLearningData = (batch: WriteBatch) => {
    for (const name of SYNC_COLLECTIONS) batch.delete(getCollectionRef(uid, name));
  };
  const feedbackPage = await deleteOwnedSubtree(['feedback', uid, 'messages'], 'feedback', failed, carryLearningData);
  await deleteOwnedSubtree(['aiCache', uid, 'analyses'], 'aiCache', failed);

  if (failed.length) throw new CloudCleanupError(failed, feedbackPage);
}

/**
 * List and delete one owner-scoped subtree in bounded batches, appending every
 * failure to `failed` instead of throwing at the first one. The path must begin
 * with the collection the caller owns outright, because rules cannot reach a
 * document whose id the client never kept.
 */
async function deleteOwnedSubtree(
  root: [string, ...string[]],
  label: string,
  failed: string[],
  onFirstBatch?: (batch: WriteBatch) => void,
): Promise<number | undefined> {
  let lastPage: number | undefined;

  for (let pass = 0; ; pass += 1) {
    let ids: string[];
    try {
      const snap = await getDocs(query(collection(db, ...root), limit(FEEDBACK_DELETE_BATCH)));
      ids = snap.docs.map((entry) => entry.id);
      lastPage = snap.size;
    } catch (error) {
      failed.push(`${label}:list: ${messageOf(error)}`);
      break;
    }

    // An empty subtree costs no write: committing a batch that deletes nothing
    // would be a pointless Production round-trip on every deletion.
    if (ids.length === 0 && !(pass === 0 && onFirstBatch)) break;

    const batch = writeBatch(db);
    if (pass === 0) onFirstBatch?.(batch);
    for (const id of ids) batch.delete(doc(db, ...root, id));

    try {
      await batch.commit();
    } catch (error) {
      failed.push(`${pass === 0 && onFirstBatch ? 'learning data + ' : ''}${label}: ${messageOf(error)}`);
      break;
    }

    if (ids.length < FEEDBACK_DELETE_BATCH) break;
    if (pass >= FEEDBACK_DELETE_PASSES) {
      failed.push(`${label}: still present after ${FEEDBACK_DELETE_PASSES + 1} batches`);
      break;
    }
  }

  return lastPage;
}

const SYNC_COLLECTIONS: SyncCollection[] = ['vocabulary', 'sentences', 'sessions'];

/** The `list` rule caps at 50, so each page — and each batch — is bounded by it. */
const FEEDBACK_DELETE_BATCH = 50;
const FEEDBACK_DELETE_PASSES = 10;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Refused before any cloud write: the cloud copy is the only one that exists. */
export class NoLocalCopyError extends Error {
  constructor() {
    super('no-local-copy');
    this.name = 'NoLocalCopyError';
  }
}

/** Thrown when cloud cleanup could not remove everything it promised to. */
export class CloudCleanupError extends Error {
  readonly failed: string[];
  /** How many feedback documents were visible in the last listed page, if any. */
  readonly lastFeedbackPage?: number;
  constructor(failed: string[], lastFeedbackPage?: number) {
    super(`cloud-cleanup-incomplete: ${failed.join('; ')}`);
    this.name = 'CloudCleanupError';
    this.failed = failed;
    this.lastFeedbackPage = lastFeedbackPage;
  }
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
  return mergeCollection(local, cloud, {}, {}, (item) => item.updatedAt ?? item.addedAt ?? 0).items;
}

/**
 * Merge one full-array collection with per-item deletion knowledge.
 * A tombstone wins on equality so a stale device cannot resurrect a delete.
 */
export function mergeCollection<T extends { id: string }>(
  local: T[],
  cloud: T[],
  localTombstones: TombstoneMap,
  cloudTombstones: TombstoneMap,
  getLiveTimestamp: (item: T) => number,
  mergeLiveItem?: (local: T | undefined, cloud: T | undefined, winner: T) => T,
): CollectionData<T> {
  const localById = new Map(local.map((item) => [item.id, item]));
  const cloudById = new Map(cloud.map((item) => [item.id, item]));
  const ids = new Set([...cloudById.keys(), ...localById.keys(), ...Object.keys(cloudTombstones), ...Object.keys(localTombstones)]);
  const result: T[] = [];
  const tombstones: TombstoneMap = {};

  for (const id of ids) {
    const localItem = localById.get(id);
    const cloudItem = cloudById.get(id);
    const localDeletedAt = localTombstones[id] ?? 0;
    const cloudDeletedAt = cloudTombstones[id] ?? 0;
    const deletedAt = Math.max(localDeletedAt, cloudDeletedAt);

    let winner: T | undefined;
    if (localItem && cloudItem) {
      winner = getLiveTimestamp(localItem) > getLiveTimestamp(cloudItem) ? localItem : cloudItem;
      if (winner === cloudItem && mergeLiveItem) winner = mergeLiveItem(localItem, cloudItem, winner);
    } else {
      winner = localItem ?? cloudItem;
    }

    const liveAt = winner ? getLiveTimestamp(winner) : 0;
    if (deletedAt > 0 && deletedAt >= liveAt) {
      tombstones[id] = deletedAt;
      continue;
    }
    if (winner) result.push(winner);
  }

  return { items: result, tombstones };
}

/**
 * Merge sessions list — sessions have id + createdAt instead of addedAt.
 */
function mergeSessions(
  local: VideoStudySession[],
  cloud: VideoStudySession[],
  localTombstones: TombstoneMap,
  cloudTombstones: TombstoneMap,
): CollectionData<VideoStudySession> {
  const merged = mergeCollection(
    local,
    cloud,
    localTombstones,
    cloudTombstones,
    (session) => session.updatedAt ?? session.createdAt ?? 0,
    (localItem, _cloudItem, winner) => ({
      ...winner,
      transcriptData: winner.transcriptData ?? localItem?.transcriptData,
      transcriptLines:
        winner.transcriptLines && winner.transcriptLines.length > 0
          ? winner.transcriptLines
          : localItem?.transcriptLines ?? [],
      aiAnalysis: winner.aiAnalysis ?? localItem?.aiAnalysis,
    }),
  );
  merged.items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return merged;
}

// ── Collect local data ─────────────────────────────────────────

interface AllLocalData {
  vocabulary: VocabularyItem[];
  sentences: SentenceItem[];
  sessions: VideoStudySession[];
  vocabularyTombstones: TombstoneMap;
  sentenceTombstones: TombstoneMap;
  sessionTombstones: TombstoneMap;
}

function collectLocalData(): AllLocalData {
  return {
    vocabulary: loadVocabulary(),
    sentences: loadSentences(),
    sessions: loadAllSessions(),
    vocabularyTombstones: loadVocabularyTombstones(),
    sentenceTombstones: loadSentenceTombstones(),
    sessionTombstones: loadSessionTombstones(),
  };
}

/** True when local data can be protected by the existing cloud sync. */
export function hasLocalSyncableData(): boolean {
  const local = collectLocalData();
  return local.vocabulary.length > 0
    || local.sentences.length > 0
    || local.sessions.length > 0
    || Object.keys(local.vocabularyTombstones).length > 0
    || Object.keys(local.sentenceTombstones).length > 0
    || Object.keys(local.sessionTombstones).length > 0;
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
  tombstones: TombstoneMap = {},
): Promise<void> {
  const ref = getCollectionRef(uid, collection);
  // Strip undefined values from every item to prevent Firestore errors
  const cleanItems = items.map((item) => stripUndefined(item as Record<string, unknown>));
  await setDoc(ref, {
    items: cleanItems,
    tombstones,
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
      uploadCollection(uid, 'vocabulary', data.vocabulary, data.vocabularyTombstones),
      uploadCollection(uid, 'sentences', data.sentences, data.sentenceTombstones),
      uploadCollection(uid, 'sessions', data.sessions.map(stripSession), data.sessionTombstones),
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
): Promise<CollectionData<T>> {
  const ref = getCollectionRef(uid, collection);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { items: [], tombstones: {} };
  const data = snap.data() as CloudDoc<T>;
  return { items: data.items ?? [], tombstones: data.tombstones ?? {} };
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

    const cloudVocab = dlResults[0].status === 'fulfilled' ? dlResults[0].value : { items: [], tombstones: {} };
    const cloudSentences = dlResults[1].status === 'fulfilled' ? dlResults[1].value : { items: [], tombstones: {} };
    const cloudSessions = dlResults[2].status === 'fulfilled' ? dlResults[2].value : { items: [], tombstones: {} };
    console.log('[Sync] Cloud ↓', { cloudVocab: cloudVocab.items.length, cloudSentences: cloudSentences.items.length, cloudSessions: cloudSessions.items.length });

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

    // Re-collect local data AFTER the pulls settle: items saved or deleted while
    // the downloads were in flight must not be clobbered by writing back the
    // stale pre-download snapshot (R4).
    const freshLocal = collectLocalData();

    // Merge each collection. A failed download is not treated as an empty
    // collection: doing so could overwrite valid cloud data on the next push.
    const mergedVocabData = downloadFailed[0]
      ? { items: freshLocal.vocabulary, tombstones: freshLocal.vocabularyTombstones }
      : mergeCollection(freshLocal.vocabulary, cloudVocab.items, freshLocal.vocabularyTombstones, cloudVocab.tombstones, (item) => item.updatedAt ?? item.addedAt ?? 0);
    const mergedSentencesData = downloadFailed[1]
      ? { items: freshLocal.sentences, tombstones: freshLocal.sentenceTombstones }
      : mergeCollection(freshLocal.sentences, cloudSentences.items, freshLocal.sentenceTombstones, cloudSentences.tombstones, (item) => item.updatedAt ?? item.addedAt ?? 0);
    const mergedSessionsData = downloadFailed[2]
      ? { items: freshLocal.sessions, tombstones: freshLocal.sessionTombstones }
      : mergeSessions(freshLocal.sessions, cloudSessions.items, freshLocal.sessionTombstones, cloudSessions.tombstones);
    const mergedVocab = mergedVocabData.items;
    const mergedSentences = mergedSentencesData.items;
    const mergedSessions = mergedSessionsData.items;
    console.log('[Sync] Merged', { vocab: mergedVocab.length, sentences: mergedSentences.length, sessions: mergedSessions.length });

    // Save merged data to localStorage (dailyPlan stays as-is locally)
    saveVocabulary(mergedVocab);
    saveSentences(mergedSentences);
    saveAllSessions(mergedSessions);
    saveVocabularyTombstones(mergedVocabData.tombstones);
    saveSentenceTombstones(mergedSentencesData.tombstones);
    saveSessionTombstones(mergedSessionsData.tombstones);

    // Restore current session from merged list (the most recent one)
    const currentSession = loadCurrentSession();
    if (currentSession) {
      const found = mergedSessions.find((s) => s.id === currentSession.id);
      if (found) {
        saveCurrentSession(found);
      } else if (mergedSessionsData.tombstones[currentSession.id] !== undefined) {
        clearCurrentSession();
      } else if (mergedSessions.length > 0) {
        saveCurrentSession(mergedSessions[0]);
      } else {
        clearCurrentSession();
      }
    }

    // Upload merged data back to cloud (so cloud has the merged result too)
    const uploadTasks: Array<Promise<void> | null> = [
      downloadFailed[0] ? null : uploadCollection(uid, 'vocabulary', mergedVocab, mergedVocabData.tombstones),
      downloadFailed[1] ? null : uploadCollection(uid, 'sentences', mergedSentences, mergedSentencesData.tombstones),
      downloadFailed[2] ? null : uploadCollection(uid, 'sessions', mergedSessions.map(stripSession), mergedSessionsData.tombstones),
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
    promises.push(uploadCollection(uid, 'vocabulary', loadVocabulary(), loadVocabularyTombstones()));
  }
  if (collections.includes('sentences')) {
    promises.push(uploadCollection(uid, 'sentences', loadSentences(), loadSentenceTombstones()));
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
    await uploadCollection(uid, 'sessions', sessions, loadSessionTombstones());
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
