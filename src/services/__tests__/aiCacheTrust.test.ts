import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { analyzeTranscript, getCachedAnalysis, setCachedAnalysis } from '../aiAnalysis';

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

describe('new subtitle vocabulary analyses', () => {
  const transcript = 'We arranged it. She lives here. He leaves now.';
  const suggestion = (word: string) => ({ word, context: 'Invented context.', meaningCn: '释义' });

  afterEach(() => vi.unstubAllGlobals());

  it('skips the unversioned cache, validates the model response, and reuses the new cache', async () => {
    const oldInput = new TextEncoder().encode(`A1|B1|en|8|4|${transcript}`);
    const oldHash = await crypto.subtle.digest('SHA-256', oldInput);
    const oldKey = Array.from(new Uint8Array(oldHash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const oldPath = `aiCache/user-a/analyses/${oldKey}`;
    docContents[oldPath] = {
      content: JSON.stringify({ vocabularySuggestions: [suggestion('arrang')] }),
      createdAt: Date.now(),
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ vocabularySuggestions: [
        suggestion('“Arrange”'), suggestion('arrang'), suggestion('life'), suggestion('leaf'),
        suggestion('lives'), suggestion('leaves'), suggestion('arrange'), null,
      ] }) } }],
    }));
    vi.stubGlobal('fetch', fetch);

    const fresh = await analyzeTranscript(transcript, 'A1', 'B1', 8, 4, undefined, 'en');
    const prompt = JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[1].content;
    expect(prompt).toContain('arrange | B1 | "We arranged it."');
    expect(fresh.vocabularySuggestions.map(({ word, context }) => ({ word, context }))).toEqual([
      { word: 'arrange', context: 'We arranged it.' },
      { word: 'lives', context: 'She lives here.' },
      { word: 'leaves', context: 'He leaves now.' },
    ]);
    expect(reads).not.toContain(oldPath);
    expect(writes).toEqual(reads);

    expect(await analyzeTranscript(transcript, 'A1', 'B1', 8, 4, undefined, 'en')).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the same vocabulary rules on fallback, including an empty result for an empty band', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const result = await analyzeTranscript(transcript, 'A1', 'B1');
    expect(result.vocabularySuggestions.map(({ word }) => word)).toEqual(expect.arrayContaining(['arrange', 'lives', 'leaves']));
    expect(result.vocabularySuggestions.map(({ word }) => word)).not.toContain('arrang');
    const empty = await analyzeTranscript(transcript, 'C2', 'C2');
    expect(empty.vocabularySuggestions).toEqual([]);
  });
});
