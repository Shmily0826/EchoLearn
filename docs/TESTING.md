# EchoLearn testing

Use this guide to choose a local check. [GitHub CI](../.github/workflows/ci.yml)
defines the automated gate. [Release acceptance](RELEASE_CHECKLIST.md) tracks
open issues and live checks. [Test evidence](archive/test-report-2026-08-to-10.md) and
[project history](archive/progress-2026-09-to-10.md) keep the dated records.

## Run locally

Use Node 24 from [the repository version file](../.nvmrc) and install
dependencies with `npm ci`. Install the browser binaries with
`npx playwright install chromium webkit` before running browser tests.

| Use case | Entry point |
| --- | --- |
| Daily application tests | `npm test` |
| Quick desktop browser smoke | `npm run e2e:smoke` |
| Application CI checks | `npm run test:ci` runs unit tests, build, lint and the local Firestore emulator. |
| Service CI checks | `npm run test:worker`, `npm run test:reliability` and `npm run test:vps`. |
| Browser CI checks | `npm run e2e` runs the default desktop and mobile projects. GitHub runs two shards. |
| Mobile browser emulation | `npm run e2e:mobile` runs Chromium and WebKit. Use a physical Android device for APK acceptance. |
| Offline vocabulary evaluation | `npm run ai:rubric -- --transcript <json> --response <json>` and `npm run dict:eval:synthetic`. See the [script index](../scripts/README.md). |

Use Java 17 for the Firestore emulator. If port 8080 is occupied on Windows,
set `$env:ECHOLEARN_EMULATOR_HOST='127.0.0.1:18084'` for the test process.
For VPS tests, install the dependencies from
[the VPS requirements](../vps-ytdlp/requirements.txt) in a Python 3.12 virtual
environment and run the command with that environment active.

### Focused regression paths

| Area | Suites |
| --- | --- |
| Learning data and sync | [Sync unit tests](../src/services/__tests__/firestoreSync.test.ts) and [three-device emulator tests](../src/services/__tests__/firestoreRules.emulator.test.ts). |
| Captions, recovery and local media | [English source labels](../e2e/study-english-i18n.spec.ts), [Study recovery](../e2e/study-failure-recovery.spec.ts), [Bilibili reliability](../e2e/bilibili-reliability.spec.ts) and [local audio](../e2e/local-audio.spec.ts). |
| Audio quotas | [Worker cache and quota tests](../cf-worker/test/quotaGuard.test.mjs). |
| AI and CEFR | [Candidate tests](../src/services/__tests__/cefrWordList.test.ts), [cache and model-response tests](../src/services/__tests__/aiCacheTrust.test.ts), and [mocked browser analysis](../e2e/study-ai-authenticated.spec.ts). |

### Browser specs by area

Every spec in [`e2e/`](../e2e) is listed once. Names ending in `-campaign` or
`-journey` come from the batch that first added them; group by the area here
instead.

| Area | Specs |
| --- | --- |
| First run and whole journeys | [golden-path](../e2e/golden-path.spec.ts), [first-run-journey](../e2e/first-run-journey.spec.ts), [newcomer-first-run-journey](../e2e/newcomer-first-run-journey.spec.ts), [real-learning-flow-journey](../e2e/real-learning-flow-journey.spec.ts), [integrated-journey-campaign](../e2e/integrated-journey-campaign.spec.ts), [multi-lesson-continuity-journey](../e2e/multi-lesson-continuity-journey.spec.ts) |
| Study controls and layout | [study-controls-hierarchy](../e2e/study-controls-hierarchy.spec.ts), [skip-controls](../e2e/skip-controls.spec.ts), [study-material-entry-campaign](../e2e/study-material-entry-campaign.spec.ts), [learner-friction-fix](../e2e/learner-friction-fix.spec.ts), [study-english-i18n](../e2e/study-english-i18n.spec.ts) |
| Captions and failure recovery | [study-failure-recovery](../e2e/study-failure-recovery.spec.ts), [bilibili-reliability](../e2e/bilibili-reliability.spec.ts) |
| Media playback and local audio | [media-sync](../e2e/media-sync.spec.ts), [local-audio](../e2e/local-audio.spec.ts), [local-audio-new-lesson-regression-campaign](../e2e/local-audio-new-lesson-regression-campaign.spec.ts), [audio-route-lifecycle](../e2e/audio-route-lifecycle.spec.ts), [youtube-route-lifecycle](../e2e/youtube-route-lifecycle.spec.ts) |
| Dictionary | [dictionary-semantics](../e2e/dictionary-semantics.spec.ts), [dictionary-failure-loop](../e2e/dictionary-failure-loop.spec.ts) |
| AI analysis and translation | [study-ai-authenticated](../e2e/study-ai-authenticated.spec.ts), [ai-stale-response-campaign](../e2e/ai-stale-response-campaign.spec.ts), [authenticated-batch-translation](../e2e/authenticated-batch-translation.spec.ts) |
| Review and dashboard | [review-schedule-campaign](../e2e/review-schedule-campaign.spec.ts), [review-multi-day-journey](../e2e/review-multi-day-journey.spec.ts), [review-study-continuity-campaign](../e2e/review-study-continuity-campaign.spec.ts), [dashboard-consistency-journey](../e2e/dashboard-consistency-journey.spec.ts) |
| Accounts, settings and data safety | [signed-in-session](../e2e/signed-in-session.spec.ts), [logout-confirmation](../e2e/logout-confirmation.spec.ts), [settings-device-migration-journey](../e2e/settings-device-migration-journey.spec.ts), [error-boundary-destructive-confirm-campaign](../e2e/error-boundary-destructive-confirm-campaign.spec.ts) |
| Platform and analytics | [mobile-pwa](../e2e/mobile-pwa.spec.ts), [analytics-dogfood](../e2e/analytics-dogfood.spec.ts) |
| Real account (separate config) | [real-auth-regression](../e2e/real-auth-regression.spec.ts) |

`mobile-pwa` runs only in the mobile projects, and `real-auth-regression`
runs only through `npm run e2e:real-auth`. See the
[Playwright configuration](../playwright.config.ts).

To run one desktop spec, use
`npm run e2e -- e2e/study-failure-recovery.spec.ts --project=desktop-chromium`.
Campaign and journey specs are part of the default suite when discovered by
[Playwright configuration](../playwright.config.ts). Their names describe the
original coverage work. They still run in CI.

### Browser prerequisites and real-account checks

- Playwright starts Vite on port 5173. For the integrated offline journey, run
  `npm run build` and start `npm run preview -- --host 127.0.0.1 --port 5278`
  in a second terminal. The journey skips without that preview. CI starts both servers.
- If bundled Chromium is unavailable, set
  `$env:ECHOLEARN_E2E_BROWSER_CHANNEL='chrome'` for the desktop Chromium run.
  Clear the override before running WebKit.
- The real Firebase suite is discovered only by `npm run e2e:real-auth`.
  Its three cases use the Windows Credential Manager QA accounts and can
  change their data. The suite mocks dictionary lookups and blocks AI requests. Follow the
  [QA account scope](QA_ACCOUNTS.md) and deployed-host boundaries below.
  Use `npm run e2e:real-auth -- --list` for discovery without credential reads
  or network tests.
- To exercise analytics suppression locally, open the local URL with
  `?dogfood=1` or set the session marker before app startup.

## Verified local baseline

On 2026-11-09, a partial rerun on `0df9380` (the released code plus one
documentation commit) passed 1,046 application tests and 19 Worker tests,
and `tsc -b` was clean. Lint reported 0 errors and 12 warnings. The emulator,
reliability, VPS and browser suites were not rerun on that commit; the last
full run is below.

Earlier on 2026-11-09, the maintenance branch based on `3b8364c` passed 1,046
application tests, 33 Firestore emulator tests, 14 Worker tests, 27 reliability
tests, 61 VPS tests, and the build. Lint passed with 12 warnings. The
network-isolated browser checks passed 110 desktop cases, including the
integrated PWA journey, and 13 of 14 mobile cases after rerunning both mobile
projects with the updated fixture. The known Windows WebKit skip-link focus
case still fails. The dedicated smoke command passed both cases.

A separate local probe on `3b8364c` ran two Firestore clients concurrently and
confirmed the third client received both additions and retained the deletion.
The [release checklist](RELEASE_CHECKLIST.md) tracks the audio boundary issues
and live acceptance separately.

### Archived test material

| Archive | Current entry |
| --- | --- |
| [Batch 3 runner](archive/e2e/e2e-batch3-run.mjs) | [Study failure recovery](../e2e/study-failure-recovery.spec.ts) covers retry, recovery, duplicate prevention, and persistence. |
| [English i18n runner](archive/e2e/e2e-english-i18n-run.mjs) | [Study English i18n](../e2e/study-english-i18n.spec.ts) checks the caption source label and rejects the old hardcoded Chinese strings. |
| [Journey briefs](archive/maintenance) | Historical instructions for creating campaign tests. The current specs run through the [Playwright suite](../e2e). |

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
