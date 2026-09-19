# EchoLearn QA Accounts

Long-lived test accounts for authenticated Production testing, created 2026-09-19.
**This repository is PUBLIC**: no account emails, passwords, or credential values
belong in here. Note: this doc previously contained the real account emails; they
remain in Git history (rewrite is forbidden), but current docs intentionally omit
them.

## Accounts

| Account | Credential Manager target | Purpose |
|---|---|---|
| **A** | `EchoLearn-QA-Account-A` | Primary verified QA account (e.g. account "V" in `docs/VERIFIED_SYNC_TEST_DESIGN.md` T1–T4) |
| **B** | `EchoLearn-QA-Account-B` | Second account for cross-account isolation tests (e.g. "V2" in T4) |

Each generic credential stores the **account email as its UserName** and the
password as its blob. The emails are therefore recoverable from the credential
store itself (see below) and are additionally noted in the local, gitignored
`.workbuddy/` notes — never re-add them to tracked files.

## How an agent reads the credentials (same Windows user on this machine)

Helper: `scripts/credman.ps1` (P/Invoke `CredWrite`/`CredRead`/`CredDelete`; contains
no secrets).

```powershell
# 1. Recover the account email (username) for a target:
#    CredRead returns UserName; capture it, never print passwords into logs.
# 2. Read the password (stdout — capture it in the calling process, never echo):
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/credman.ps1 read EchoLearn-QA-Account-A <email-from-step-1>
```

Capability self-test (writes/reads/deletes a temporary credential):
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/credman.ps1 test`

From Node/Playwright: `execFileSync('powershell', [... 'read', target, email])` and
fill the form from the captured value; do not print it.

## Reuse rules

- Sign in with the account whose `emailVerified` state the test needs. Both
  accounts were created 2026-09-19 and email-verified by the user.
- **Do not register new accounts** for these purposes; if signup returns
  `email-already-in-use`, the account exists — sign in instead.
- Never print passwords to logs, reports, or commit them. Rotation: overwrite the
  Credential Manager entry (CredWrite overwrites in place) and note the date in the
  local `.workbuddy/` notes.
- Sign out after a session to leave a clean state; the accounts may keep small
  amounts of normal learner test data (pre-authorized).
- These accounts may be intentionally email-unverified for some tests (sync gated —
  see the 2026-09-19 logout confirmation); check `user.emailVerified` before
  planning cloud-sync journeys.

## Related, not part of this pair

- `echolearn-qa-20260919@example.invalid` — the campaign's disposable unverified
  account (permanently unverified by design; credentials in that worktree's
  gitignored `campaign/.qa-credentials`).
- `test@test.com` — the user's own manual test account. **Do not use.**
