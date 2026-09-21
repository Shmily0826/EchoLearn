// @vitest-environment node
/**
 * Release-ordering compatibility matrix (ECHO_AUTH_DATA_AND_AI_CACHE_RELEASE_V1 §3).
 *
 * Three rulesets exist in the plan and each is loaded from the file that will
 * actually be deployed, never retyped from memory:
 *   - deploy/firestore.pre-campaign.rules  = what Production runs right now
 *   - firestore.rules                      = Stage 1 (compatibility rules)
 *   - deploy/firestore.stage2.rules        = Stage 5 (tighten legacy flat create)
 *
 * The matrix answers the ordering questions by execution rather than by reading
 * source: old frontend + new Rules, new frontend + new Rules, new frontend +
 * old Rules, and what a rollback costs at each stage.
 */
import preCampaignRules from '../../../deploy/firestore.pre-campaign.rules?raw';
// Stage 1 is now an archived compatibility artifact: what Production runs is the
// Stage-5 file, which is also the repository's canonical firestore.rules.
import stage1Rules from '../../../deploy/firestore.stage1-compat.rules?raw';
import stage2Rules from '../../../firestore.rules?raw';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { beforeAll, describe, expect, it } from 'vitest';

const PROJECT_ID = 'echolearn-emulator';
const OWNER = 'user-a';
const OTHER = 'user-b';
const KEY = 'cache-key-abc';

declare const process: { env: Record<string, string | undefined> };

type Outcomes = Record<string, 'allowed' | 'denied'>;

beforeAll(() => {
  // Fail with a sentence instead of 17 connection errors if this file is ever
  // picked up outside the emulator runner.
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Firestore emulator is not running; use npm run test:emulator.');
  }
});

function dbFor(env: RulesTestEnvironment, uid: string, emailVerified: boolean) {
  return env.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: emailVerified,
  }).firestore();
}

// Inferred from the test environment rather than named from `firebase/firestore`:
// the two packages declare distinct Firestore classes, and only this one is
// structurally compatible with the document functions above.
type Store = ReturnType<typeof dbFor>;

async function withRuleset(rules: string, run: (env: RulesTestEnvironment) => Promise<void>) {
  const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
  try {
    // The emulator is a single shared instance for the whole file, so documents
    // survive between environments. Without this, a later ruleset would see the
    // earlier one's writes and a "create" would silently be evaluated as an
    // "update", which these rules treat very differently.
    await env.clearFirestore();
    // Seed through the documented admin path so a denied outcome below can only
    // come from the ruleset under test, never from missing data.
    await env.withSecurityRulesDisabled(async (admin) => {
      const store = admin.firestore();
      await setDoc(doc(store, 'aiAnalyses', KEY), {
        content: JSON.stringify({ vocabulary: [{ word: 'banked' }] }),
        createdAt: Date.now(),
      });
      await setDoc(doc(store, `aiCache/${OWNER}/analyses`, KEY), {
        content: JSON.stringify({ vocabulary: [{ word: 'private' }] }),
        createdAt: Date.now(),
      });
      await setDoc(doc(store, `users/${OWNER}/data/vocabulary`), { items: [] });
      await setDoc(doc(store, `users/${OTHER}/data/vocabulary`), { items: [] });
      await setDoc(doc(store, `feedback/${OTHER}/messages`, 'm1'), { text: 'theirs' });
      await setDoc(doc(store, 'feedback/legacy-flat-doc'), { userId: OTHER, text: 'theirs' });
    });
    await run(env);
  } finally {
    await env.cleanup();
  }
}

/** Exactly what the OLD deployed frontend writes to the shared cache. */
function legacyCacheWrite(store: Store) {
  return setDoc(doc(store, 'aiAnalyses', 'new-key-from-old-client'), {
    content: JSON.stringify({ vocabulary: [] }),
    createdAt: Date.now(),
    serverCreatedAt: serverTimestamp(),
  });
}

/** Exactly what the OLD deployed frontend submits for feedback. */
function legacyFeedbackCreate(store: Store) {
  return setDoc(doc(store, 'feedback', 'new-flat-doc'), {
    userId: OWNER,
    userEmail: `${OWNER}@example.test`,
    text: 'hello from the old client',
    createdAt: serverTimestamp(),
  });
}

/** The shape the NEW frontend uses: owner-scoped feedback subtree. */
function nestedFeedbackCreate(store: Store) {
  return setDoc(doc(store, `feedback/${OWNER}/messages`, 'm-new'), {
    userEmail: `${OWNER}@example.test`,
    text: 'hello from the new client',
    locale: 'en',
    platform: 'web',
    createdAt: serverTimestamp(),
  });
}

/** The shape the NEW frontend uses: its own cache subtree. */
function privateCacheWrite(store: Store, uid = OWNER) {
  return setDoc(doc(store, `aiCache/${uid}/analyses`, 'written-by-client'), {
    content: JSON.stringify({ vocabulary: [] }),
    createdAt: Date.now(),
  });
}

describe('Stage 1 keeps the deployed frontend working (old frontend + new Rules)', () => {
  it('still serves the legacy shared cache as a public read', async () => {
    await withRuleset(stage1Rules, async (env) => {
      const guestSnap = await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'aiAnalyses', KEY)));
      expect(guestSnap.exists()).toBe(true);
      const ownerSnap = await assertSucceeds(getDoc(doc(dbFor(env, OWNER, true), 'aiAnalyses', KEY)));
      expect(ownerSnap.exists()).toBe(true);
    });
  });

  it('freezes legacy cache writes, which the deployed client swallows as best-effort', async () => {
    await withRuleset(stage1Rules, async (env) => {
      await assertFails(legacyCacheWrite(dbFor(env, OWNER, true)));
      await assertFails(legacyCacheWrite(env.unauthenticatedContext().firestore()));
    });
    // The freeze still holds at Stage 5, so nobody can re-open the shared corpus.
    await withRuleset(stage2Rules, async (env) => {
      await assertFails(legacyCacheWrite(dbFor(env, OWNER, true)));
    });
  });

  it('keeps legacy flat feedback creation available until Stage 5', async () => {
    await withRuleset(stage1Rules, async (env) => {
      await assertSucceeds(legacyFeedbackCreate(dbFor(env, OWNER, true)));
      await assertFails(legacyFeedbackCreate(dbFor(env, OWNER, false)));
      await assertFails(legacyFeedbackCreate(env.unauthenticatedContext().firestore()));
    });
  });

  it('does not weaken ordinary user-data permissions', async () => {
    await withRuleset(stage1Rules, async (env) => {
      const owner = dbFor(env, OWNER, true);
      await assertSucceeds(setDoc(doc(owner, `users/${OWNER}/data/vocabulary`), { items: [{ id: 'x' }] }));
      await assertSucceeds(getDoc(doc(owner, `users/${OWNER}/data/vocabulary`)));
      await assertFails(getDoc(doc(dbFor(env, OTHER, true), `users/${OWNER}/data/vocabulary`)));
      await assertFails(setDoc(doc(dbFor(env, OTHER, true), `users/${OWNER}/data/vocabulary`), { items: [] }));
      await assertFails(getDoc(doc(dbFor(env, OWNER, false), `users/${OWNER}/data/vocabulary`)));
      await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `users/${OWNER}/data/vocabulary`)));
    });
  });
});

describe('The new frontend must not ship before Stage 1 is effective', () => {
  it('pre-campaign rules deny every document shape the new client writes', async () => {
    await withRuleset(preCampaignRules, async (env) => {
      const verified = dbFor(env, OWNER, true);
      // Feedback submission hard-fails: the pre-campaign catch-all deny covers
      // the whole nested subtree. This is the breakage the rules-first order
      // prevents, and it is why Stage 2 (confirm the rules took effect) gates
      // Stage 3 (ship the frontend).
      await assertFails(nestedFeedbackCreate(verified));
      await assertFails(getDocs(query(collection(verified, `feedback/${OWNER}/messages`), limit(20))));
      // The private cache is invisible too, so it never warms up.
      await assertFails(privateCacheWrite(verified));
      await assertFails(getDoc(doc(verified, `aiCache/${OWNER}/analyses`, KEY)));
    });
  });

  it('Stage 1 accepts exactly those writes', async () => {
    await withRuleset(stage1Rules, async (env) => {
      const verified = dbFor(env, OWNER, true);
      await assertSucceeds(nestedFeedbackCreate(verified));
      await assertSucceeds(privateCacheWrite(verified));
      await assertSucceeds(getDoc(doc(verified, `aiCache/${OWNER}/analyses`, KEY)));
      await assertSucceeds(getDocs(query(collection(verified, `feedback/${OWNER}/messages`), limit(20))));
    });
  });

  it('keeps the new client inside its own subtree under Stage 1', async () => {
    await withRuleset(stage1Rules, async (env) => {
      const attacker = dbFor(env, OTHER, true);
      await assertFails(getDoc(doc(attacker, `aiCache/${OWNER}/analyses`, KEY)));
      await assertFails(setDoc(doc(attacker, `aiCache/${OWNER}/analyses`, 'pre-poison'), { content: '{}', createdAt: 1 }));
      await assertFails(privateCacheWrite(attacker, OWNER));
      await assertFails(getDoc(doc(attacker, `users/${OWNER}/data/vocabulary`)));
      await assertFails(getDocs(query(collection(attacker, `feedback/${OWNER}/messages`), limit(20))));
      await assertFails(getDoc(doc(attacker, `feedback/${OWNER}/messages`, 'm1')));
      // An unverified session may not populate even its own cache.
      await assertFails(privateCacheWrite(dbFor(env, OWNER, false)));
      // Its own feedback subtree stays deletable, for the owner cleanup path.
      await assertSucceeds(deleteDoc(doc(attacker, `feedback/${OTHER}/messages`, 'm1')));
    });
  });
});

describe('Stage 5 changes exactly one condition', () => {
  it('denies legacy flat feedback creation and nothing else', async () => {
    await withRuleset(stage2Rules, async (env) => {
      await assertFails(legacyFeedbackCreate(dbFor(env, OWNER, true)));
      const verified = dbFor(env, OWNER, true);
      await assertSucceeds(nestedFeedbackCreate(verified));
      await assertSucceeds(privateCacheWrite(verified));
      await assertSucceeds(getDoc(doc(verified, `aiCache/${OWNER}/analyses`, KEY)));
      await assertSucceeds(getDoc(doc(verified, 'aiAnalyses', KEY)));
      await assertSucceeds(setDoc(doc(verified, `users/${OWNER}/data/vocabulary`), { items: [] }));
      // Existing flat documents are as closed as they were at Stage 1, which is
      // why removing them is an administrator task, not a client one.
      await assertFails(getDoc(doc(verified, 'feedback', 'legacy-flat-doc')));
      await assertFails(deleteDoc(doc(verified, 'feedback', 'legacy-flat-doc')));
    });
  });
});

// The full decision table is probed one ruleset per block and compared at the
// end, so each table is recorded against exactly one loaded ruleset and the
// comparison below can name the single operation that moves between stages.
const pre: Outcomes = {};
const one: Outcomes = {};
const two: Outcomes = {};

function operationTable(env: RulesTestEnvironment) {
  const verified = dbFor(env, OWNER, true);
  const unverified = dbFor(env, OWNER, false);
  const stranger = dbFor(env, OTHER, true);
  const guest = env.unauthenticatedContext().firestore();
  return {
    'userData.ownerWrite': () => setDoc(doc(verified, `users/${OWNER}/data/vocabulary`), { items: [] }),
    'userData.ownerRead': () => getDoc(doc(verified, `users/${OWNER}/data/vocabulary`)),
    'userData.unverifiedWrite': () => setDoc(doc(unverified, `users/${OWNER}/data/vocabulary`), { items: [] }),
    'userData.crossUidRead': () => getDoc(doc(stranger, `users/${OWNER}/data/vocabulary`)),
    'userData.guestRead': () => getDoc(doc(guest, `users/${OWNER}/data/vocabulary`)),
    'aiAnalyses.publicRead': () => getDoc(doc(guest, 'aiAnalyses', KEY)),
    'aiAnalyses.legacyWrite': () => legacyCacheWrite(verified),
    'aiCache.ownerWrite': () => privateCacheWrite(verified),
    'aiCache.ownerRead': () => getDoc(doc(verified, `aiCache/${OWNER}/analyses`, KEY)),
    'aiCache.unverifiedWrite': () => privateCacheWrite(unverified),
    'aiCache.crossUidRead': () => getDoc(doc(stranger, `aiCache/${OWNER}/analyses`, KEY)),
    'feedback.flatCreate': () => legacyFeedbackCreate(verified),
    'feedback.nestedCreate': () => nestedFeedbackCreate(verified),
    'feedback.nestedList': () => getDocs(query(collection(verified, `feedback/${OWNER}/messages`), limit(20))),
    'feedback.nestedCrossUid': () => getDocs(query(collection(stranger, `feedback/${OWNER}/messages`), limit(20))),
    'feedback.legacyFlatRead': () => getDoc(doc(verified, 'feedback', 'legacy-flat-doc')),
  };
}

async function recordOutcomes(rules: string, into: Outcomes) {
  await withRuleset(rules, async (env) => {
    for (const [name, op] of Object.entries(operationTable(env))) {
      try {
        await op();
        into[name] = 'allowed';
      } catch {
        into[name] = 'denied';
      }
    }
  });
}

describe('Operation-by-operation decision table across the three rulesets', () => {
  it('probes what Production runs today', async () => {
    await recordOutcomes(preCampaignRules, pre);
    expect(Object.keys(pre)).toHaveLength(16);
  });

  it('probes the Stage-1 artifact', async () => {
    await recordOutcomes(stage1Rules, one);
    expect(Object.keys(one)).toHaveLength(16);
  });

  it('probes the Stage-5 artifact', async () => {
    await recordOutcomes(stage2Rules, two);
    expect(Object.keys(two)).toHaveLength(16);
  });

  it('Stage 1 to Stage 5 flips the legacy create and nothing else', async () => {
    expect(one).not.toEqual(pre);
    expect(Object.keys(two).sort()).toEqual(Object.keys(one).sort());
    expect(Object.keys(one).filter((k) => one[k] !== two[k])).toEqual(['feedback.flatCreate']);
    expect(pre['feedback.flatCreate']).toBe('allowed');
    expect(one['feedback.flatCreate']).toBe('allowed');
    expect(two['feedback.flatCreate']).toBe('denied');
  });

  it('pre-campaign to Stage 1 moves exactly the new cache, the nested feedback and the frozen legacy write', async () => {
    expect(Object.keys(one).filter((k) => pre[k] !== one[k]).sort()).toEqual([
      'aiAnalyses.legacyWrite',
      'aiCache.ownerRead',
      'aiCache.ownerWrite',
      'feedback.nestedCreate',
      'feedback.nestedList',
    ]);
  });

  it('never changes an ordinary user-data decision, in either stage', async () => {
    for (const key of Object.keys(one).filter((k) => k.startsWith('userData.'))) {
      expect([pre[key], one[key], two[key]], key).toEqual([pre[key], pre[key], pre[key]]);
    }
    expect(pre['userData.ownerWrite']).toBe('allowed');
    expect(pre['userData.ownerRead']).toBe('allowed');
    expect(pre['userData.unverifiedWrite']).toBe('denied');
    expect(pre['userData.crossUidRead']).toBe('denied');
    expect(pre['userData.guestRead']).toBe('denied');
  });

  it('keeps unverified and cross-account sessions denied in all three rulesets', async () => {
    for (const key of ['aiCache.unverifiedWrite', 'aiCache.crossUidRead', 'feedback.nestedCrossUid', 'feedback.legacyFlatRead']) {
      expect([pre[key], one[key], two[key]], key).toEqual(['denied', 'denied', 'denied']);
    }
    // The shared read stays open at every stage, which is what makes a
    // frontend rollback safe and keeps banked entries serving.
    expect([pre['aiAnalyses.publicRead'], one['aiAnalyses.publicRead'], two['aiAnalyses.publicRead']]).toEqual([
      'allowed',
      'allowed',
      'allowed',
    ]);
  });
});

describe('Rollback compatibility', () => {
  it('a rules rollback to pre-campaign costs caching and feedback, never data safety', async () => {
    await withRuleset(preCampaignRules, async (env) => {
      const verified = dbFor(env, OWNER, true);
      await assertSucceeds(setDoc(doc(verified, `users/${OWNER}/data/sessions`), { id: 's1' }));
      await assertSucceeds(getDoc(doc(verified, `users/${OWNER}/data/vocabulary`)));
      await assertSucceeds(getDoc(doc(verified, 'aiAnalyses', KEY)));
      await assertFails(privateCacheWrite(verified));
      await assertFails(nestedFeedbackCreate(verified));
    });
  });

  it('a frontend rollback is safe under Stage 1, which is why Stage 5 runs last', async () => {
    await withRuleset(stage1Rules, async (env) => {
      const oldClient = dbFor(env, OWNER, true);
      // The deployed build reads the shared cache, writes its own data and
      // submits flat feedback — all three still work after Stage 1.
      await assertSucceeds(getDoc(doc(oldClient, 'aiAnalyses', KEY)));
      await assertSucceeds(setDoc(doc(oldClient, `users/${OWNER}/data/vocabulary`), { items: [] }));
      await assertSucceeds(legacyFeedbackCreate(oldClient));
    });
    await withRuleset(stage2Rules, async (env) => {
      // Under Stage 5 the old build loses feedback submission, so rolling the
      // frontend back past that point must restore the Stage-1 rules too.
      await assertFails(legacyFeedbackCreate(dbFor(env, OWNER, true)));
    });
  });
});
