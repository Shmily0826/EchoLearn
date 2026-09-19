# F1 — Verified-Account Sync Test Design

Status: DESIGN (awaiting a verified QA account; no test infrastructure created yet).
Origin: 2026-09-19 V2 closure follow-up F1. Cost boundary: only small normal-learner
Firestore mutations on the dedicated QA account; zero provider calls.

## Why

The 2026-09-19 auth work changed the logout boundary for unverified accounts. The
cross-account isolation invariant is unit-proven (AuthContext A1/A2/A5 with mocks),
but the **verified-account cloud path** — the merge that the landing page promises —
has never been exercised end-to-end, because every available QA account is
permanently unverified. This design defines the exact behaviors to pin once a
verified account (or the Firestore emulator with a verified-claim token) exists.

## Behaviors to pin (in order)

- **T1 Guest→verified merge.** Guest saves word W1 (device-local). Sign in as
  verified account V. Assert: the post-login auto-sync fires
  (`AuthContext.tsx` post-login effect), W1 is **merged, not replaced** into
  `users/{V}/data/vocabulary` (merge semantics: `mergeById` keeps the later
  `updatedAt`), and the UI still shows W1 after the boundary.
- **T2 Refresh persistence through the cloud.** Reload after T1 → auto-sync re-runs
  → W1 persists. W1 now exists both locally and in V's cloud.
- **T3 Verified logout protects data.** Logout of V → sync-before-logout uploads
  pending changes → sign-out succeeds → device data is cleared, but W1 **still
  exists in V's cloud** (the protection the sync guard exists for).
- **T4 Second-account isolation.** Verified account V2 signs in on the same device.
  Assert: V2's vocabulary does **not** contain W1 (it belongs to V's cloud only);
  V2's own cloud data, if any, renders; sync metadata does not attribute V's state
  to V2. This is the live-path counterpart of unit test A2.
- **T5 Unverified interlude.** (Already deterministic: AuthContext A1/A2 — unverified
  logout clears device data, so nothing can leak into the next verified login.)

## Execution strategy (two layers)

1. **Deterministic / emulator layer (preferred first).** The Firestore emulator
   harness already exists (`scripts/run-firestore-emulator.mjs`,
   `firestoreRules.emulator.test.ts`). Extend it to drive `syncWithCloud` /
   `pushItemsToCloud` against the emulator with a fabricated **verified** token
   (`email_verified: true`), seeding local storage per scenario and asserting the
   resulting emulator documents. This pins merge semantics, tombstone handling, and
   the T3/T4 boundary logic without any Production write and without a real account.
2. **Live Production layer (one session, dogfood rules).** With a verified QA
   account: run T1→T4 against `https://echo-learn.uk/?dogfood=1` with network
   observation (`/api/ai` = 0; Firestore mutations limited to the QA account's own
   docs, per the standing permission). Leave the QA account's data in place — no
   destructive cleanup.

## Exit criteria

- T1–T4 green at the emulator layer, plus T1–T4 green once on live Production.
- `PROGRESS.md` / `TEST_REPORT.md` updated: "verified-account sync path" moves from
  BACKLOG to PASS with the evidence named.
