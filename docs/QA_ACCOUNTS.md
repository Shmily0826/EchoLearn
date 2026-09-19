# EchoLearn QA Accounts

Long-lived test accounts for authenticated Production testing. Created 2026-09-19 at
the user's direction. **Passwords live ONLY in Windows Credential Manager on this
machine — never in the repo, never in logs.**

## Accounts

| Account | Email (Gmail +alias → base inbox rng2018520@gmail.com) | Credential Manager target | Purpose |
|---|---|---|---|
| **A** | `rng2018520+echolearn-qa-a@gmail.com` | `EchoLearn-QA-Account-A` | Primary verified QA account (e.g. account "V" in `docs/VERIFIED_SYNC_TEST_DESIGN.md` T1–T4) |
| **B** | `rng2018520+echolearn-qa-b@gmail.com` | `EchoLearn-QA-Account-B` | Second account for cross-account isolation tests (e.g. "V2" in T4) |

Email verification: Gmail delivers `+alias` mail to the base inbox, so verification
links are clicked by the user from the one Gmail inbox.

## How an agent reads the credentials

All commands run as the same Windows user on this machine. Helper script:
`campaign/credman.ps1` in the QA worktree (P/Invoke `CredWrite`/`CredRead`/`CredDelete`).

```powershell
# read (prints the password to stdout — capture it, never echo it into logs)
powershell -NoProfile -ExecutionPolicy Bypass -File campaign/credman.ps1 read EchoLearn-QA-Account-A rng2018520+echolearn-qa-a@gmail.com
```

From Node/Playwright: `execFileSync('powershell', [... 'read', target, email])` and
fill the form from the captured value; do not print it.

Capability self-test: `powershell -File campaign/credman.ps1 test`
(writes/reads/deletes a temporary credential).

## Rules

- Reuse these accounts via the fixed Credential Manager targets. **Do not register
  new accounts** unless the user asks; if a signup returns `email-already-in-use`
  for these aliases, the account exists — sign in instead.
- Passwords: never printed to logs, reports, or committed. Rotation = overwrite the
  Credential Manager entry (CredWrite overwrites in place) and note the date here.
- Sign out after a session to leave a clean pre-verification/pre-test state; the
  accounts are allowed to keep small amounts of normal learner test data.
- These accounts may be email-unverified at times (useful state: sync is gated —
  see the 2026-09-19 logout fix). Check `user.emailVerified` before planning
  cloud-sync journeys.

## Related, not part of this pair

- `echolearn-qa-20260919@example.invalid` — the 2026-09-19 campaign's disposable
  unverified account (credentials in that worktree's `campaign/.qa-credentials`,
  gitignored). Still usable for unverified-state tests; permanently unverified.
- `test@test.com` — the user's own manual test account. **Do not use.**
