import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VocabularyItem, SentenceItem, VideoStudySession } from '../../types';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-a', emailVerified: true } },
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  collection: vi.fn(),
  loadVocabulary: vi.fn(() => [] as VocabularyItem[]),
  saveVocabulary: vi.fn(),
  loadSentences: vi.fn(() => []),
  saveSentences: vi.fn(),
  loadAllSessions: vi.fn(() => []),
  saveAllSessions: vi.fn(),
  loadCurrentSession: vi.fn(() => null),
  saveCurrentSession: vi.fn(),
  loadVocabularyTombstones: vi.fn(() => ({})),
  loadSentenceTombstones: vi.fn(() => ({})),
  loadSessionTombstones: vi.fn(() => ({})),
  saveVocabularyTombstones: vi.fn(),
  saveSentenceTombstones: vi.fn(),
  saveSessionTombstones: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
  serverTimestamp: mocks.serverTimestamp,
  deleteDoc: mocks.deleteDoc,
  getDocs: mocks.getDocs,
  query: mocks.query,
  where: mocks.where,
  collection: mocks.collection,
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: mocks.auth }));
vi.mock('../../utils/storage', () => ({
  loadVocabulary: mocks.loadVocabulary,
  saveVocabulary: mocks.saveVocabulary,
  loadSentences: mocks.loadSentences,
  saveSentences: mocks.saveSentences,
  loadAllSessions: mocks.loadAllSessions,
  saveAllSessions: mocks.saveAllSessions,
  loadCurrentSession: mocks.loadCurrentSession,
  saveCurrentSession: mocks.saveCurrentSession,
  clearCurrentSession: vi.fn(),
  loadVocabularyTombstones: mocks.loadVocabularyTombstones,
  loadSentenceTombstones: mocks.loadSentenceTombstones,
  loadSessionTombstones: mocks.loadSessionTombstones,
  saveVocabularyTombstones: mocks.saveVocabularyTombstones,
  saveSentenceTombstones: mocks.saveSentenceTombstones,
  saveSessionTombstones: mocks.saveSessionTombstones,
}));

import {
  mergeById,
  mergeCollection,
  pushItemsToCloud,
  syncWithCloud,
  clearSyncMetadata,
  hasLocalSyncableData,
} from '../firestoreSync';

const item = (id: string, addedAt: number, definitionEn = ''): VocabularyItem => ({
  id,
  word: id,
  meaningCn: `${id}-cn`,
  context: `${id}-context`,
  sourceVideoId: 'video',
  addedAt,
  mastered: false,
  reviewCount: 0,
  lastReviewedAt: 0,
  nextReviewAt: 0,
  definitionEn,
});

function cloudSnapshot<T>(items: T[]) {
  return { exists: () => true, data: () => ({ items }) };
}

describe('Firestore lifecycle sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: true };
    mocks.setDoc.mockResolvedValue(undefined);
    mocks.getDocs.mockResolvedValue({ docs: [] });
    mocks.loadVocabulary.mockReturnValue([]);
    mocks.loadSentences.mockReturnValue([]);
    mocks.loadAllSessions.mockReturnValue([]);
    mocks.loadCurrentSession.mockReturnValue(null);
    mocks.loadVocabularyTombstones.mockReturnValue({});
    mocks.loadSentenceTombstones.mockReturnValue({});
    mocks.loadSessionTombstones.mockReturnValue({});
  });

  it('clears account-scoped sync metadata without touching device preferences', () => {
    localStorage.setItem('echolearn_firebase_last_sync', '123');
    localStorage.setItem('echolearn_firebase_sync_pending', 'true');
    localStorage.setItem('echolearn_lang', 'en');
    clearSyncMetadata();
    expect(localStorage.getItem('echolearn_firebase_last_sync')).toBeNull();
    expect(localStorage.getItem('echolearn_firebase_sync_pending')).toBeNull();
    expect(localStorage.getItem('echolearn_lang')).toBe('en');
  });

  it('detects cloud-syncable records and deletion tombstones', () => {
    expect(hasLocalSyncableData()).toBe(false);
    mocks.loadVocabulary.mockReturnValue([item('local', 1)]);
    expect(hasLocalSyncableData()).toBe(true);
    mocks.loadVocabulary.mockReturnValue([]);
    mocks.loadVocabularyTombstones.mockReturnValue({ deleted: 2 });
    expect(hasLocalSyncableData()).toBe(true);
  });

  it('unions local/cloud records and dedupes by id with cloud winning timestamp ties', () => {
    const merged = mergeById(
      [item('local-only', 1), item('same', 10, 'local')],
      [item('cloud-only', 2), item('same', 10, 'cloud')],
    );

    expect(merged.map((entry) => entry.id)).toEqual(['cloud-only', 'same', 'local-only']);
    expect(merged.find((entry) => entry.id === 'same')?.definitionEn).toBe('cloud');
  });

  it('lets a later local mutation win even when the original item was saved earlier', () => {
    const merged = mergeById(
      [{ ...item('same', 10, 'enriched locally'), updatedAt: 30 }],
      [{ ...item('same', 20, 'stale cloud'), updatedAt: 20 }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].definitionEn).toBe('enriched locally');
  });

  it.each([
    ['vocabulary', item('x', 100)],
    ['sentence', { id: 'x', text: 'x', addedAt: 100 } as SentenceItem],
    ['session', {
      id: 'x', youtubeUrl: 'https://youtu.be/x', youtubeId: 'x', title: 'x',
      createdAt: 100, updatedAt: 100, transcriptLines: [], status: 'draft',
    } as VideoStudySession],
  ])('keeps a stale local %s item deleted when cloud has a newer tombstone', (_name, value) => {
    const merged = mergeCollection([value], [], {}, { x: 200 }, (entry) => {
      const candidate = entry as { updatedAt?: number; addedAt?: number; createdAt?: number };
      return candidate.updatedAt ?? candidate.addedAt ?? candidate.createdAt ?? 0;
    });
    expect(merged.items).toEqual([]);
    expect(merged.tombstones).toEqual({ x: 200 });
  });

  it('lets a newer recreation supersede an older tombstone', () => {
    const merged = mergeCollection(
      [{ ...item('x', 200), updatedAt: 200 }],
      [],
      {},
      { x: 100 },
      (entry) => entry.updatedAt ?? entry.addedAt ?? 0,
    );
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].id).toBe('x');
    expect(merged.tombstones).toEqual({});
  });

  it('lets a local deletion beat a stale cloud live item', () => {
    const merged = mergeCollection(
      [],
      [item('x', 100)],
      { x: 200 },
      {},
      (entry) => entry.updatedAt ?? entry.addedAt ?? 0,
    );
    expect(merged.items).toEqual([]);
    expect(merged.tombstones).toEqual({ x: 200 });
  });

  it('uses deletion as the deterministic equal-timestamp winner', () => {
    const merged = mergeCollection(
      [item('x', 200)],
      [],
      { x: 200 },
      {},
      (entry) => entry.updatedAt ?? entry.addedAt ?? 0,
    );
    expect(merged.items).toEqual([]);
    expect(merged.tombstones).toEqual({ x: 200 });
  });

  it('preserves unrelated live items while propagating a deletion', () => {
    const merged = mergeCollection(
      [item('x', 100), item('y', 100)],
      [],
      {},
      { x: 200 },
      (entry) => entry.updatedAt ?? entry.addedAt ?? 0,
    );
    expect(merged.items.map((entry) => entry.id)).toEqual(['y']);
    expect(merged.tombstones).toEqual({ x: 200 });
  });

  it('accepts pre-tombstone cloud documents as an empty tombstone map', async () => {
    mocks.loadVocabulary.mockReturnValue([item('local', 10)]);
    mocks.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [item('cloud', 20)] }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [] }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [] }) });

    const result = await syncWithCloud('user-a');
    expect(result.ok).toBe(true);
    expect(mocks.saveVocabularyTombstones).toHaveBeenCalledWith({});
  });

  it('propagates a cloud deletion while removing the stale local copy', async () => {
    mocks.loadVocabulary.mockReturnValue([item('x', 100)]);
    mocks.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [], tombstones: { x: 200 } }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [] }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ items: [] }) });

    const result = await syncWithCloud('user-a');
    expect(result.ok).toBe(true);
    expect(mocks.saveVocabulary).toHaveBeenCalledWith([]);
    expect(mocks.saveVocabularyTombstones).toHaveBeenCalledWith({ x: 200 });
    const vocabWrite = mocks.setDoc.mock.calls.find((call) => String(call[0].path).endsWith('/vocabulary'));
    expect(vocabWrite?.[1].tombstones).toEqual({ x: 200 });
    expect(vocabWrite?.[1].items).toEqual([]);
  });

  it('simulates two devices without allowing a stale device to resurrect a delete', () => {
    const deviceA = [item('x', 100)];
    const deviceB = [item('x', 100)];
    const cloudAfterADelete = { items: [] as VocabularyItem[], tombstones: { x: 200 } };

    const bPull = mergeCollection(deviceB, cloudAfterADelete.items, {}, cloudAfterADelete.tombstones, (entry) => entry.updatedAt ?? entry.addedAt ?? 0);
    expect(bPull.items).toEqual([]);
    expect(bPull.tombstones).toEqual({ x: 200 });

    const aPull = mergeCollection(deviceA.filter((entry) => entry.id !== 'x'), cloudAfterADelete.items, { x: 200 }, cloudAfterADelete.tombstones, (entry) => entry.updatedAt ?? entry.addedAt ?? 0);
    expect(aPull.items).toEqual([]);
    expect(aPull.tombstones).toEqual({ x: 200 });
  });

  it('coalesces concurrent sync triggers for the same account', async () => {
    const resolveReads: Array<(value: unknown) => void> = [];
    mocks.getDoc.mockImplementation(() => new Promise((resolve) => { resolveReads.push(resolve); }));

    const first = syncWithCloud('user-a');
    const second = syncWithCloud('user-a');
    expect(second).toBe(first);

    resolveReads.forEach((resolve) => resolve(cloudSnapshot([])));
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(mocks.getDoc).toHaveBeenCalledTimes(3);
  });

  it('keeps local data and avoids cloud overwrite when every pull fails', async () => {
    const local = [item('local', 10)];
    mocks.loadVocabulary.mockReturnValue(local);
    mocks.getDoc.mockRejectedValue(new Error('offline'));

    const result = await syncWithCloud('user-a');

    expect(result).toMatchObject({ ok: false });
    expect(mocks.saveVocabulary).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_firebase_last_sync')).toBeNull();
  });

  it('preserves a category whose pull failed and does not upload it during partial recovery', async () => {
    const localVocab = [item('local-vocab', 10)];
    mocks.loadVocabulary.mockReturnValue(localVocab);
    mocks.getDoc
      .mockRejectedValueOnce(new Error('vocabulary unavailable'))
      .mockResolvedValueOnce(cloudSnapshot([]))
      .mockResolvedValueOnce(cloudSnapshot([]));

    const result = await syncWithCloud('user-a');

    expect(result.ok).toBe(true);
    expect(mocks.saveVocabulary).toHaveBeenCalledWith(localVocab);
    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
    expect(mocks.setDoc.mock.calls.every((call) => !String(call[0].path).endsWith('/vocabulary'))).toBe(true);
    expect(localStorage.getItem('echolearn_firebase_sync_pending')).toBe('true');
  });

  it('reports failed pushes and marks retry state without claiming a successful sync', async () => {
    mocks.loadVocabulary.mockReturnValue([item('new-local', 1)]);
    mocks.setDoc.mockRejectedValue(new Error('permission-denied'));

    const result = await pushItemsToCloud('user-a', ['vocabulary']);

    expect(result).toMatchObject({ ok: false, error: 'permission-denied' });
    expect(localStorage.getItem('echolearn_firebase_sync_pending')).toBe('true');
    expect(localStorage.getItem('echolearn_firebase_last_sync')).toBeNull();
  });


  it('R2: a successful retry after a transient pull failure uploads the still-pending local items', async () => {
    mocks.loadVocabulary.mockReturnValue([item('pending-1', 100)]);
    let pullsFailing = true;
    mocks.getDoc.mockImplementation(async () => {
      if (pullsFailing) throw new Error('offline');
      return { exists: () => false };
    });

    const first = await syncWithCloud('user-a');
    expect(first.ok).toBe(false);
    pullsFailing = false;
    // the pending item survives the failed attempt
    expect(mocks.saveVocabulary.mock.calls.length).toBe(0);

    mocks.getDoc.mockImplementation(async () => ({ exists: () => false }));
    const second = await syncWithCloud('user-a');
    expect(second.ok).toBe(true);
    const vocabPushes = mocks.setDoc.mock.calls.filter((c) => String(c[0].path).endsWith('/vocabulary'));
    expect(vocabPushes.length).toBeGreaterThan(0);
    const uploaded = (vocabPushes.at(-1)![1] as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(uploaded).toContain('pending-1');
  });

  it('R4: an item saved while a sync is in flight survives the sync', async () => {
    // collectLocalData snapshots at sync start; the learner saves a new item
    // while the (slow) cloud pulls are in flight. The post-download merge and
    // push must include it, and the saved local state must not lose it.
    mocks.loadVocabulary.mockReturnValue([item('existing-1', 100)]);
    let releaseDownloads: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseDownloads = resolve; });
    mocks.getDoc.mockImplementation(async () => {
      await gate;
      return { exists: () => false };
    });

    const syncPromise = syncWithCloud('user-a');
    await new Promise((r) => setTimeout(r, 0));
    // learner saves a new word while the pulls are in flight
    const liveVocab = [item('existing-1', 100), item('saved-mid-flight', 200)];
    mocks.loadVocabulary.mockReturnValue(liveVocab);
    releaseDownloads();

    const result = await syncPromise;
    expect(result.ok).toBe(true);

    // saved local state keeps the mid-flight item
    const savedLast = mocks.saveVocabulary.mock.calls.at(-1)![0] as Array<{ id: string }>;
    expect(savedLast.map((i) => i.id)).toContain('saved-mid-flight');
    // and the cloud push includes it too
    const vocabPushes = mocks.setDoc.mock.calls.filter((c) => String(c[0].path).endsWith('/vocabulary'));
    expect(vocabPushes.length).toBeGreaterThan(0);
    const uploaded = (vocabPushes.at(-1)![1] as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(uploaded).toContain('saved-mid-flight');
  });


  it('R5: a device whose push missed another device\'s newer item recovers it on its next pull', async () => {
    // Cross-device single-document window: device 1 pushes a merge that predates
    // device 2's newer upload, temporarily regressing the cloud doc. The next
    // pull on device 1 must union device 2's item back (no permanent loss).
    mocks.loadVocabulary.mockReturnValue([item('d1-word', 100)]);
    // device 1 pull: cloud still holds only its own older item
    mocks.getDoc.mockResolvedValueOnce(cloudSnapshot([item('d1-word', 100)]));
    await syncWithCloud('user-a');

    // device 2 uploads its own newer item to the shared document
    mocks.getDoc.mockResolvedValueOnce(cloudSnapshot([item('d1-word', 100), item('d2-newer', 500)]));
    mocks.loadVocabulary.mockReturnValue([item('d1-word', 100), item('d2-newer', 500)]);
    await syncWithCloud('user-a');

    // device 1 pulls again AFTER device 2's upload: the union restores d2-newer
    mocks.loadVocabulary.mockReturnValue([item('d1-word', 100)]);
    mocks.getDoc.mockResolvedValueOnce(cloudSnapshot([item('d1-word', 100), item('d2-newer', 500)]));
    const result = await syncWithCloud('user-a');
    expect(result.ok).toBe(true);
    const savedLast = mocks.saveVocabulary.mock.calls.at(-1)![0] as Array<{ id: string }>;
    expect(savedLast.map((i) => i.id)).toContain('d2-newer');
  });

  it('does not push unverified account data', async () => {
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: false };

    const result = await pushItemsToCloud('user-a', ['vocabulary']);

    expect(result).toEqual({ ok: false, error: 'auth/email-not-verified' });
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
