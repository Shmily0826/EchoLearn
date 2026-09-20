# Firestore Rules + frontend release sequence

Campaign: `ECHO_AUTH_DATA_AND_AI_CACHE_SAFETY_V1` → release `ECHO_AUTH_DATA_AND_AI_CACHE_RELEASE_V1`.
Firebase project: `echolearn-9f369`. Frontend hosting: Vercel (merged `main` auto-deploys).

Rules and the frontend cannot ship in an arbitrary order, so this runbook fixes the
order, the exact artifacts, the evidence that gates each step, and the rollback.
Nothing here requires editing rules by hand from memory: every deployable ruleset is
a committed file with a committed deploy config.

## Artifacts

| Stage | File | How it is produced | Deploy command |
| --- | --- | --- | --- |
| today's Production (rollback target) | `deploy/firestore.pre-campaign.rules` | `git show HEAD:firestore.rules` at baseline `b928ee8` | `npx firebase-tools deploy --only firestore:rules --config firebase.rollback.json --project echolearn-9f369` |
| Stage 1 — compatibility rules | `firestore.rules` | committed in this branch | `npx firebase-tools deploy --only firestore:rules --project echolearn-9f369` |
| Stage 5 — tightened rules | `deploy/firestore.stage2.rules` | `node scripts/rules-stage2.mjs --write` (refuses to write unless it matches exactly one anchor) | `npx firebase-tools deploy --only firestore:rules --config firebase.stage2.json --project echolearn-9f369` |

Check the Stage-5 artifact is still exactly Stage 1 plus one condition, before and
after generating:

```
node scripts/rules-stage2.mjs
diff firestore.rules deploy/firestore.stage2.rules
```

Expected: one hunk, the 7-line legacy flat-feedback `allow create: if isVerified() …`
becoming `allow create: if false; // STAGE-2: …`. sha256 of the checked-in Stage-5 file
(LF): `029fe52f0611ff8279ce539cf800d0155974987af5da048337ad45c809357e53`.
`firestore.rules` is CRLF in a Windows working checkout, so compare content with
`diff`, not raw byte size.

Compatibility proof for the whole sequence, run against the real emulator:

```
ECHOLEARN_EMULATOR_HOST=127.0.0.1:8099 npm run test:emulator
```

`src/services/__tests__/firestoreRulesCompatibility.test.ts` loads all three artifacts
and probes 16 operations against each one, then asserts which cells may change.

## Stage 1 — deploy the compatibility rules

```
npx firebase-tools deploy --only firestore:rules --project echolearn-9f369
```

This adds `aiCache/{writerUid}/analyses/{key}` (owner + verified only), makes the legacy
`aiAnalyses/{key}` public-read but write-frozen, and adds `feedback/{uid}/messages/{id}`
(owner + verified, `list` limited to 50). It keeps legacy flat `feedback/{docId}` create
working, because the frontend still in Production submits there, and it does not touch
`users/{uid}/data/{collection}`.

Deploying rules is a Production mutation and needs explicit authorization; a green
emulator is not a reason to deploy.

## Stage 2 — confirm the rules are actually effective

A successful `firebase deploy` only means the ruleset was accepted. Firestore can keep
serving the previous rules to active listeners for ~10 minutes, and this project's
rulesets cannot be listed over the REST API (`firebasemgmt.googleapis.com` v1 and
v1beta1 both answer 404), so confirmation is behavioral:

```
node scripts/verify-rules-propagation.mjs
```

GET requests only — it cannot create or delete anything. Without a credential it
verifies the exposure invariant (no unauthenticated read of `users/…`, `aiCache/…` or
`feedback/…`) and prints the legacy shared-cache status. It exits 1 with
`Stage 1 is NOT yet confirmed`, because the only rule change that an anonymous caller
can observe is one that is identical before and after Stage 1.

To close Stage 2, repeat with a **read-only** token of a disposable verified account:

```
ECHOLEARN_PROBE_TOKEN=<id token> node scripts/verify-rules-propagation.mjs
```

`aiCache/…` answers 403 before Stage 1 and 404 after it (rule allows the read, document
absent). Exit 0 = effective → proceed. Exit 1 with 403 = still propagating → wait, re-run.
As a cross-check, open Firestore → Rules in the console and confirm the active ruleset's
version and creation time match the deploy, since that is the only place the full text
of the running rules is readable.

Do not start Stage 3 on a 403.

## Stage 3 — release the frontend

Merge the release PR, then record the revision Production is building:

```
npm run deploy:check --expect <merge commit sha>
```

`<merge commit sha>` is the expected frontend revision; fill it into the release record
alongside the deploy time. Until it reports the merge commit as the newest successful
deployment, Stage 4 has nothing to verify.

## Stage 4 — verify Production behavior

Provider-free checks, in this order. Any failure stops the sequence and triggers rollback.

1. `npm run deploy:check --expect <sha>` — identity of what is live.
2. Guest, cold load: home renders, Sample lesson opens, a word saves locally, no console
   errors. Guest learning must not require a signed-in account.
3. Sign in with the disposable verified account: cloud sync completes, saved items appear
   under a second sign-in on a different browser profile.
4. Feedback: submit one message from the disposable account, then confirm in the console
   that it landed at `feedback/{uid}/messages/{id}` and **not** at `feedback/{autoid}`.
   This is a real Production write and needs authorization.
5. AI cache: `ECHOLEARN_PROBE_TOKEN=<token> node scripts/verify-rules-propagation.mjs`
   still exits 0, and an owner-scoped write is visible only under that uid. A cache HIT
   with content requires a real DeepSeek call, which is paid and out of scope without
   separate authorization — say so in the release record rather than calling it verified.
6. Ordinary paths that must be untouched: login, logout (sync-then-wipe), Local Audio
   import and restore, Review queue, dictionary lookup.
7. Account deletion is **not** part of the smoke set: it deletes an account and its cloud
   data. Exercise it only against a disposable account, only with explicit authorization,
   and report it separately.

## Stage 5 — tighten the legacy flat feedback create

Only after Stage 4 passes:

```
node scripts/rules-stage2.mjs --write
npx firebase-tools deploy --only firestore:rules --config firebase.stage2.json --project echolearn-9f369
```

Afterwards, re-run the Stage-2 confirmation probe and follow with a housekeeping commit
that copies the Stage-5 content into `firestore.rules` so the canonical file matches
Production (`node scripts/rules-stage2.mjs --write && cp deploy/firestore.stage2.rules firestore.rules`).
From that commit on, `node scripts/rules-stage2.mjs` exits 1 with `found 0` — that is the
generator's way of saying the tightening has already landed, not a broken tool.

## Rollback

| Situation | Action | Effective again |
| --- | --- | --- |
| Stage 4 fails, Stage 5 not yet applied | Redeploy the previous frontend on Vercel. Stage-1 rules are backward compatible with the deployed build, so no rules change is needed. | minutes (Vercel) |
| Rules must be reverted | `npx firebase-tools deploy --only firestore:rules --config firebase.rollback.json --project echolearn-9f369` | up to ~10 min |
| Frontend must be rolled back **after** Stage 5 | Redeploy Stage 1 (the default `firestore.rules` path) first, then the previous frontend — under Stage-5 rules the old build cannot submit feedback. | up to ~10 min |

A rules rollback never strands learner data: `users/{uid}/data/{collection}` has the same
decision table in all three rulesets (probed), so sync, study and review keep working
while cache writes and feedback fall back to pre-campaign behavior.

## Unfinished obligations this release does not close

- Historical flat `feedback/{docId}` documents (created before this release) are readable
  and deletable by neither the owner nor any client rule. They stay in Production and are
  an administrator cleanup task; the collection-group read in the emulator suite proves
  they remain separable from the new nested shape.
- The frozen `aiAnalyses/{key}` corpus keeps serving reads to the old client and is never
  read by the new one. Its documents are left in place.
- Cross-user AI cache HITs stop accruing; restoring shared caching requires a
  service-account writer, which is a separate decision with a credential cost.
