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

  it('does not push unverified account data', async () => {
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: false };

    const result = await pushItemsToCloud('user-a', ['vocabulary']);

    expect(result).toEqual({ ok: false, error: 'auth/email-not-verified' });
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
