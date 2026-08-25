import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VocabularyItem } from '../../types';

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
}));

import {
  mergeById,
  pushItemsToCloud,
  syncWithCloud,
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
