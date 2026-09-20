// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  uid: 'user-a',
  emailVerified: true,
  messageIds: [] as string[],
  /** Items held in each cloud sync document; empty means the cloud is empty. */
  cloudItems: [] as unknown[],
  /** 1-based commit number that should fail, or null for a clean run. */
  failOnCommit: null as number | null,
  listFails: false,
};
const commits: string[][] = [];
let commitCount = 0;

vi.mock('../../lib/firebase', () => ({
  db: {},
  auth: { get currentUser() { return { uid: state.uid, emailVerified: state.emailVerified }; } },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (col: { path: string }) => col,
  limit: (n: number) => ({ n }),
  getDoc: vi.fn(async (ref: { path: string }) => ({
    exists: () => state.cloudItems.length > 0 && ref.path.includes('/data/'),
    data: () => ({ items: ref.path.includes('/data/') ? state.cloudItems : [] }),
  })),
  getDocs: vi.fn(async () => {
    if (state.listFails) throw new Error('unavailable');
    return { size: state.messageIds.length, docs: state.messageIds.map((id) => ({ id })) };
  }),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => {
    const ops: string[] = [];
    return {
      delete: (ref: { path: string }) => { ops.push(ref.path); },
      commit: async () => {
        commitCount += 1;
        if (state.failOnCommit === commitCount) throw new Error('permission-denied');
        commits.push(ops);
      },
    };
  }),
}));

import { deleteUserData, CloudCleanupError, NoLocalCopyError } from '../firestoreSync';
import { deleteDoc } from 'firebase/firestore';

const SYNC_PATHS = [
  'users/user-a/data/vocabulary',
  'users/user-a/data/sentences',
  'users/user-a/data/sessions',
];
const messagePath = (id: string) => `feedback/user-a/messages/${id}`;

beforeEach(() => {
  commits.length = 0;
  commitCount = 0;
  localStorage.clear();
  // This device holds a copy, so the only-copy interlock stays out of the way
  // of the ordering assertions below.
  localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'local-word' }]));
  state.uid = 'user-a';
  state.emailVerified = true;
  state.messageIds = ['m1', 'm2'];
  state.cloudItems = [{ id: 'cloud-word' }];
  state.failOnCommit = null;
  state.listFails = false;
  vi.mocked(deleteDoc).mockClear();
});

describe('deleteUserData — atomic learning-data removal', () => {
  it('removes every sync document and the feedback page in ONE batched commit', async () => {
    await deleteUserData('user-a');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual([...SYNC_PATHS, messagePath('m1'), messagePath('m2')]);
    // The all-or-none guarantee comes from the batched write; individual
    // deletes each commit alone and could leave half a library behind.
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('AD4: a failed commit deletes nothing and is surfaced, not swallowed', async () => {
    state.failOnCommit = 1;
    const error = await deleteUserData('user-a').then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CloudCleanupError);
    expect((error as Error).message).toMatch(/learning data \+ feedback: permission-denied/);
    expect(commits).toEqual([]);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('AD4: a failure on a later page means learning data is already gone, and says so', async () => {
    state.messageIds = Array.from({ length: 50 }, (_, i) => `m${i}`);
    state.failOnCommit = 2;
    await expect(deleteUserData('user-a')).rejects.toThrow(/^cloud-cleanup-incomplete: feedback: permission-denied$/);
    expect(commits[0]).toEqual([...SYNC_PATHS, ...state.messageIds.map(messagePath)]);
    expect(commits).toHaveLength(1);
  });

  it('A3: a feedback listing that cannot be read is reported instead of assumed empty', async () => {
    state.listFails = true;
    await expect(deleteUserData('user-a')).rejects.toThrow(/feedback:list: unavailable/);
    expect(commits).toEqual([]);
  });

  it('AD1: an unverified session, or another uid, touches nothing at all', async () => {
    state.emailVerified = false;
    await deleteUserData('user-a');
    state.emailVerified = true;
    await deleteUserData('someone-else');
    expect(commits).toEqual([]);
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});

describe('deleteUserData — only-copy safety interlock', () => {
  it('refuses to delete cloud data when this device holds no copy of it', async () => {
    localStorage.clear();
    const error = await deleteUserData('user-a').then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(NoLocalCopyError);
    expect(commits).toEqual([]);
  });

  it('still proceeds when the cloud itself is empty (nothing to lose)', async () => {
    localStorage.clear();
    state.cloudItems = [];
    await deleteUserData('user-a');
    expect(commits[0].filter((p) => p.includes('/data/'))).toEqual(SYNC_PATHS);
  });

  it('treats local tombstones as a copy, so a deleted-then-retried account is not blocked', async () => {
    localStorage.clear();
    localStorage.setItem('echolearn_vocabulary_tombstones', JSON.stringify({ 'gone': 123 }));
    await expect(deleteUserData('user-a')).resolves.toBeUndefined();
    expect(commits).toHaveLength(1);
  });
});
