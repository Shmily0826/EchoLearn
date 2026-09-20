// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIAnalysisResult } from '../../types';

const authState = { currentUser: null as { uid: string; emailVerified: boolean } | null };
const writes: string[] = [];
const reads: string[] = [];
let docContents: Record<string, unknown> = {};

vi.mock('../../lib/firebase', () => ({ auth: { get currentUser() { return authState.currentUser; } }, db: {} }));
vi.mock('firebase/firestore', () => ({
  // doc() is called both as doc(db, 'a/b/c') and doc(db, 'aiCache', uid, ...).
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: vi.fn(async (ref: { path: string }) => {
    reads.push(ref.path);
    const content = docContents[ref.path];
    return {
      exists: () => content !== undefined,
      data: () => content,
    };
  }),
  setDoc: vi.fn(async (ref: { path: string }, data: unknown) => {
    writes.push(ref.path);
    docContents[ref.path] = data;
  }),
  serverTimestamp: vi.fn(() => 'server-time'),
}));

import { getCachedAnalysis, setCachedAnalysis } from '../aiAnalysis';

const KEY = 'a'.repeat(64);
const result = { vocabulary: [], sentences: [] } as unknown as AIAnalysisResult;
const ownPath = `aiCache/user-a/analyses/${KEY}`;
const legacyPath = `aiAnalyses/${KEY}`;

beforeEach(() => {
  writes.length = 0;
  reads.length = 0;
  docContents = {};
  authState.currentUser = { uid: 'user-a', emailVerified: true };
});

describe('AI cache client trust boundary', () => {
  it('AI1/AI2: a verified session writes only inside its own subtree', async () => {
    await setCachedAnalysis(KEY, result);
    expect(writes).toEqual([ownPath]);
    expect(writes.some((p) => p.startsWith('aiAnalyses/'))).toBe(false);
  });

  it('AI3: an unverified session and a guest write nothing at all', async () => {
    authState.currentUser = { uid: 'user-u', emailVerified: false };
    await setCachedAnalysis(KEY, result);
    authState.currentUser = null;
    await setCachedAnalysis(KEY, result);
    expect(writes).toEqual([]);
  });

  it('AI4/AI5: only the learner’s own subtree can produce a HIT', async () => {
    docContents[ownPath] = { content: JSON.stringify({ vocabulary: [{ word: 'own' }] }), createdAt: Date.now() };
    const cached = await getCachedAnalysis(KEY);
    expect((cached as unknown as { vocabulary: { word: string }[] }).vocabulary[0].word).toBe('own');
    expect(reads).toEqual([ownPath]);
  });

  it('AI2: the legacy shared corpus is never consumed, however valid or fresh it looks', async () => {
    // Perfectly shaped: parseable JSON, a matching key, and a createdAt in the
    // future so no TTL rule would reject it. It is still untrusted, because any
    // signed-in client — unverified ones included — could have written it before
    // the collection was frozen.
    docContents[legacyPath] = {
      content: JSON.stringify({ vocabulary: [{ word: 'PLANTED' }], sentences: [] }),
      createdAt: Date.now() + 365 * 86400000,
    };
    expect(await getCachedAnalysis(KEY)).toBeNull();
    expect(reads).toEqual([ownPath]);
    expect(reads.some((p) => p.startsWith('aiAnalyses/'))).toBe(false);
  });

  it('a guest has no trusted cache at all, so the planted legacy entry cannot reach them either', async () => {
    authState.currentUser = null;
    docContents[legacyPath] = { content: JSON.stringify({ vocabulary: [{ word: 'PLANTED' }] }), createdAt: Date.now() };
    expect(await getCachedAnalysis(KEY)).toBeNull();
    expect(reads).toEqual([]);
  });

  it('AI6: an expired own entry is a miss, and a read failure degrades to a miss rather than inventing a result', async () => {
    docContents[ownPath] = { content: JSON.stringify({ vocabulary: [] }), createdAt: Date.now() - 31 * 86400000 };
    expect(await getCachedAnalysis(KEY)).toBeNull();

    docContents = {};
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockRejectedValueOnce(new Error('unavailable'));
    expect(await getCachedAnalysis(KEY)).toBeNull();
  });
});
