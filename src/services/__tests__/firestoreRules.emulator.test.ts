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
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
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

  it('freezes the legacy shared AI cache: readable by anyone, writable by nobody', async () => {
    const writer = dbFor('user-a', true);
    const stranger = dbFor('user-b', true);
    const unverified = dbFor('user-unverified', false);
    const unauth = unauthenticatedDb();
    const key = 'deadbeef'.repeat(4);
    const ref = (f: ReturnType<typeof dbFor>) => doc(f, 'aiAnalyses', key);

    // The audit's reproduction showed a verified, a stranger AND an unverified
    // session could each overwrite this shared doc, and the last write was then
    // served to every learner. Under the frozen policy none of them can.
    await assertFails(setDoc(ref(writer), { content: 'legit', createdAt: 1 }));
    await assertFails(setDoc(ref(stranger), { content: 'POISONED', createdAt: 2 }));
    await assertFails(setDoc(ref(unverified), { content: 'POISONED-UNVERIFIED', createdAt: 3 }));
    await assertFails(setDoc(ref(unauth), { content: 'POISONED-ANON', createdAt: 4 }));
    await assertFails(deleteDoc(ref(writer)));

    // Already-banked entries stay readable at the rule level (the frontend no
    // longer consumes them — pinned in aiCacheTrust.test.ts — but the deployed
    // client still does until the rules-then-frontend order is followed, and a
    // public read of non-PII AI output is not itself a leak).
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'aiAnalyses', key), { content: 'banked', createdAt: 1 });
    });
    const served = await assertSucceeds(getDoc(ref(unauth)));
    expect((served.data() as { content: string }).content).toBe('banked');
  });

  it('binds each AI cache entry to its writer so no other account can poison it', async () => {
    const owner = dbFor('user-a', true);
    const attacker = dbFor('user-b', true);
    const unverified = dbFor('user-unverified', false);
    const key = 'cafebabe'.repeat(4);
    const ownPath = `aiCache/user-a/analyses/${key}`;
    const payload = { content: 'own analysis', createdAt: 1 };

    await assertSucceeds(setDoc(doc(owner, ownPath), payload));
    await assertSucceeds(getDoc(doc(owner, ownPath)));

    // AI1/AI2: the same predictable key in someone else's subtree is unreachable.
    await assertFails(setDoc(doc(attacker, ownPath), { content: 'POISONED', createdAt: 2 }));
    await assertFails(getDoc(doc(attacker, ownPath)));
    await assertFails(deleteDoc(doc(attacker, ownPath)));
    // AI3: unverified and anonymous sessions cannot write at all.
    await assertFails(setDoc(doc(unverified, `aiCache/user-unverified/analyses/${key}`), payload));
    await assertFails(setDoc(doc(unauthenticatedDb(), `aiCache/user-a/analyses/${key}`), payload));
    // ...and cannot read a stranger's cache either.
    await assertFails(getDoc(doc(unverified, ownPath)));
  });

  it('lets the owner list and delete their own feedback, and nobody else’s', async () => {
    const owner = dbFor('user-a', true);
    const stranger = dbFor('user-b', true);
    const unverified = dbFor('user-unverified', false);
    const messagePath = (id: string) => 'feedback/user-a/messages/' + id;
    const messageIn = (f: ReturnType<typeof dbFor>, id: string) => doc(f, messagePath(id));
    const messagesIn = (f: ReturnType<typeof dbFor>) => collection(f, 'feedback', 'user-a', 'messages');

    await assertSucceeds(setDoc(messageIn(owner, 'm1'), {
      userEmail: null, text: 'owner-only body', locale: 'en', createdAt: serverTimestamp(),
    }));
    // A list must mirror the rule's limit, which is exactly what the client's
    // bounded delete loop does.
    await assertSucceeds(getDocs(query(messagesIn(owner), limit(50))));
    await assertFails(getDocs(query(messagesIn(owner))));
    await assertFails(getDocs(query(messagesIn(owner), limit(51))));
    expect((await getDocs(query(messagesIn(owner), limit(50)))).docs).toHaveLength(1);

    // AD3: a non-owner cannot read, list, write or delete, so the subtree is not
    // a public window onto who submitted feedback.
    await assertFails(getDoc(messageIn(stranger, 'm1')));
    await assertFails(getDocs(query(messagesIn(stranger), limit(50))));
    await assertFails(setDoc(messageIn(stranger, 'm1'), { text: 'injected', createdAt: serverTimestamp() }));
    await assertFails(deleteDoc(messageIn(stranger, 'm1')));
    await assertFails(setDoc(messageIn(unverified, 'm1'), { text: 'throwaway', createdAt: serverTimestamp() }));
    await assertFails(getDoc(messageIn(unauthenticatedDb(), 'm1')));
    // The owner can remove it, which is what makes the deletion promise keepable.
    await assertSucceeds(deleteDoc(messageIn(owner, 'm1')));
    expect((await getDocs(query(messagesIn(owner), limit(50)))).docs).toHaveLength(0);
  });

  it('keeps legacy flat feedback closed to clients, which is why it needs an admin pass', async () => {
    const owner = dbFor('user-a', true);
    // No client ever held these autogenerated ids, and no rule has ever allowed
    // a read or list, so no owner-side deletion rule can reach them: they are
    // documented as administrator cleanup rather than silently claimed deleted.
    await assertFails(deleteDoc(doc(owner, 'feedback', 'legacy-random-id')));
    await assertFails(getDoc(doc(owner, 'feedback', 'legacy-random-id')));
    await assertFails(getDocs(query(collection(owner, 'feedback'))));
  });

  it('proves the legacy feedback range is separable from the new owner subtree', async () => {
    // Seed both shapes the way they will coexist after the rules deploy.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'feedback', 'legacy-a'), { userId: 'user-a', text: 'old', createdAt: 1 });
      await setDoc(doc(admin, 'feedback', 'legacy-b'), { userId: 'user-b', text: 'old', createdAt: 2 });
      await setDoc(doc(admin, 'feedback', 'user-a', 'messages', 'm1'), { text: 'new', createdAt: 3 });
    });

    const owner = dbFor('user-a', true);
    // An owner's deletion removes only their nested document…
    await assertSucceeds(deleteDoc(doc(owner, 'feedback', 'user-a', 'messages', 'm1')));
    // …and cannot touch the legacy ones, which is exactly the residual gap.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const legacy = await getDocs(collectionGroup(admin, 'feedback'));
      expect(legacy.docs.map((d) => d.id).sort()).toEqual(['legacy-a', 'legacy-b']);
      // A collection-group query on `feedback` selects precisely the legacy
      // documents and cannot sweep the new subtree in, because those live in a
      // group named `messages`. So an administrator can enumerate, verify and
      // then delete the historical range without touching current data.
      expect(legacy.docs.every((d) => d.ref.path.split('/').length === 2)).toBe(true);
      const current = await getDocs(collectionGroup(admin, 'messages'));
      expect(current.docs).toHaveLength(0);
    });
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
