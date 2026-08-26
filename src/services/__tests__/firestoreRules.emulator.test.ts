// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import rules from '../../../firestore.rules?raw';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { mergeCollection } from '../firestoreSync';

const PROJECT_ID = 'echolearn-emulator';
const DATA_PATH = (uid: string, collection: string) => `users/${uid}/data/${collection}`;

declare const process: { env: Record<string, string | undefined> };

let testEnv: RulesTestEnvironment;

function dbFor(uid: string, emailVerified: boolean) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: emailVerified,
  }).firestore();
}

function unauthenticatedDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function clearEmulator(): Promise<void> {
  await testEnv.clearFirestore();
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Firestore emulator is not running; use npm run test:emulator.');
  }
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
    },
  });
});

beforeEach(clearEmulator);

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Security Rules', () => {
  it('denies unauthenticated and unverified access to personal data', async () => {
    const unauth = unauthenticatedDb();
    const unverified = dbFor('user-unverified', false);
    const ownPath = DATA_PATH('user-a', 'vocabulary');

    await assertFails(getDoc(doc(unauth, ownPath)));
    await assertFails(setDoc(doc(unauth, ownPath), { items: [] }));
    await assertFails(getDoc(doc(unverified, DATA_PATH('user-unverified', 'vocabulary'))));
    await assertFails(setDoc(doc(unverified, DATA_PATH('user-unverified', 'vocabulary')), { items: [] }));
  });

  it('allows a verified owner and isolates other verified users', async () => {
    const userA = dbFor('user-a', true);
    const userB = dbFor('user-b', true);
    const refA = doc(userA, DATA_PATH('user-a', 'vocabulary'));

    await assertSucceeds(setDoc(refA, { items: [{ id: 'a-only' }] }));
    await assertSucceeds(getDoc(refA));
    await assertFails(getDoc(doc(userB, DATA_PATH('user-a', 'vocabulary'))));
    await assertFails(setDoc(doc(userB, DATA_PATH('user-a', 'vocabulary')), { items: [] }));
  });

  it('keeps the current aiAnalyses authenticated policy explicit', async () => {
    const unverified = dbFor('user-unverified', false);
    const unauth = unauthenticatedDb();
    const payload = { content: 'pending-policy fixture', createdAt: 1 };

    // CURRENT POLICY — PRODUCT/SECURITY DECISION PENDING.
    await assertSucceeds(setDoc(doc(unverified, 'aiAnalyses', 'unverified-policy'), payload));
    await assertFails(setDoc(doc(unauth, 'aiAnalyses', 'unauthenticated-policy'), payload));
  });

  it('enforces verified ownership for feedback creation', async () => {
    const verified = dbFor('user-a', true);
    const unverified = dbFor('user-b', false);
    const feedback = {
      userId: 'user-a',
      userEmail: 'user-a@example.test',
      text: 'emulator feedback',
      createdAt: serverTimestamp(),
    };

    await assertSucceeds(setDoc(doc(verified, 'feedback', 'feedback-a'), feedback));
    await assertFails(setDoc(doc(unverified, 'feedback', 'feedback-b'), {
      ...feedback,
      userId: 'user-b',
    }));
  });
});

describe('Firestore sync document integration', () => {
  it('round-trips vocabulary, sentences, sessions, tombstones, and server metadata', async () => {
    const user = dbFor('user-a', true);
    const collections = {
      vocabulary: [{ id: 'word-1', word: 'roundtrip', updatedAt: 100 }],
      sentences: [{ id: 'sentence-1', text: 'Round trip.', updatedAt: 100 }],
      sessions: [{ id: 'session-1', createdAt: 100, updatedAt: 100 }],
    };

    for (const [name, items] of Object.entries(collections)) {
      await assertSucceeds(setDoc(doc(user, DATA_PATH('user-a', name)), {
        items,
        tombstones: { 'deleted-fixture': 200 },
        updatedAt: 200,
        serverUpdatedAt: serverTimestamp(),
      }));
    }

    for (const [name, items] of Object.entries(collections)) {
      const snapshot = await assertSucceeds(getDoc(doc(user, DATA_PATH('user-a', name))));
      const data = snapshot.data() as Record<string, unknown>;
      expect(data.items).toEqual(items);
      expect(data.tombstones).toEqual({ 'deleted-fixture': 200 });
      expect(data.updatedAt).toBe(200);
      expect(data.serverUpdatedAt).toBeDefined();
    }
  });

  it('treats a legacy document without tombstones as an empty tombstone map', async () => {
    const user = dbFor('user-a', true);
    const ref = doc(user, DATA_PATH('user-a', 'vocabulary'));
    await assertSucceeds(setDoc(ref, { items: [{ id: 'legacy-word', updatedAt: 100 }], updatedAt: 100 }));

    const snapshot = await assertSucceeds(getDoc(ref));
    const data = snapshot.data() as { items: unknown[]; tombstones?: Record<string, number> };
    expect(data.items).toHaveLength(1);
    expect(data.tombstones ?? {}).toEqual({});
  });

  it('keeps an authoritative tombstone through a stale-device merge', async () => {
    const user = dbFor('user-a', true);
    const ref = doc(user, DATA_PATH('user-a', 'vocabulary'));
    const live = { id: 'stale-delete', word: 'delete-me', updatedAt: 100 };

    await assertSucceeds(setDoc(ref, { items: [live], tombstones: {}, updatedAt: 100 }));
    await assertSucceeds(setDoc(ref, { items: [], tombstones: { [live.id]: 200 }, updatedAt: 200 }));

    const merged = mergeCollection([live], [], {}, { [live.id]: 200 }, (item) => item.updatedAt ?? 0);
    expect(merged.items).toEqual([]);
    expect(merged.tombstones).toEqual({ [live.id]: 200 });
    await assertSucceeds(setDoc(ref, { items: merged.items, tombstones: merged.tombstones, updatedAt: 300 }));

    const finalData = (await assertSucceeds(getDoc(ref))).data() as Record<string, unknown>;
    expect(finalData.items).toEqual([]);
    expect(finalData.tombstones).toEqual({ [live.id]: 200 });
  });

  it('keeps the later updatedAt conflict winner in an emulator-backed document', async () => {
    const user = dbFor('user-a', true);
    const ref = doc(user, DATA_PATH('user-a', 'vocabulary'));
    const cloud = { id: 'conflict', word: 'cloud', updatedAt: 100 };
    const local = { id: 'conflict', word: 'local-later', updatedAt: 200 };

    await assertSucceeds(setDoc(ref, { items: [cloud], tombstones: {}, updatedAt: 100 }));
    const merged = mergeCollection([local], [cloud], {}, {}, (item) => item.updatedAt ?? 0);
    expect(merged.items).toEqual([local]);
    await assertSucceeds(setDoc(ref, { items: merged.items, tombstones: merged.tombstones, updatedAt: 200 }));
    expect(((await assertSucceeds(getDoc(ref))).data() as { items: typeof local[] }).items).toEqual([local]);
  });

  it('keeps empty collections valid without touching another collection', async () => {
    const user = dbFor('user-a', true);
    await assertSucceeds(setDoc(doc(user, DATA_PATH('user-a', 'vocabulary')), { items: [], tombstones: {}, updatedAt: 1 }));
    await assertSucceeds(setDoc(doc(user, DATA_PATH('user-a', 'sentences')), { items: [{ id: 's-1' }], tombstones: {}, updatedAt: 1 }));

    const vocabularySnapshot = await assertSucceeds(getDoc(doc(user, DATA_PATH('user-a', 'vocabulary'))));
    expect((vocabularySnapshot.data() as { items: unknown[] }).items).toEqual([]);
    const sentenceSnapshot = await assertSucceeds(getDoc(doc(user, DATA_PATH('user-a', 'sentences'))));
    expect((sentenceSnapshot.data() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('allows a verified user to delete only their own synced document', async () => {
    const userA = dbFor('user-a', true);
    const userB = dbFor('user-b', true);
    const refA = doc(userA, DATA_PATH('user-a', 'sessions'));
    await assertSucceeds(setDoc(refA, { items: [{ id: 'session-a' }], tombstones: {}, updatedAt: 1 }));
    await assertSucceeds(deleteDoc(refA));
    await assertFails(deleteDoc(doc(userB, DATA_PATH('user-a', 'sessions'))));
  });
});
