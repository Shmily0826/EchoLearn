# EchoLearn Testing

Start here for the commands to run, the evidence behind the latest changes,
and the checks that still need acceptance. [GitHub CI](../.github/workflows/ci.yml)
defines the automated release checks. [TEST_REPORT.md](../TEST_REPORT.md) and
[PROGRESS.md](../PROGRESS.md) retain the dated evidence and project history.

## Run locally

From the repo root, use Node 24 to match CI and install dependencies with `npm ci`.

| What you want to verify | Command |
| --- | --- |
| Fast application checks | `npm test` |
| One application test file | `npm test -- src/services/__tests__/firestoreSync.test.ts` |
| TypeScript and production build | `npm run build` |
| Lint | `npm run lint` |
| Firestore rules and sync against the local emulator (Java 17 in CI) | `npm run test:emulator` |
| Cloudflare Worker | `node --test cf-worker/test/*.test.mjs` |
| Reliability tooling | `node --test scripts/reliability-baseline/*.test.mjs` |
| VPS Python service (Python 3.12 in CI) | In a virtual environment, `python -m pip install "fastapi>=0.110" "python-multipart>=0.0.9" yt-dlp`, then `python -m unittest discover -s vps-ytdlp -p "test*.py"` |
| Browser journeys | `npm run e2e` after `npx playwright install chromium webkit` |
| Mobile browser emulation | `npm run e2e:mobile` |

`npm run test:ci` is a local shortcut for the application job. To cover the
same areas as GitHub CI, also run the Worker, reliability, VPS, and browser
commands above. GitHub runs the browser suite in two shards.

On Windows, if port 8080 is occupied, run
`$env:ECHOLEARN_EMULATOR_HOST='127.0.0.1:18084'` before `npm run test:emulator`.

### Browser prerequisites and skips

- Playwright starts Vite on port 5173. To include the integrated offline journey,
  run `npm run build` and keep `npm run preview -- --host 127.0.0.1 --port 5278`
  running in a second terminal during `npm run e2e`. The journey skips without
  that build preview. CI starts both servers.
- For a focused run, use `npm run e2e -- e2e/study-failure-recovery.spec.ts --project=desktop-chromium`.
  If bundled Chromium is unavailable, set `$env:ECHOLEARN_E2E_BROWSER_CHANNEL='chrome'`
  in PowerShell to use installed Chrome for that Chromium project. Clear the
  override before running WebKit.
- `npm run e2e:mobile` runs `mobile-pwa.spec.ts` in emulated Chromium and WebKit.
  Android APK acceptance is a separate physical-device check.
- `real-auth-regression.spec.ts` skips when the Windows Credential Manager QA
  credentials are unavailable. CI uses synthetic-session tests for that boundary.
  See [QA accounts](QA_ACCOUNTS.md) for the real-account procedure and its scope.
- To test analytics suppression locally, set the session marker before app
  startup or open the localhost URL with `?dogfood=1`.

## Validation status

Snapshot as of 2026-11-09. Update the relevant row when new evidence is recorded,
with the commit or deployment tested and the environment used.

| Area | Evidence already recorded | Still open |
| --- | --- | --- |
| Audio quota, `2b98105` | Locally verified with 14 Worker tests and 50 related Vitest tests. A cache miss consumes quota and subsequent cached byte ranges do not. | Deployed Worker smoke. Two simultaneous cold requests and valid suffix or overlong-end ranges were reproduced locally as separate defects. |
| Cross-device sync, `3ab9bf2` | 33 local Firestore emulator tests passed, including stale-device automatic save and manual upload. The third device receives both additions and preserves the deletion. The local working tree also passed 1,043 Vitest tests and the production build. | Simultaneous device writes in the emulator, then a QA-account smoke with the updated client on each device. |
| Prior production baseline, `cc08c94` | Historical GitHub `test` and `e2e` jobs passed. The 2026-10-12 production checks covered AI seek labels and saving a word across reload. | The two local fixes above have separate acceptance work. |
| VPS YouTube English caption gate | The 2026-10-05 production probe reached the VPS. | Inconclusive. YouTube blocked subtitle acquisition before the gate ran. A successful acquisition is needed to exercise the gate. |
| Android local audio | The browser import path and file-size contract have prior coverage. | Physical Android device acceptance for a roughly 90 MB audio file with subtitles, playback, and recovery after refresh. |

See the [October production evidence](../TEST_REPORT.md#2026-10-12-echo-20261012-beta-closeout---production-behaviour-evidence),
[VPS gate evidence](../TEST_REPORT.md#2026-10-05-echo-20261005-vps-gate-doc-closeout---vps-production-evidence),
[audio regression](../cf-worker/test/quotaGuard.test.mjs), and
[three-device emulator regression](../src/services/__tests__/firestoreRules.emulator.test.ts).

### Archived browser runners

| Historical runner | Supported Playwright coverage |
| --- | --- |
| [Batch 3 runner](archive/e2e/e2e-batch3-run.mjs) | [Study failure recovery](../e2e/study-failure-recovery.spec.ts) covers failed captions and retry, save/delete, duplicate prevention, recovery from an invalid URL, and persistence across reload. Caption cases use mocked responses. The word cases use the bundled lesson. |
| [English i18n runner](archive/e2e/e2e-english-i18n-run.mjs) | [Study English i18n](../e2e/study-english-i18n.spec.ts) loads a mocked caption, checks the English source label, and rejects the same five hardcoded Chinese strings. |

On 2026-11-09, the two supported specs passed all 11 cases in local desktop
Chromium on the working tree based on `3ab9bf2` with the updated test fixtures.
The old runners are preserved for historical reference.

## Deployed-host browser validation

All developer, AI, and automation browser validation against a deployed
EchoLearn host defaults to analytics suppression.

The canonical Production test entry is:

`https://echo-learn.uk/?dogfood=1`

The app consumes `dogfood=1` before render, stores the session-only marker
`sessionStorage['echolearn_test_traffic'] = '1'`, and removes only that query
parameter. An equivalent pre-app `sessionStorage` marker is also valid for
automation.

Preview and Staging hosts that share Production analytics must use the same
suppression rule before browser validation.

Dogfood is ANALYTICS-SAFE ONLY. It suppresses Vercel Web Analytics and Firebase
Analytics custom events for the marked session. It does not authorize:

- Production Firebase, Auth, or Firestore mutation;
- product API traffic or changes to user/product data;
- paid-provider traffic, AI-provider traffic, or ASR requests.

Those activities require a separate explicit safety scope and must not be
assumed safe because the analytics marker is present.

## Verifying a deployment and its behaviour

Two different questions come up after a push, and they need two different tools.
Neither answers the other.

| Question | Tool |
|---|---|
| **Identity** — which commit is Production running? | `npm run deploy:check` (`scripts/prod-deploy-check.mjs`) |
| **Behaviour** — does the running app act as that change intends? | `npm run ai:seek-smoke` (`scripts/ai-seek-smoke.mjs`) |

### Identity: `npm run deploy:check`

Read-only and credential-free. Vercel publishes every deployment back to GitHub
as a repository deployment created by `vercel[bot]`, so the deployed commit and
its build status can be read from the public GitHub API — no Vercel token and no
`vercel login`. It compares the newest Production deployment against your local
`HEAD` (override with `--expect <sha>`).

Exit codes: `0` the expected commit is deployed and built, `1` it is not, `2`
error (including a GitHub rate limit, which reports its reset time).

**Identity only.** A successful deployment record proves a build exists and
Vercel accepted it; it does not prove the running app behaves correctly. Note
also that a failed deployment is never promoted to the Production alias, which
is how a red commit can leave Production untouched.

### Behaviour: `npm run ai:seek-smoke`

It signs in on `?dogfood=1`, so the analytics rule above still applies, and the
paid-provider rule below still applies: the marker does not authorise provider
traffic.

- It reads the labels the live page actually rendered and compares them against
  an offline re-alignment computed by the app's own matcher. Only suggestions
  where the **raw caption blocks** and the **rendered sentence lines** disagree
  can decide the verdict; a run containing none reports INCONCLUSIVE, never PASS.
- **Do not try to prove a deployment by comparing the local build with the live
  one.** The local build has no `VITE_SENTRY_DSN`, so Sentry is tree-shaken out
  and the entry chunk is ~85 KB smaller; framework chunks can match byte-for-byte
  while every application chunk hash differs.
- Paid provider: the page's `/api/ai` request is gated through
  `scripts/paid-provider-guard.mjs`. With the policy **unset the request is
  aborted**, so a run can only succeed from a cache HIT and cannot spend. One
  real call requires
  `ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=1`.
- Exit codes: `0` PASS, `1` FAIL, `2` blocked/config error, `3` INCONCLUSIVE.

## Contract boundary

This visitor-analytics contract covers Vercel Web Analytics and Firebase /
Google Analytics collection. Sentry is separate and explicitly excluded.
