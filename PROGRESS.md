# EchoLearn Progress

This file is the source of truth for current project status only. Historical root causes belong in `.workbuddy/memory/YYYY-MM-DD.md`, validation detail belongs in `TEST_REPORT.md`, and durable rules belong in `DECISIONS.md`.

Updated: 2026-09-05

## Maintenance convention

After each autonomous engineering cycle, append the actual test/validation results, evidence boundary, repository state, and next decision to `TEST_REPORT.md`; update this file's current status when the decision or open gap changes. Preserve historical report entries and do not replace them with chat-only notes.

## Current priority

Recruiter-safe YouTube subtitle stabilization and reliable real Video → Transcript → Study behavior.

## Current separation

- Branch: `main`; release-record commit `6176800e59ce4bdd8bb67b60ac78e92fada9e954` is synchronized to `origin/main`.
- The accepted production Worker is version `9fcbd50b-d197-4691-951b-d9a8c4039197` (active deployment `974ee470-4498-4c79-b74a-b6109cc2feaf`); the Worker source is the only production candidate in this release record.
- The source-record push produced verified `READY` Vercel deployment `dpl_GAAtbhbfZmjgevm1Pfz1vGeU5n5X` for commit `6176800e59ce4bdd8bb67b60ac78e92fada9e954`; subsequent docs-only pushes may produce equivalent-source Vercel rebuilds, so deployment IDs are operational metadata rather than this source-of-truth status. Runtime frontend/API source is unchanged because the Vercel/frontend candidate files were excluded.
- Production is a separate validation layer from local work and GitHub state; its acceptance evidence is recorded below and in `TEST_REPORT.md`.

## Acceptance gate

The gate is satisfied for the Worker-only production path: one sequential caption-only matrix achieved 7/7 positive controls (100%, above the 80% gate), the no-caption control failed truthfully with typed `provider_timeout`, and the real guest Video → Transcript → Study flow displayed 277 non-empty lines with usable controls and zero page errors. Cache HIT/MISS was not captured per matrix row, so this is not claimed as a cold provider matrix; the cache namespace is shared at transcript version `v=1`.

## Open state

The Worker-only production acceptance is complete under `ECHO-20260901-0139`. The remaining local `api/transcript.ts`, frontend service, and VPS changes describe an un-deployed coordinated fallback candidate; they are not required for the accepted Worker-only path and must not be deployed merely because they remain dirty. ECHO-20260905-0012 locally corrects frontend fallback ordering so Worker `asr_required` and server `provider_timeout` do not prematurely suppress independent non-ASR caption routes; no production mutation occurred.

## Next

Keep the local production-sensitive Worker and VPS candidates separate until a future coordinated release is explicitly justified and validated. Browser-native and ScrapingBee experiments are paused/archive candidates and remain unintegrated; no new VPS/provider spend is planned. The next step is local review/validation of the coordinated fallback candidate and its production configuration; do not deploy the uncommitted change from this cycle.

## 2026-09-04 Browser execution feasibility preparation

- `ECHO-20260904-0021` read-only AWS inventory found no Chrome/Chromium, Xvfb, display stack, browser automation runtime, or container runtime on `3.107.69.57`; the host had 2 CPUs, 908 MiB total RAM, about 510 MiB available, and no swap. No browser experiment ran and the production service was unchanged.
- `ECHO-20260904-0032` established the recoverable local method: launch real headed system Chrome `152.0.7977.66` directly with a fresh disposable `--user-data-dir`, loopback CDP, `--no-first-run`, and `--no-default-browser-check`; attach with Playwright `chromium.connectOverCDP`. A/B first showed media was unnecessary for caption capture; the bounded matrix then kept media blocked.
- Local result: M7 A/B both succeeded with 65,976 timedtext bytes and 466 parsed events/segments; the 24-video matrix was 18 SUCCESS / 4 PLAYER_BLOCKED / 1 CAPTION_PARTIAL_COVERAGE / 1 NO_CAPTION_TRACK, with 17/18 intended-available success and 12/12 stability repeats. Matrix latency was 11,554–14,225 ms (12,047 ms average); Node RSS was 140,845,056–262,078,464 bytes. Chrome working-set/server cost remains unmeasured.
- This is local prototype evidence only, separate from GitHub, Worker/Vercel, VPS, AWS, and production acceptance. The next executable gate is a fresh-profile, single-concurrency pilot on a separate browser execution environment with explicit resource, privacy, timeout, cleanup, and fail-closed acceptance criteria; co-location requires new measured evidence and explicit authorization.

## 2026-09-04 Browser-resource telemetry gate — ECHO-20260904-0148

- Added local-only CIM/PowerShell descendant-tree sampling and CDP encoded-byte/category telemetry under `scripts/local-native-youtube/`; telemetry is nullable/diagnostic and does not affect caption classification. Focused tests passed 13/13 and syntax/diff checks passed.
- Three corrected about:blank smoke cycles produced 2 valid process-tree samples each, 0 requests, 0 cookies, and first-attempt cleanup. The one authorized M7 media-blocked positive produced SUCCESS in 13,605 ms with Node RSS 111,534,080 bytes, peak Chrome-tree working set 1,956,499,456 bytes, 15 processes, and 5,158,461 encoded bytes across 210 requests (media 0 encoded bytes).
- This remains local Windows evidence only. For a future single-concurrency pilot, use an isolated host with at least 4 GiB total RAM and a 2.5 GiB task-browser available-memory budget; do not infer cost, concurrency, server performance, or production behavior. The existing 908 MiB/no-swap AWS host remains outside the candidate set.

## Next gate

Use the measured footprint to define a separately isolated, explicitly authorized one-slot browser pilot with fresh profiles, media blocking, fail-closed resource telemetry, timeout, cleanup, and memory-pressure acceptance checks. Stop at sizing/acceptance review; do not create infrastructure or deploy from this local evidence.

## 2026-09-04 Linux headed/Xvfb pilot preflight — ECHO-20260904-1116

- Read-only preflight found no reusable separate non-production host and no configured cloud provisioning path on this machine. `aws`, `doctl`, `gcloud`, `az`, Terraform, Docker, and Podman were absent; only generic `ssh/scp` binaries were present without a usable non-production target/identity. No secrets were read.
- The Linux headed/Xvfb pilot was not executed. No host was created or reused, no IP/cost/lifecycle state exists, and the existing 908 MiB/no-swap production AWS VPS remains excluded.
- This task is blocked only on external host access or explicitly configured provisioning credentials. Local repo/GitHub/production state remains unchanged apart from this cumulative documentation entry.

## Next gate

Provide an already-running isolated Linux host with SSH access or an approved disposable-host provisioning path with unambiguous plan/region/cost. Then run the bounded 4 GiB single-concurrency headed/Xvfb pilot with the accepted telemetry, two-positive-control, media-blocking, cleanup, and fail-closed criteria; do not integrate production in that pilot cycle.

## 2026-09-04 Browser-native fallback productization gate — ECHO-20260904-1128

- Decision: **GO for gated productization work; NO-GO for production integration now.** The local browser path has credible recovery value for caption-bearing provider/network failures, but its 13.6 s latency and 1.96 GB Chrome-tree peak require a dedicated single-concurrency service.
- The prior DO `170.64.143.102` was correctly destroyed after explicit authorization and exhausted its materially distinct yt-dlp/session/cookie/visitor-data axes. It is complete, not unfinished work. Do not recreate it for this gate.
- Recommended architecture: option A, a private dedicated browser fallback invoked only after eligible normal caption provider timeout/failure. Do not use browser-first acquisition, a managed third-party service, or production AWS co-location. Keep ASR/audio and definitive no-caption/semantic outcomes outside this fallback.
- Linux/Xvfb is not required before local interface/mock/contract work, but is mandatory before real browser-service acceptance or production deployment. Batch all server-dependent checks on one future isolated 4 GiB+ host: 2–3 about:blank cycles, M7 plus one distinct accepted positive, process/network telemetry, >=25% memory headroom, cancellation/timeout, orphan scan, and cleanup.
- Current stage is architecture decision complete; local adapter/tests can proceed without infrastructure. No host was created or reused, no cost incurred, and no production/GitHub mutation occurred in this cycle.

## Next gate

Proceed only with isolated local adapter/contract tests now. Obtain one explicitly authorized separate Linux/Xvfb host later for the batched two-positive pilot; stop before production integration unless every host, privacy, resource, cleanup, and failure-taxonomy criterion passes.

## 2026-09-04 Isolated browser fallback contract - ECHO-20260904-1137

- Added a disabled-by-default local TypeScript adapter seam under `src/services/browserTranscriptFallback.ts`; the current YouTube acquisition cascade does not import or invoke it, so production behavior is unchanged.
- The seam enforces transport/provider-only trigger eligibility, typed fail-closed service response mapping, one-slot same-key single-flight, subscriber cancellation/deadline handling, abort propagation when all subscribers leave, generation-based stale response discard, and a separate cache-write boundary for validated structured success only.
- Deterministic focused tests cover the trigger matrix, all required outcome mappings, disabled behavior, duplicate coalescing, slot rejection, cancellation, timeout, stale responses, cleanup failure, malformed responses, and cache eligibility.
- Validation completed: focused Vitest `36/36` passed, `npx tsc -b --pretty false` passed, targeted ESLint reported no errors, and `git diff --check` passed with existing line-ending/config-ignore warnings.
- Linux/Xvfb real-service acceptance remains pending and will be batched into one later separate 4 GiB+ host lifecycle. No browser service is integrated into production by this cycle.

## Next gate

Run the focused local adapter tests and proportionate TypeScript/lint checks. Only after this local seam is accepted should one future isolated Linux/Xvfb host be used for the batched real-browser gate; do not recreate the destroyed DigitalOcean VM or touch the production AWS host.

## 2026-09-04 Mocked browser fallback orchestration - ECHO-20260904-1152

- Added `src/services/browserFallbackOrchestrator.ts` as a local-only controller over the disabled browser adapter. It models normal-provider outcome -> eligible trigger decision -> optional browser request -> unified final outcome and cache decision, without any production call-site import.
- Behavior is covered for eligible transport failures, definitive non-triggers, upstream pass-through, browser success/error mapping, cache-write calls, cancellation/deadline propagation, stale generations, and duplicate single-flight requests.
- Validation completed: focused adapter + orchestration Vitest `54/54` passed, `npx tsc -b --pretty false` passed, targeted ESLint passed with no errors, and `git diff --check` passed with existing line-ending/config-ignore warnings.
- This local mocked stage is complete. No further high-value local-only work is required before the real-service gate; the next mandatory step is one future batched separate >=4 GiB Linux/Xvfb host lifecycle. No host is created or reused now.

## Next gate

Batch the real headed/Xvfb browser service validation on one separate >=4 GiB host: about:blank cleanup/resource checks, two accepted positive controls, media blocking, telemetry, cancellation/timeout, orphan detection, and >=25% memory headroom. Only after that gate should isolated real-service integration and later production-canary review proceed.

## 2026-09-04 Linux headed/Xvfb pilot access blocker - ECHO-20260904-1200

- The user supplied the new validation VPS address `170.64.184.233` and authorized setup on that host only. The established project key path `D:/CODE/API/echolearn/echolearn-ytdlp-key.pem` exists locally, but SSH authentication was rejected for both `ubuntu@170.64.184.233` and the one bounded `root@170.64.184.233` retry.
- No remote command executed, so distro, capacity, Chrome/Xvfb/Node availability, browser telemetry, cleanup, restartability, or positive-control results are unverified. Production AWS `3.107.69.57` was not contacted or changed.
- No package installation, host mutation, EchoLearn deployment, commit, push, or production mutation occurred. The host must not be destroyed by Codex; `USER_MAY_DESTROY_HOST=false` pending explicit user authorization.

## Next gate

Provide or attach the correct authorized SSH identity/user for `170.64.184.233` (without sharing private-key contents). Then perform the entire one-host headed/Xvfb checklist in one lifecycle; do not recreate the destroyed DigitalOcean VM or use production AWS.

## 2026-09-04 Linux headed/Xvfb pilot - ECHO-20260904-1218

- SSH access was restored to the user-created, separate validation VPS `170.64.184.233` using the established key path without exposing key contents. Host baseline was Ubuntu 24.04.4, 2 vCPU, `4,106,100,736` total RAM bytes, no swap, and approximately 80 GB disk. Chromium `152.0.7977.64`, Xvfb, task-owned Node `22.14.0`, npm `10.9.2`, and Playwright Core `1.62.1` were installed/configured on this host only.
- The one materially distinct bootstrap-aware M7 diagnostic used headed Chromium under Xvfb, no headless flag, fresh logged-out disposable profile, loopback CDP, and media blocking. Natural anonymous first-party guest bootstrap completed, but M7 still classified `PLAYER_BLOCKED` / `LOGIN_REQUIRED` with no caption track or timedtext capture. Treat this as server/egress/video evidence for this bounded axis; do not repeat same-host identity/flag or yt-dlp/session experiments.
- M7 telemetry: 186 navigation requests, `4,439,044` encoded bytes, caption `0`, media `0`, other `4,439,044`; 68 valid process-tree samples, peak Chrome tree `1,897,988,096` working-set bytes / `809,574,400` private bytes / 13 processes; post-run available RAM `3,436,810,240` bytes; cleanup removed the profile with zero profile/orphan processes. Bootstrap telemetry was aggregate-only: 131 requests, `3,914,144` bytes, media `0`.
- The earlier same-host run already passed three about:blank smokes, one distinct positive with structured captions and media `0`, cancellation cleanup, and restartability. The bootstrap-aware diagnostic was intentionally limited to one M7 run; no second positive or mini-matrix was run after M7 remained `LOGIN_REQUIRED`.
- Sanitized evidence is retained at `D:/CODE/API/echolearn/evidence/ECHO-20260904-1218-bootstrap`; manifest SHA-256 is `2e38f728596a7dc2f820e3d8305628f44a682423112d383dcb0ed0b83dec8ba5`. No raw URLs, cookies, visitor data, tokens, auth material, request bodies, or caption text were persisted.

## Next gate

The real Linux/Xvfb browser-service gate is **not accepted** because the required M7 positive remained `LOGIN_REQUIRED` after the single natural guest bootstrap diagnostic. The local adapter/mock stages are complete; no further high-value local-only work or same-host identity tuning is justified. Production browser-fallback integration remains **NO-GO** pending a new explicit product/egress decision. The validation host remains running and must not be destroyed by Codex; `HOST_MAY_BE_DESTROYED=false` pending user-only lifecycle direction.

## 2026-09-04 Different-egress/service-class decision research - ECHO-20260904-1258

- Decision: retain the dedicated browser fallback architecture as the first validation candidate, but change only the egress class for the next experiment to a contract-permitted rotating residential/ISP network with one sticky exit per fresh browser job. This preserves the proven headed Chrome/CDP and media-blocking path while directly testing the datacenter-IP hypothesis.
- Public evidence is directional, not a success-rate guarantee: `youtube-transcript-api` documents cloud-provider blocking and recommends rotating residential proxies, while its open POST-429 issue and reports of Webshare residential failures show that rotation/provider choice can still fail. No audited M7 cross-provider success rate was found.
- Managed browser services are a conditional second choice: Browserbase supports Playwright/CDP and proxies but documents proxy restrictions including streaming; Browserless exposes residential/external proxies and YouTube-oriented routing, but its documentation is not M7 caption evidence. Transcript vendors are the lowest-ops third choice only if native-caption mode, no audio/ASR fallback, retention, error taxonomy, and M7 capability are contractually proven.
- No infrastructure, vendor account, purchase, production request, or new YouTube request was made in this research cycle. Bright Data residential is excluded from the candidate list unless its current AUP changes or written approval covers the use case, because its AUP lists streaming-related domains as prohibited.

## Next gate

Do not integrate or purchase yet. The smallest future experiment is one explicitly authorized new residential/ISP egress class: one fresh guest-bootstrap M7 run with the existing headed/CDP/media-blocked harness, no retry; only if M7 succeeds, run one distinct accepted positive. Require structured non-empty captions, media encoded bytes `0`, valid resource/cleanup/privacy evidence, and contract/ToS approval. If M7 remains blocked, stop and classify the egress/video result; do not spray flags, cookies, tokens, or yt-dlp variants.

## 2026-09-04 Residential egress pre-purchase readiness - ECHO-20260904-1326

- Current public policy/feature screening leaves IPRoyal rotating residential as the preferred candidate: its public AUP is generic around law, third-party rights, protected/non-public data, and excessive collection; the reviewed public materials did not list streaming as an explicit residential prohibition. Its documentation exposes HTTP(S)/SOCKS5, country/state/city targeting, sticky sessions up to 7 days, and a 1 GB pay-as-you-go entry. This is not permission: written confirmation must cover YouTube, automated headed browser access, caption-only retrieval, and the exact `_streaming-1`/high-end route if used.
- Decodo and Webshare remain conditional backups, not cleared candidates. Their current official materials explicitly classify streaming targets as restricted; Decodo describes possible unblock after ID verification only for rotating residential, while Webshare directs streaming targets to compliance/KYC. Both otherwise expose browser-compatible HTTP(S)/SOCKS5 and sticky/rotating controls. Bright Data remains excluded under its current streaming-related-domain AUP prohibition.
- The local validation runner now has an opt-in proxy seam only: `ECHOLEARN_PROXY_SERVER`, `ECHOLEARN_PROXY_USERNAME`, and `ECHOLEARN_PROXY_PASSWORD`. The endpoint must be a credential-free `http(s)://host:port` or unauthenticated `socks5://host:port`; HTTP(S) credentials are handled only through CDP proxy auth challenges, are removed from the Chromium child environment, and appear only as a boolean sanitized summary. Media blocking, fresh profile, headed/Xvfb/CDP, telemetry, cleanup, and production-disabled boundaries are unchanged.
- No account, purchase, provider credential, proxy request, YouTube request, host/SSH action, infrastructure action, production mutation, commit, or push occurred. Real provider behavior, M7 recovery, policy approval, retention, and cost for EchoLearn remain unverified.

## Next gate

The only remaining pre-purchase blocker is provider-side written confirmation plus user-supplied credentials through a secret channel. After that, use one fresh sticky residential session on the existing validation VPS and run one bootstrap-aware M7 request; only on M7 structured-caption success run one distinct accepted positive. Do not recreate the destroyed DigitalOcean VM, change the current host, or repeat same-host identity/flag/yt-dlp tuning.

## 2026-09-04 Local Proxy-Cheap prerequisite hardening - ECHO-20260904-1438

- Hardened the local-only pilot seam before any credentialed egress run. `linux-pilot.mjs` now uses explicit allowlisted `full`, `m7-only`, and `distinct-positive-only` modes; the distinct-positive mode is unreachable without a hash-matched sanitized manifest containing fixture-specific M7 `allRequiredPass` acceptance. There are no provider retries or rotations in the runner.
- Evidence output is unique/fail-if-present and never recursively deletes an earlier directory. The default path is an unprivileged-writable unique `os.tmpdir()` directory. Browser/Xvfb child environments scrub custom and standard proxy credential-bearing variables. Sandboxed unprivileged Chromium is the only capability-eligible mode; root and the explicit `--no-sandbox` compatibility escape hatch fail the future gate.
- Added phase-separated CDP telemetry with explicit re-enable between guest bootstrap and M7, one global deadline helper, observed-PID retention for reparented cleanup, semantic bootstrap/watch checks, strict machine-readable M7 acceptance, and privacy-safe salted proxy-exit proof plumbing. `m7-only` fails closed unless stable pre/post hash, matching coarse ASN/country, and residential/ISP classification are supplied from two temporally bound sanitized checkpoint files; no IP-check traffic was made.
- Tightened the isolated TypeScript fallback contract: `browser_empty_response` maps to `provider_failure`; success/cache eligibility requires native-caption/no-ASR provenance, player/track/language/structured-timedtext truth, non-partial coverage, media bytes `0`, zero malformed responses, and cleanup success. Browser failures retain the original upstream code, and request-scope generations protect cross-video late results while the slot remains explicitly process-local.
- Local prerequisite gate is **READY for one bounded real Proxy-Cheap capability probe**, with the temporal two-checkpoint design now enforced locally. The probe still requires policy/written-use confirmation and secret-channel credentials; it does not authorize production integration or establish residential-class reliability.

## Next gate

After provider policy/written-use confirmation and secret-channel credential delivery, run one fresh `m7-only` Proxy-Cheap job on the existing validation host with a before checkpoint loaded before guest bootstrap/M7 and a separate after checkpoint loaded only after M7 cleanup. Require the strict M7 envelope, accepted sticky residential/ISP proof, media encoded bytes `0`, valid resources/headroom, cleanup, and privacy. Only if that M7 run passes may the separately gated `distinct-positive-only` run use its exact manifest/hash. No same-host tuning, production integration, commit, push, deploy, or infrastructure lifecycle action is authorized by this local cycle.

## 2026-09-04 Proxy-Cheap capability gate access checkpoint - ECHO-20260904-1514

- Read-only SSH re-anchor to the separate validation VPS `170.64.184.233` succeeded as `root`; the host is `ubuntu-s-2vcpu-4gb-syd1`, Ubuntu 24.04.4, kernel `6.8.0-124-generic`, 2 vCPU, `4,106,100,736` total RAM bytes, `3,587,674,112` available at baseline, no swap, 82,086,711,296-byte root disk with 77,488,017,408 bytes available, Chromium `152.0.7977.64`, Xvfb present, and Node `18.19.1`/npm `9.2.0`. This is not production AWS `3.107.69.57`.
- No Proxy-Cheap endpoint/username/password was available through the established local secret-safe sources. `.env.production` contains only the existing `VITE_YOUTUBE_PROXY` application proxy setting; it is not a Proxy-Cheap credential set and was not used. No secret value was printed or persisted.
- The real gate therefore made **0 M7 attempts** and **0 distinct-positive attempts**. No proxy/YouTube traffic, host mutation, package installation, evidence output, or production action occurred. Prior local harness readiness remains valid, but no current-cycle resource/network/cleanup result can be claimed.

## Next gate after access recovery

User must first provide a policy-approved Proxy-Cheap endpoint and credentials through a secret channel, plus a safe mechanism for the temporally distinct sanitized `before` and post-M7 `after` exit observations. Then reuse this still-running VPS for exactly one `m7-only` run; only a strict M7 pass may unlock one manifest/hash-gated distinct positive. Keep the host running until the user decides its lifecycle; `HOST_MAY_BE_DESTROYED=false` for Codex. Production remains **NO-GO** for browser fallback.

## 2026-09-04 ScrapingBee dedicated subtitles capability gate - ECHO-20260904-1617

- Re-anchored local `main`: `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; all pre-existing dirty/untracked work was preserved. No staging, reset, clean, stash, commit, push, deploy, production mutation, VPS contact, or proxy use occurred.
- Read-only secret-safe inspection found no non-empty ScrapingBee/SCRAPE_API_KEY-style credential in the checked project env/config files or process/user/machine environment scopes. The exact blocker is missing locally configured provider credentials, so the real-provider gate stopped before request construction.
- ScrapingBee dedicated subtitles candidate: **INCONCLUSIVE**. M7 `M7lc1UVf-VE` requested English: **NOT RUN (0 attempts)**. Hard target `YweN5PUyGgc`: **NOT RUN (0 attempts; correctly gated)**. Exact real requests: `0`; approximate credits at 5 credits/request: `0`.
- No provider status, structural segment count, latency, language, or no-subtitles/unavailable result exists for this cycle. The existing adapter and harness were inspected but not changed.

## Next gate

Only after an already-existing, policy-approved ScrapingBee credential is supplied through a protected process-environment mechanism may one official dedicated `/api/v1/youtube/subtitles` M7 request run with a 12-second bound; only a strict M7 success may unlock one `YweN5PUyGgc` attempt. Do not use the DigitalOcean validation VPS `170.64.184.233` for this managed-provider path; it is unnecessary for direct ScrapingBee API validation.

## 2026-09-04 ScrapingBee dedicated subtitles real-provider checkpoint - ECHO-20260904-1617

- Continued from the missing-credential checkpoint. Re-anchored local `main`: `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; all existing dirty/untracked work was preserved. The protected local credential was read only for child-process injection and was not printed, persisted, hashed, or modified.
- Exactly one official dedicated ScrapingBee YouTube Subtitles request was made for M7 `M7lc1UVf-VE`, requested language English, with the existing adapter and approximately 12-second bound. Result: status class `4xx`, typed outcome `provider_failure`, latency `2,228 ms`, structural/non-empty timestamped segments `0`, returned language `none`, language-compatible `false`; strict acceptance failed. Exact status code was not retained.
- The conditional hard target `YweN5PUyGgc` was not run. Exact live requests: `1`; approximate credits at 5 credits/request: `5`. ScrapingBee dedicated subtitles candidate: **NO-GO for this configured credential/provider check**; no retry, key rotation, account change, proxy, browser, VPS, or DigitalOcean action occurred.
- No raw response/body, transcript text, credential, cookies, or secrets were logged or added to evidence. No local adapter schema bug was demonstrated because the response was non-2xx and contained no usable payload; no code fix was made.

## Next gate

Do not rerun or rotate credentials under this task. Any future reconsideration requires a separately authorized credential/account diagnosis or provider decision; the current bounded evidence does not justify integrating ScrapingBee as a managed fallback. DigitalOcean `170.64.184.233` remains unnecessary for this direct API path.

## 2026-09-04 DigitalOcean validation VPS lifecycle update - ECHO-20260904-1638

- The user explicitly confirmed that DigitalOcean validation VPS `170.64.184.233` has been destroyed. Codex must not reconnect, recover, recreate, or otherwise use that VPS in this or later ScrapingBee diagnosis work unless separately authorized.

## 2026-09-04 ScrapingBee account/API diagnosis - ECHO-20260904-1638

- The single official `/api/v1/usage` health check returned status `200` / `2xx` with `accepted_2xx`, `maxConcurrency=5`, and `currentConcurrency=0`. This narrows the issue away from an immediately rejected key and current concurrency exhaustion. Credit and renewal values were not retained by the one-shot safe extractor, so at least 5 available credits could not be proven.
- No YouTube request was made in this diagnosis cycle: docs sample `rfscVS0vtbw` and M7 no-language `M7lc1UVf-VE` were both not run. Exact YouTube requests: `0`; approximate YouTube credits: `0`. The previous task's M7 `4xx` remains unresolved between auth/access and the documented 404 requested-language/availability semantics.
- The adapter was minimally corrected so HTTP 401/403 return typed `auth_failure`, HTTP 404 returns neutral typed `not_found` without claiming target-level no captions, and HTTP status is retained as sanitized metadata. No production call site or live path was changed.
- Diagnosis result: **INCONCLUSIVE**. Usage authentication is accepted, but subtitle entitlement/request semantics and actual credit balance remain unverified. The user-confirmed DigitalOcean VPS destruction is durable; it must not be reused for this path.

## 2026-09-04 ScrapingBee corrected usage diagnosis - ECHO-20260904-1658

- The corrected local usage helper now recognizes the official credit fields and fails closed for invalid, empty, boolean, or overdrawn values. Its focused tests cover those cases.
- Exactly one non-billable `/api/v1/usage` request returned status `200` / `2xx`, `accepted_2xx`, `max_api_credit=1000`, `used_api_credit=1010`, `remainingApiCredit=null` because the computed balance was negative, `maxConcurrency=5`, `currentConcurrency=0`, and renewal date `2026-08-13T10:07:58.149206`.
- The account/key is accepted by usage, but the account is exhausted/overdrawn and cannot prove the required 5 credits. Docs sample `rfscVS0vtbw` and M7 no-language `M7lc1UVf-VE` were not run. Exact YouTube requests: `0`; approximate YouTube credits: `0`.
- Root-cause result: **NO-GO for the current account until credits are replenished**, with the previous subtitles 4xx not re-run or independently attributed. No purchase, upgrade, key rotation, vendor contact, production action, or DigitalOcean use occurred.

## 2026-09-04 Generic Linux browser runtime gate - ECHO-20260904-1723

- On the new validation-only VPS `134.199.155.9`, installed Xvfb package `2:21.1.12-1ubuntu1.6`, Node `22.23.2`, npm/npx `10.9.8`, Chromium snap `152.0.7977.64`, and standalone Google Chrome `152.0.7977.82`. Created unprivileged `echolearnpilot` UID `1000`; the intended smoke path used Chrome without `--no-sandbox`.
- The Chromium snap wrapper was diagnosed and left out of the smoke path because it exits under this non-interactive root-to-user launch with `not a snap cgroup for tag snap.chromium.chromium`. Standalone Google Chrome then passed the same generic headed/Xvfb semantics.
- Two fresh-profile cycles passed: Xvfb start, loopback CDP, `about:blank`, `example.com`, profile deletion, and zero task-owned Chromium/Xvfb/Node orphans. Cycle 1 peak Chrome-tree RSS-style working-set `1,472,102,400` bytes, private `275,099,648` bytes, 17 processes, 3 samples; cycle 2 `1,495,740,416` bytes, private `296,505,344` bytes, 17 processes, 3 samples. Host post-run available RAM was about `3.3 GiB` of `3.8 GiB`; swap remained `0`, disk about `72 GiB` free.
- This is generic infrastructure evidence only. No YouTube, transcript provider, Proxy-Cheap, residential proxy, production, or AWS/Vercel/Worker traffic was made. The direct-vs-residential M7 experiment remains unexecuted.

## Next gate

The infrastructure-only work on this VPS is complete. `HOST_MAY_BE_DESTROYED=true` as an explicit recommendation because the generic runtime gate passed and no further legitimate host-dependent work remains in this cycle. The intended direct-vs-Proxy-Cheap YouTube experiment still requires separate SSH/credential readiness and must not be inferred from this generic smoke.

## 2026-09-04 Direct-vs-residential M7 host gate access blocker - ECHO-20260904-1723

- New validation-only VPS `134.199.155.9` was contacted only with the established SSH key path, read-only. Both `root` and `ubuntu` were rejected with `Permission denied (publickey)`; no remote command, installation, upload, configuration, or host mutation occurred. Production AWS `3.107.69.57` was not contacted.
- The required repo-external runtime secret file `D:/CODE/API/echolearn/proxy-cheap-runtime.txt` is absent. Its contents were not read, printed, hashed, logged, or persisted.
- Direct M7: **NOT RUN (0 attempts)** because SSH access was unavailable before host setup. Proxy M7: **NOT RUN (0 attempts)**. Conditional distinct positive: **NOT RUN (0 attempts)**. No browser, proxy, or YouTube traffic occurred; no resource/network/cleanup telemetry exists for this host.

## Next gate

The user must authorize the new VPS key for `root` or `ubuntu` and provide the already-configured runtime credential file through the established secret channel. Then reuse only `134.199.155.9`, perform the read-only baseline, one direct M7 control, and only if the credential and sticky residential proof gates pass, one Proxy-Cheap M7. The host remains alive and was not destroyed; `HOST_MAY_BE_DESTROYED=false` for Codex. Production browser fallback remains unapproved.

## 2026-09-04 Generic runtime continuation terminal closure - ECHO-20260904-1723

The earlier same-task access-blocker entry is historical. SSH authorization was subsequently restored, the infrastructure-only stack was installed and validated with two generic headed/Xvfb Chrome cycles, and no YouTube/proxy experiment was run. Generic host work is complete; `HOST_MAY_BE_DESTROYED=true` is the current recommendation, with the direct-vs-Proxy-Cheap M7 experiment remaining a separate unexecuted gate.

## 2026-09-04 Cycle 1 - worktree hygiene and cache-aware measurement foundation - ECHO-20260904-2044

- Strategy baseline: independently re-anchored the completed Sol+xhigh review on local `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, and no staged changes. The dirty set remains intentionally preserved and is grouped exactly in `TEST_REPORT.md`; no file was moved, deleted, reset, cleaned, stashed, or discarded.
- Confirmed local source state: `vps-ytdlp/main.py` already uses parsed exact YouTube hosts plus `*.youtube.com` subdomains in `_is_youtube` and `_host_allowed`; only focused regression coverage was added. This is local source evidence, not deployment or exploitability evidence. Production VPS revision/config remains unmodified and its deployment state is **UNKNOWN** from this cycle.
- Confirmed Worker cache state: the local Worker already emits `X-EchoLearn-Transcript-Cache`; it now exposes that header through CORS alongside the trace header and marks caption cache reads as `HIT`, acquisition as `MISS`, and explicit ASR/diagnostic paths as `BYPASS`. Cache namespace/version remains `v=1`; no production Worker traffic or deployment occurred.
- Added a pure privacy-safe transcript outcome measurement shape with only outcome code, cache state, latency bucket, Guest/auth state, and Retry-used. No remote telemetry sink was wired; the deferred gate is an explicit emission point plus privacy/product approval that can supply these fields without request/content data.
- Health-check evidence is now explicit when the response supplies the cache header and remains `UNKNOWN`/`not_observable` otherwise. Fixed controls remain availability checks, not fresh-acquisition proof; no live health-check traffic ran.
- Browser and ScrapingBee work is paused/archive-only and remains unintegrated. The temporary DigitalOcean validation VPS lifecycle is complete/destroyed as already established; no new VPS/provider spend occurred. The newer generic-runtime host state was not contacted or changed by this cycle. Current production revision/config remains unmodified.

## Next gate

Cycle 2 must use fresh confirmed-caption URLs and prove explicit `MISS` then `HIT`, Guest -> Study behavior, typed failure/retry, a negative control, and no ASR. Keep the browser/ScrapingBee experiments unintegrated until a separately authorized capability decision; do not treat this local foundation or prior accepted 7/7 evidence as proof of a cold production denominator.

## 2026-09-04 Cycle 2 behavior-validation partial closure - ECHO-20260904-2115

- Re-anchored again on `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, `origin/main` equal, ahead/behind `0/0`, and no staged changes. The Cycle 1 dirty/untracked set plus the Cycle 2 Worker-boundary test, harness/config, and Study classifier files remains preserved; the current non-ignored set is 45 entries (40 carried forward plus 5 Cycle 2 additions). No reset, clean, stash, discard, move, deletion, commit, push, or deploy occurred.
- The three YouTube identities used for local controls remain **fresh candidate/control identities only**. Direct PowerShell page reads for all three returned `WebException`; no independent native caption-track evidence was obtained. Therefore **fresh confirmed-caption control is NOT VERIFIED and remains a Cycle 2 gap**.
- The actual local Worker boundary proof passed: the same `worker.fetch` request against an in-memory Cache API returned `X-EchoLearn-Transcript-Cache: MISS` first and `HIT` second, with a provider call only on the miss and the cache header CORS-exposed. This is deterministic local Worker evidence, not production evidence.
- The Playwright `route.fulfill` `MISS`/`HIT` values are explicitly only simulated browser response markers. They demonstrate UI consumption and same-request retry/reload observation in the harness; they must not be described as Worker cache proof.
- A bounded Study fix now treats typed YouTube/Bilibili `captions_not_found` as the no-caption UI state while refusing to relabel typed provider failures/timeouts from their message text. The pure classifier regression tests pass. Existing browser evidence was 2/3 before this fix (Guest -> Study and typed failure -> Retry passed; the typed no-caption case exposed the bug); the post-fix browser rerun was attempted once through the bounded Node child-process runner and was environment-blocked, so browser acceptance remains **partial**.
- Browser-native and ScrapingBee remain paused/archive-only. No ASR/media/audio path, new provider spend, new VPS, or the generic-runtime host `134.199.155.9` was used. The temporary validation VPS lifecycle remains complete/destroyed as already established. Current production revision/configuration remains unmodified.

### Cycle 2 next gate

Obtain an independently reliable native caption-track confirmation for a fresh control, then rerun the bounded local browser journey after the environment can execute it: Guest -> Study with non-empty native captions, explicit Worker-boundary `MISS` then `HIT`, typed failure -> Retry with stale/duplicate protection, a semantically real no-caption negative control, and no ASR. Keep the local Worker deterministic proof separate from any future production evidence; record only D-011 aggregate outcome/cache/latency/auth/retry fields.

## 2026-09-04 Cycle 2 gate closure attempt - ECHO-20260904-2200

- Re-anchored from the Cycle 2 partial handoff: `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, no staged changes, and all 45 non-ignored dirty/untracked entries preserved. No reset, clean, stash, discard, move, deletion, commit, push, deploy, provider spend, VPS/SSH action, or production mutation occurred.
- Gate A has independent third-party corroboration for `aircAruvnKk`: supervisor-provided public sources separately report an English track, `isAutoGenerated=false`/`isGenerated=false`, and non-zero segment/cue counts, with one recent crawl dated `2026-08-16`. No transcript text was retained. This is **third-party independent corroboration**, not YouTube-origin UI proof and not EchoLearn Worker/provider evidence.
- The local YouTube-origin check remains blocked rather than negative: fresh anonymous system-Chrome navigation for three candidates returned `net::ERR_NETWORK_ACCESS_DENIED`; the prior PowerShell reads were `WebException`. Official-page direct reading provided no caption-track metadata. Under the independent-source acceptance wording, Gate A is corroborated for the named control; under a strict YouTube-origin UI requirement it remains **NOT VERIFIED**.
- Gate B remains **environment-blocked/partial, not behavior-failed**. The existing post-fix Playwright suite was attempted through the Playwright-managed `webServer` path with system Chrome; no `5173` listener appeared and the run was safely terminated. No attributable process was killed because command-line inspection was permission-denied; no listener remained. The earlier pre-fix browser run remains 2/3 only and is not post-fix proof.
- Deterministic regression evidence was rerun: classifier, caption provider classification, Retry plumbing, and stale-response protection passed **3 files / 39 tests**. The prior Cycle 2 full suite remains **40 files / 533 tests passed**, with typecheck, build, targeted lint, and diff-check already recorded. No product code changed in this task.

### Next gate

If strict YouTube-origin confirmation is required, rerun only when local direct YouTube navigation is permitted and verify the caption track through YouTube's own UI/player metadata without EchoLearn provider traffic. For behavior Gate B, rerun the existing local suite when the execution environment can launch its managed Vite server; require Guest -> Study/non-empty captions, actual Worker-boundary `MISS` then `HIT` kept separate from simulated `route.fulfill` markers, typed failure -> Retry with no stale/duplicate corruption, semantic `captions_not_found`, and no ASR/media/audio.

## 2026-09-04 Cycle 2 native approval continuation - ECHO-20260904-2215

- Native one-request approval was offered and approved for the bounded fresh-profile system-Chrome YouTube diagnostic. Direct YouTube navigation for `M7lc1UVf-VE` succeeded with `playabilityStatus=OK`, two English caption tracks (`manual` and `auto`), and one direct YouTube `/api/timedtext` response: HTTP 200, JSON, 65,976 body bytes, 466 parsed events/segments. `navigator.webdriver=false`; no audio/media playback or ASR was used. This is strict YouTube-origin native-caption evidence for the M7 control; no caption text, cookies, headers, tokens, or query values were retained.
- Native approval was also offered and approved for the Playwright/Vite attempt. The Playwright-managed `webServer` run executed the first two cases successfully, then the Vite listener disappeared and case three failed at `page.goto` with `net::ERR_CONNECTION_REFUSED`; this is a server-lifecycle execution failure, not a behavior failure. No unknown process was killed.
- The authorized bounded alternative started one attributable local Vite process (`VITE_PID=12328`), verified the `127.0.0.1:5173` listener, ran the same post-fix desktop suite, and stopped only that process. All three cases passed in 7.7 seconds: Guest -> Study/non-empty captions with simulated `MISS` then `HIT`, typed provider failure -> exactly one Retry with same-request safety, and semantic `captions_not_found` without Generate/ASR. The simulated browser cache markers remain separate from actual local Worker `worker.fetch`/in-memory Cache API `MISS -> HIT` proof.
- No production, Worker, Vercel, provider, proxy, VPS/SSH, commit, push, deploy, or paid action occurred. Actual Worker proof remains local deterministic evidence; YouTube proof is browser-origin control evidence; neither is production availability proof.

### Cycle 2 status after native approval

Strict YouTube-origin M7 confirmation: **PASS**. Post-fix behavior suite through the bounded attributable-Vite fallback: **PASS (3/3)**. The direct Playwright-managed webServer path remains a reproducible lifecycle issue (`ERR_CONNECTION_REFUSED` in case three), but the user-visible suite is validated through the allowed local fallback. Remaining limitation: this run confirms M7, not a broad YouTube caption success rate or production/provider behavior.

## 2026-09-04 ECHO-20260904-2235 - Fresh native controls and bounded production observation

- Re-anchored on `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, no staged changes; preserved all existing dirty/untracked work. The historical 24-video matrix was not rerun. No reset, clean, stash, discard, move, deletion, commit, push, deploy, provider spend, SSH, or VPS action occurred. The previously destroyed temporary VPS remains destroyed and no new VPS was created.
- Five controls outside the historical `FIXTURES` list were confirmed directly through fresh local system-Chrome/CDP YouTube-origin captures: `arj7oStGLkU` (TED; English manual+auto; player `OK`; timedtext `200` JSON, 43,156 bytes, 315 events/segments, 315 lines, 17,471 ms), `Ks-_Mh1QhMc` (TED; English manual+auto; `200`, 61,689 bytes, 428/428, 428 lines, 14,617 ms), `e-ORhEE9VVg` (Taylor Swift; English manual; `200`, 19,613 bytes, 99/99, 98 lines, 15,409 ms), `YQHsXMglC9A` (Adele; English auto+manual; `200`, 16,546 bytes, 74/74, 74 lines, 16,126 ms), and `OPf0YbXqDm0` (MarkRonsonVEVO; English manual; `200`, 26,808 bytes, 140/140, 110 lines, 16,879 ms). All were `SUCCESS`, player `OK`, zero media bytes, zero initial cookies, zero page errors, webdriver false, and cleaned disposable profiles. Sanitized evidence: `D:\CODE\API\echolearn\evidence\ECHO-20260904-2235-native\fresh-matrix.json` (SHA-256 `5D3E99B18BC3E41DE00D59DDB39DDE94E541F847DA90380FE3B509B77458F2D3`).
- The same five were exercised through `https://echo-learn.uk/study` with fresh guest profiles, URL paste -> Load -> Transcript/Study wait, media blocked, and browser blocks for `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, and `yt-api.echo-learn.uk`. Final instrumentation observed Worker/main acquisition `5/5` typed `provider_timeout` with Worker `/api/transcript` HTTP `504`, same-origin `/api/transcript` HTTP `504`, no non-empty bodies/UI lines, absent cache header (`UNKNOWN`), and Retry visible but unused. This is not an unrestricted full-production user-path result because blocked endpoints could have changed a fallback outcome.
- Endpoint-chain inspection: `proxy.echo-learn.uk` is an opt-in local-proxy branch controlled by `echolearn_local_proxy_url`; fresh profiles cleared that setting, so it was not part of the default chain in this run. `proxy-cheap.echo-learn.uk` has no current source reference. `yt-api.echo-learn.uk` is not a browser endpoint; `api/transcript.ts` references it as a server-side Vercel fallback when `YTDLP_API_KEY` is configured, so browser blocking cannot prove or prevent that server-to-server call. The deployed `VITE_YOUTUBE_PROXY` value and downstream server branch remain unknown. Report precisely `Worker/main 5/5 provider_timeout` and same-origin `5/5 504`, with later fallback behavior unknown.
- No reliable `captions_not_found` negative was obtained, and no invalid/unplayable candidate was relabeled. Existing deterministic local Worker `MISS -> HIT` and local Playwright `3/3` remain separate evidence. The local native result is `5/5`; the bounded production observation is `0/5` UI success with typed timeout, not a broad YouTube reliability claim.

### Evidence-driven recommendation

The local native path is viable, while the Worker/main segment timed out on all five validated positives. This justifies a focused fallback/provider-timeout investigation, but the Sol gate requires a second distinct no-VPS bad window before reopening fallback R&D. Keep the next window no-VPS: use deterministic/source-level checks or another explicitly bounded production-read-only observation, and do not create infrastructure, use SSH, buy a proxy/provider, enable ASR/media, integrate browser fallback, or deploy.

## 2026-09-04 ECHO-20260904-2325 - Second distinct no-VPS window

- Durable-plan audit: D-012 is now the canonical active Sol/xhigh evidence gate. It records that local native success is not production success, fixed/cached controls are not fresh-acquisition proof, two distinct low-volume no-VPS bad windows are required before fallback R&D is reconsidered, technical failures count while `captions_not_found` does not, strong recovery means observe, and browser/provider fallback needs a separate newly authorized product/safety gate. D-009 and D-010 retain their historical rationale but are now `SUPERSEDED` and are not authorization to buy or use residential proxy/Proxy-Cheap egress.
- Second local native window used five IDs absent from the historical 24-video `FIXTURES` and the ECHO-20260904-2235 set: `ZbZSe6N_BXs` (PharrellWilliamsVEVO, `Happy`, English manual, `OK`, timedtext `200`, 15,163 bytes, 75 events/segments, 75 lines, 14,763 ms); `JGwWNGJdvx8` (Ed Sheeran, `Shape of You`, English manual plus auto among six tracks, `200`, 12,780 bytes, 92 events/segments, 90 lines, 16,199 ms); `RgKAFK5djSk` (Wiz Khalifa Music, `See You Again`, English manual plus auto among three tracks, `200`, 18,122 bytes, 79 events/segments, 75 lines, 16,092 ms); `CevxZvSJLk8` (KatyPerryVEVO, `Roar`, English manual among three tracks, `200`, 4,737 bytes, 31 events/segments, 31 lines, 15,816 ms); and `60ItHLz5WEA` (Alan Walker, `Faded`, English auto, `200`, 18,021 bytes, 84 events/171 parsed segments, 41 lines, 16,197 ms). All five were native `SUCCESS`, player `OK`, webdriver false, zero initial cookies/page errors, media encoded bytes `0`, and cleaned fresh profiles. No replacement was needed. Sanitized manifest: `D:\CODE\API\echolearn\evidence\ECHO-20260904-2325-native\fresh-matrix-2.json`, SHA-256 `1A78AB4958E68E68B0D3DCA6B4CEC80876557DDBDBA413752A7033C168C99964`.
- The same five were exercised through the current production Guest -> Study path with fresh guest profiles, URL paste -> Load, media-only blocking, no ASR, no Retry use, and local proxy storage cleared. The improved harness did not block `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, `yt-api.echo-learn.uk`, `/api/transcript`, `/api/yt`, or other default transcript routes. All five had zero UI lines, Retry visible, cache `UNKNOWN` because no cache header was observed, zero page errors, and no non-empty transcript body. `ZbZSe6N_BXs` and `JGwWNGJdvx8` had a failed Worker request followed by same-origin `/api/transcript` HTTP `504` / typed `provider_timeout` (15,064 ms and 14,463 ms). `RgKAFK5djSk`, `CevxZvSJLk8`, and `60ItHLz5WEA` received Worker HTTP `409` / typed `asr_required` (3,003 ms, 2,386 ms, 2,291 ms) while ASR was not requested. The initial harness summary called the first two untyped because it only consulted Worker responses; the captured same-origin endpoint signal was typed `provider_timeout`, and the harness was corrected afterward. No third production run was made merely to replay the same five.
- Endpoint boundary review: `proxy.echo-learn.uk` is only the opt-in `echolearn_local_proxy_url` branch and was absent from each fresh profile; `proxy-cheap.echo-learn.uk` has no current source reference; `yt-api.echo-learn.uk` is referenced by `api/transcript.ts` only as a server-side Vercel fallback when `YTDLP_API_KEY` is configured, so browser interception cannot confirm its downstream call. The live build's `VITE_YOUTUBE_PROXY` value and server environment remain not fully observable. Therefore the first window remains precisely Worker/main `5/5` typed `provider_timeout` plus same-origin `5/5` 504, with later fallback unknown because its harness intentionally blocked those hosts; the second window is the unrestricted-by-harness observation for default transcript routes, with two technical timeout failures and three typed semantic/authorization outcomes.
- Root-cause boundary: local source returns Worker `asr_required` when caption providers yield no usable result while an ASR capability is configured, and the client treats typed `asr_required` as terminal to preserve explicit ASR opt-in. Native YouTube confirmation proves captions existed for these controls but does not prove that the Worker providers could acquire them. This is a classification/provider-acquisition discrepancy to review, not `captions_not_found` proof and not a browser-blocked production failure.

### Evidence-driven recommendation

The Sol gate is **MET narrowly for escalation to bounded local source/root-cause review**: ECHO-20260904-2235 was a distinct 5/5 technical timeout window, and ECHO-20260904-2325 is a distinct fresh 5/5 native-positive window containing two technical `provider_timeout`/network-to-same-origin failures. The other three results are `asr_required` semantic/authorization outcomes, not technical bad-window counts; no reliable no-caption negative exists. This does not authorize infrastructure or browser fallback integration. Keep `VPS_NEEDED_NOW=false` and the next path no-VPS measurement/source review; any fallback service or production browser integration requires a separate newly authorized product/safety decision. The previously destroyed temporary VPS remains destroyed and no new VPS was created.

## 2026-09-05 ECHO-20260905-0012 - Bounded local root-cause and fallback-order fix

- Re-anchored at `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`; before mutation there were 10 tracked dirty files and 36 untracked files, with no staged changes. All existing work was preserved. This cycle did not rerun either prior evidence window and did not perform live YouTube/production observation.
- Confirmed frontend root cause: `fetchYouTubeServerTranscript` previously deferred only Worker `provider_timeout` to same-origin `/api/transcript`; any typed Worker `asr_required` was thrown immediately. The outer transcript cascade then treated typed `asr_required` and server-boundary timeout as terminal, skipping independent non-ASR InnerTube, page, and npm caption routes. ASR consent remains separate: `allowAsr=1` is still required and no ASR/audio/media path starts automatically.
- Confirmed Worker semantics: the Worker runs bounded non-ASR caption stages (InnerTube, webpage, Invidious, Piped) before returning `409 asr_required` when no usable caption result exists and an ASR capability is configured. Thus that response means the Worker caption cascade is exhausted and ASR is available; it does not prove all independent frontend caption routes are exhausted, and it does not mean captions are absent. `/api/transcript` separately has a 1,000 ms optional server yt-api attempt and a 6,500 ms transcript-provider timeout; this cycle did not raise global budgets because the evidence justified client continuation after a typed server-boundary failure, not speculative timeout tuning.
- Implemented the smallest local change in `src/services/youtubeTranscript.ts`: defer Worker `asr_required` and server-boundary `provider_timeout`/`asr_required` until independent non-ASR client routes have run; preserve the typed deferred error if all routes fail. Explicit ASR, `captions_not_found`, acquisition-blocked errors, cancellation, stale-response protection, in-flight deduplication, and Retry behavior remain unchanged. No Worker or API production source was changed.
- Evidence boundary: the local tests prove fallback semantics only. Production deployment remains unchanged and current production recovery after this un-deployed fix is unknown. The prior two bounded windows remain the only live evidence; this cycle intentionally did not repeat them. The previously destroyed temporary VPS remains destroyed and no new VPS was created.

### Recommendation

`VPS_NEEDED_NOW=false`. D-012 is already **MET narrowly** through the two distinct prior windows and this cycle is the resulting bounded local root-cause/fallback-order work. This local fix does not authorize VPS, residential egress, Proxy-Cheap, browser-native production integration, or a new fallback service decision. The next meaningful gate is review/deployment authorization, followed—if authorized—by a separately bounded post-deploy production observation of the changed path.

### Local behavior validation continuation

- The original cycle2 Playwright failure was first separated from Vite startup: Vite became ready and returned HTTP 200, while the bundled Playwright Chromium executable was absent. Using the already configured local Chrome channel allowed browser startup. A subsequent cycle2 harness issue was confirmed: cross-origin mocked Worker responses lacked `Access-Control-Allow-Origin`, so browser fetch downgraded typed mock responses to `Failed to fetch`. The CORS mock fix remains in `e2e/cycle2-behavior-validation.spec.ts`.
- The attempted `localhost` → `127.0.0.1` Playwright host change did not resolve the runner completion/lifecycle issue and was reverted. In one post-CORS cycle2 run, the first two tests passed but the third later received `ERR_CONNECTION_REFUSED` at `page.goto`; the host-change run still hung until the outer timeout while Playwright terminated the Vite WebServer. This remains harness teardown/lifecycle evidence, not a product-flow failure.
- The stable `e2e/study-failure-recovery.spec.ts` harness was extended with a Worker `asr_required` → independent Vercel caption fallback scenario. The timeout fallback and new ASR-required fallback scenarios passed together: **2/2, 5.8 s**. The new scenario rendered non-empty captions, observed Worker then Vercel calls, recorded zero `allowAsr=1` calls, and confirmed no ASR-generation UI was started. No live YouTube or production request was made.

The meaningful local behavior result is therefore **PASS** for app startup and the changed fallback semantics through the stable mocked harness; cycle2's multi-test runner remains **BLOCKED** by teardown/lifecycle instability. No production claim is inferred. `VPS_NEEDED_NOW=false`.

## 2026-09-05 ECHO-20260905-1237 - Intended-diff/code-review gate

### Candidate boundary

Category A is limited to selected hunks in `src/services/youtubeTranscript.ts`, `src/services/__tests__/youtubeTranscript.test.ts`, and the added Worker `asr_required` -> independent Vercel caption Guest -> Study scenario in `e2e/study-failure-recovery.spec.ts`. The CORS correction in `e2e/cycle2-behavior-validation.spec.ts` is retained as test-harness correctness support only. Current sections in `PROGRESS.md`, `TEST_REPORT.md`, and `.workbuddy/memory/2026-09-05.md` are durable evidence hunks; shared historical content is not implicitly part of the candidate.

Category B is excluded from any future candidate commit/deploy: Worker cache observability (`cf-worker/src/index.js`, `src/services/__tests__/cfWorkerTranscript.test.ts`); VPS/yt-dlp (`vps-ytdlp/main.py`, `vps-ytdlp/test_main.py`); health checks; ScrapingBee adapters/evaluators/tests; local-native YouTube scripts; the production fresh-matrix harness; browser fallback adapter/orchestrator modules/tests; transcript measurement modules/tests; and the optional Playwright Chrome-channel setting. These files remain preserved dirty research/infrastructure work and are not authorized to ride along.

Category C requires separate follow-up: `src/pages/StudyPage.tsx`, `src/pages/studyCaptionError.ts`, and its test are an earlier related typed no-caption UI correction, separate from fallback ordering. `DECISIONS.md` was not changed in this review; D-012 remains canonical and D-009/D-010 remain superseded.

### Review and validation

The intended source diff is limited to typed error deferral. Explicit ASR consent, truthful `captions_not_found`/provider/acquisition-blocked distinctions, cancellation/stale safety, in-flight deduplication, Retry, and existing error rendering remain preserved. No P0/P1 issue was found in Category A. Client fallback routes have a pre-existing lack of one aggregate deadline and may amplify latency across sequential attempts; this is recorded as a separate bounded timeout-design follow-up, not changed here.

Stable local browser validation passed timeout fallback plus Worker `asr_required` -> independent Vercel captions (**2/2, 5.8 s**), proving non-empty UI lines, ordering, zero `allowAsr=1`, and no ASR UI start. The cycle2 no-caption case passed individually after the CORS correction, but its multi-test runner remains lifecycle-blocked. Targeted E2E ESLint and `git diff --check` passed. No live YouTube or production evidence was run. Category A is ready for an explicit commit/deploy authorization gate, not production accepted. `VPS_NEEDED_NOW=false`; the prior temporary VPS remains destroyed and no new VPS was created.

## 2026-09-05 ECHO-20260905-1357 - Exact production deployment and bounded observation

- Re-anchored on `main` at `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8`, equal to `origin/main`, ahead/behind `0/0`, with no staged changes. Remaining dirty and untracked work was preserved. GitHub public deployment metadata shows the Vercel GitHub App created Production deployment `6275908365` for exactly this SHA and completed it successfully; no duplicate manual deployment was run. Deployment target: `https://echolearn-jhjdwuan4-shmily0826s-projects.vercel.app`; canonical production: `https://echo-learn.uk`.
- Direct production HTML returned HTTP 200 from Vercel and referenced `/assets/index-DqSgfbdf.js`. No unique fallback-control literal survived minification as a useful source fingerprint; the exact GitHub Vercel deployment SHA/status is the stronger revision evidence. No Vercel CLI/auth file was available locally, and no token was read.
- Exactly two bounded production Guest -> Study cases used fresh guest Chrome profiles and previously independently YouTube-origin-confirmed controls: `ZbZSe6N_BXs` (`Happy`) and `JGwWNGJdvx8` (`Shape of You`). Media/videoplayback was blocked, default transcript fallback endpoints were not blocked, local proxy storage was cleared, Generate transcript was not clicked, Retry was not used, and no transcript text or sensitive request data was retained.

| Control | Worker/main | Same-origin/client observation | Final Study | Cache | Latency |
|---|---|---|---|---|---:|
| `ZbZSe6N_BXs` | `/api/transcript` `504`, typed `provider_timeout` | `/api/transcript` `504`, typed `provider_timeout`; `/api/yt` `200` responses had no non-empty lines | 0 lines; Retry visible | `UNKNOWN` | 24,579 ms |
| `JGwWNGJdvx8` | `/api/transcript` `504`, typed `provider_timeout` | `/api/transcript` `504`, typed `provider_timeout`; `/api/yt` `200` responses had no non-empty lines | 0 lines; Retry visible | `UNKNOWN` | 21,790 ms |

- `allowAsr=1` requests: **0/2 cases**; no ASR/audio/media acquisition started. Page errors were `0/2`, and no Retry was clicked. This is a two-control post-deploy observation, not a broad YouTube reliability claim. API 200 responses were not counted as success because the final Study UI had no transcript lines.

### `/api/yt` root-cause pass (single existing control)

- One additional read-only Happy observation classified the three same-origin `/api/yt` HTTP 200 responses; the first attempt's 30-second timeout was a harness argument-shape error, corrected once, and no Retry was used. No raw bodies, URLs, headers, cookies, tokens, or transcript text were retained.
- The three responses were two `POST` `innertube_player` responses (`4,824` and `3,210` bytes, JSON, `playabilityStatus=LOGIN_REQUIRED`, zero caption tracks, zero timed-text events), followed by one `GET` `youtube_page` response (`1,210,847` bytes, HTML, `ytInitialPlayerResponse` marker present but no `captionTracks` marker). No `/api/yt` timedtext request ran because no usable track URL was exposed by the player/page responses.
- This matches committed source: `fetchViaInnerTubeClient` accepts only player data with usable `captionTracks`, and `fetchViaWebPage` returns no result when the extracted page track list is empty. The observed 200s did not lose timedtext cues during parsing; upstream player/page data was already `LOGIN_REQUIRED`/trackless. Follow-up is a provider/upstream or fallback-design hypothesis, not a confirmed client extraction defect.
- The single diagnostic ended with 0 UI lines, Retry visible, `allowAsr=1` count `0`, and no ASR/audio/media acquisition. Production acceptance is **NOT MET** for this candidate; keep `VPS_NEEDED_NOW=false`. The previously destroyed temporary VPS remains destroyed and no new VPS was created.

### Provider/upstream A/B review

- Production `/api/yt` construction is server-mediated: `youtubeTranscript.ts` sends InnerTube POSTs to same-origin `/api/yt` with `clientName=ANDROID`/`20.10.38` and `clientName=WEB`/`2.20241201.00.00`, `hl=en`, `videoId`, `contentCheckOk=true`, and `racyCheckOk=true`. The Edge handler maps these to Android or Chrome/125-style User-Agent and YouTube client headers, adds a fixed consent cookie and `Accept-Language`, and does not forward browser Origin/Referer, visitorData, playbackContext, session cookies, or PO-token/attestation material. Page GETs likewise use server Chrome/125 identity plus the fixed cookie.
- The known-good local control was a real logged-out system Chrome session going directly to YouTube origin with browser-generated context and first-party navigation/player requests; no login/cookie import or ASR/media was used. It exposed usable native `captionTracks` and then direct YouTube timedtext HTTP 200 cues. Production instead returned two 200 InnerTube player responses with `LOGIN_REQUIRED` and no tracks, then a 200 page with player-response data but no `captionTracks`; no timedtext URL was exposed or requested. This proves the failure is before subtitle-track exposure, not a demonstrated timedtext parser loss.
- Current upstream evidence is consistent with this boundary but does not identify one cause: the [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) says current `web` enforcement can affect Subs and PO tokens bind to session/video context; [yt-dlp issue #15865](https://github.com/yt-dlp/yt-dlp/issues/15865) documents browser-playable public videos while non-browser extraction reports `LOGIN_REQUIRED`; [issue #17375](https://github.com/yt-dlp/yt-dlp/issues/17375) reports intermittent `LOGIN_REQUIRED`/403 and materially worse results on public VPN/datacenter IPs; [issue #17125](https://github.com/yt-dlp/yt-dlp/issues/17125) shows the separate post-track-exposure case where subtitles are discarded without a Subs PO token.
- Therefore PO-token enforcement is **not proven as the direct cause here**: no subtitle URL reached the Subs stage. Egress/IP reputation is plausible but not isolated from missing browser session/attestation context, static client identity, or YouTube video/time variability. No minimal non-ASR source fix is evidence-justified; guessed visitor data, PO tokens, cookies, or client recipes would be speculative.

## 2026-09-05 ECHO-20260905-1424 - Local Node static-recipe discriminator

- Re-anchored on `main`, HEAD=`origin/main=a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8`, ahead/behind `0/0`, with `0` staged, `10` tracked modified, and `36` untracked. No existing work was changed. One direct YouTube-origin experiment used only Happy (`ZbZSe6N_BXs`) and the current production static recipe from local Node/desktop egress; no Vercel/Worker, proxy, imported cookies, PO token, visitorData, playbackContext, ASR, audio, or media request was used.
- Local Node Android player: HTTP `200`, JSON, `playabilityStatus=OK`, `captionTrackCount=1`, timedtext URL would be exposed. Local Node WEB player: HTTP `200`, JSON, `playabilityStatus=UNPLAYABLE`, `captionTrackCount=0`. Local Node page: HTTP `200`, HTML, `ytInitialPlayerResponse` and `captionTracks` markers present. Only structural metadata was emitted; no bodies, URLs, cookies, tokens, or transcript text were retained.
- This is mixed evidence: the exact static Android construction succeeds from local egress while the same variant failed at Vercel before track exposure; this raises confidence that Vercel/server egress or IP reputation is a dominant variable. WEB still fails locally, so browser/session/attestation or client-specific enforcement remains a contributing possibility. The page marker also shows the server recipe can receive caption-bearing page data locally, unlike the production page observation.
- The result does not prove a PO-token subtitle-stage issue: local Android exposed a track without a supplied PO token, while no timedtext request was made in this discriminator. Current [PO Token guidance](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide), [#15865](https://github.com/yt-dlp/yt-dlp/issues/15865), [#17375](https://github.com/yt-dlp/yt-dlp/issues/17375), and [#17125](https://github.com/yt-dlp/yt-dlp/issues/17125) remain relevant context, not a direct diagnosis. No minimal non-ASR source fix is justified; changing egress, adding attestation/cookies/PO tokens, or changing client order requires a separate decision.

## 2026-09-05 ECHO-20260905-1440 - Existing Cloudflare `/api/yt` discriminator

- Re-anchored at `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8`, equal to `origin/main`, ahead/behind `0/0`; staged `0`, tracked modified `10`, untracked `36`. `handleProxy` was confirmed to be a pure allowed-host YouTube forwarder: it accepts the supplied POST body, sets its own Android UA/JSON/language/consent headers, forwards to the target, and does not invoke transcript cascade, VPS, ASR, ScrapingBee, or media routes.
- Sent exactly one Happy Android InnerTube POST through the deployed Cloudflare Worker `/api/yt` forwarding route. Sanitized result: Worker HTTP `200`; upstream/player JSON `4,800` bytes; `playabilityStatus=LOGIN_REQUIRED`; `captionTrackCount=0`; timedtext URL exposed `no`; timedtext events `0`. Transcript cascade, ASR, and media were not invoked; no raw body, target URL/query, cookies, tokens, or transcript text was retained.
- Compared with local Node direct Android `200/OK/1 track` and Vercel `/api/yt` `LOGIN_REQUIRED/0 tracks`, Cloudflare is **not** an immediate replacement for this control. The evidence is mixed rather than a clean Vercel-only IP proof: local desktop egress succeeds, while both cloud egresses fail before track exposure. The leading class is now cloud/server egress or environment versus browser/desktop context, without isolating exact IP reputation or attestation as the mechanism.
- No production source/config change is justified. The next solution-design boundary remains a separately authorized browser/session-attestation or managed-egress investigation; keep `VPS_NEEDED_NOW=false` and do not treat Cloudflare edge as proven clean/residential.

## 2026-09-05 ECHO-20260905-1435 - No-VPS solution-design map

### Current outbound acquisition paths

- Frontend `src/services/youtubeTranscript.ts`: optional local proxy only when `echolearn_local_proxy_url` is configured; then CF Worker `/api/transcript` followed by same-origin Vercel `/api/transcript`; then InnerTube Android/WEB and YouTube page scraping through the production `proxyUrl`; finally the client `youtube-transcript` package and its GET/CORS fallbacks. In production, the default `proxyUrl` is same-origin Vercel `/api/yt` unless `VITE_YOUTUBE_PROXY` was set at build time; that value is not observable here.
- Vercel `/api/yt`: Vercel Edge egress forwards YouTube player/page requests, maps the frontend Android/WEB client headers and User-Agent, and adds the fixed consent cookie/language behavior. It does not add browser visitor/session context or PO-token attestation. This is the path directly implicated by the production `LOGIN_REQUIRED`/trackless evidence.
- Vercel `/api/transcript`: Vercel server egress first attempts `YTDLP_API_URL` (the historical VPS route, with a short 1,000 ms budget), then the server `youtube-transcript` npm fallback with a 6,500 ms budget and fixed consent cookie. This is a separate provider chain from `/api/yt`; the observed same-origin `504 provider_timeout` does not prove which downstream provider completed.
- Cloudflare Worker `/api/transcript`: Cloudflare egress directly runs its own Android/iOS/WEB/TV InnerTube sequence, then webpage, Invidious, and Piped caption stages within an 11-second caption deadline; caption tracks are fetched and parsed when exposed. The Worker also has `/api/yt` forwarding through Cloudflare egress. The default frontend already calls the Worker transcript endpoint first, but current production results were `provider_timeout`/`asr_required`, not native-track success proof. Cloudflare edge is therefore **UNPROVEN**, not assumed residential/clean.
- Historical VPS/provider infrastructure is behind `YTDLP_API_URL` in both Worker/Vercel server chains. `SCRAPE_API_KEY` enables a separate gateway path in the Worker, and browser-native/proxy/ScrapingBee work remains separately gated and unintegrated.

### Ruled out or not established

- The deployed fallback-order fix is not sufficient by itself: production still reached the independent `/api/yt` stages but received upstream login-required/trackless data and produced `0/2` final UI successes. The local static Android recipe succeeds for Happy and Shape, so the current body fields/client recipe are not inherently invalid from the desktop egress.
- HTTP 200 from `/api/yt` is not success; production player/page responses contained no usable track list. PO-token enforcement is not established as the immediate failure because production failed before subtitle URL exposure and local Android exposed a track without a supplied PO token.
- The existing Worker direct path is not ruled out, but it is not proven: its current `provider_timeout`/`asr_required` evidence proves only that its bounded cascade did not return usable captions in those observations. Edge location does not prove a clean or residential IP.
- Browser-native local success proves a different browser/session context can reach captions, not that production can safely integrate browser fallback. Proxy-Cheap, ScrapingBee, new VPS/residential egress, ASR, and media acquisition remain out of scope.

### Top two future experiments

1. **Existing Cloudflare Worker stage discriminator — highest information gain and reversibility.** For one already-confirmed control, observe the existing Worker direct Android route (and, only if already enabled, its sanitized `debug=1` stage outcomes) to distinguish InnerTube track exposure, page track exposure, timedtext failure, and deadline exhaustion from Cloudflare egress. This needs no source change and can be read-only if current debug observability is already enabled; enabling debug or adding telemetry would cross a separate production authorization boundary. It would directly test whether the already-existing materially different edge path helps, without assuming that it does.
2. **Vercel server-egress A/B in a non-production deployment — moderate information gain, higher operational cost.** Replay the same exact Android request from a clean exact-commit preview or explicitly authorized Vercel region/network variant and compare it with the current production Vercel result. This can avoid production mutation but still requires deployment/authentication and may not provide a distinct IP guarantee; a region label alone is not proof of reputation change. Do not alter the production route until the result and rollback boundary are approved.

Browser-native fallback and managed alternate-provider/egress options have higher product/privacy/operational cost and should follow these two discriminators. VPS/residential egress remains last-resort context, not a current action.

`VPS_NEEDED_NOW=false`. This is architecture guidance only; no source behavior, deployment, provider, or production state changed.

## 2026-09-05 ECHO-20260905-1555 - Supadata Playground local Playwright blocker

- Installed local Playwright `1.62.1` and the existing Chrome channel were available without package installation or repository changes. One isolated navigation attempt to the official Supadata Playground failed before DOM load with `ERR_NETWORK_ACCESS_DENIED`.
- No Run was clicked, so the single probe allowance remains unused and Supadata native-only capability is still **untested**. No provider result, transcript content, API-key status, direct YouTube request, alternate provider, proxy, VPS, ASR/audio/media request, or production request was made.
- This is a local browser/network-environment blocker, not evidence of Supadata capability or failure. Per scope, stop without toolchain troubleshooting; preserve the no-key Playground as the next path only if the browser/network permission boundary is separately resolved. No source/config/test mutation occurred; `VPS_NEEDED_NOW=false`.

## 2026-09-05 ECHO-20260905-1640 - Supadata Playground Native matrix

- A user-launched dedicated Chrome with loopback CDP `9222` was successfully attached through Playwright `connectOverCDP`. This was a temporary test instrument, not intended production architecture; the browser remains user-open but is not a durable dependency. Settings stayed API key blank, Language `Auto`, Mode `Native`, and Text=false; Generate/ASR was not selected.
- The real native-only capability matrix was **5/5 PASS**: Happy (`ZbZSe6N_BXs`) PASS from the user-manual result; Shape of You (`JGwWNGJdvx8`) 92 cues; See You Again (`RgKAFK5djSk`) 79 cues; Roar (`CevxZvSJLk8`) 31 cues; Faded (`60ItHLz5WEA`) 42 cues. Each result was structured native transcript output with non-empty cues, timestamps/durations, monotonic offsets, and `semanticMatch=true` for the requested video.
- The initial runner incorrectly treated unrelated background HTTP 200 responses as settlement, causing overlapping UI actions and stale Result reads. The corrected rule is: before advancing, require the actual Playground `/api/run` count to increase by exactly one, the Result fingerprint to change, the input URL to match, and semantic binding to pass. A UI click without `/api/run` is a harness failure, not a provider failure or retry.
- This proves Supadata Playground native-caption capability from a local browser context only. It does not prove Supadata API-key behavior, API integration, production/cloud egress, cost/privacy/rate-limit performance, or EchoLearn production reliability. Supadata is now a strong managed-provider integration candidate, subject to separate formal API/cost/privacy/latency/reliability evaluation before implementation; it is not adopted or production-ready.
- No EchoLearn source/config/test change, commit, push, deploy, VPS/proxy, provider spend, ASR, audio, or media acquisition occurred. `VPS_NEEDED_NOW=false`.

## 2026-09-05 ECHO-20260905-1705 - Authenticated Supadata API probe blocker

- The project-root `.env.local` `SUPADATA_API_KEY` was confirmed present and non-empty without disclosure. Exactly one official Supadata transcript GET was attempted for Happy (`ZbZSe6N_BXs`) with `mode=native`, `text=false`, and `lang=en`.
- The request produced no HTTP response and failed locally with a fetch `TypeError` after approximately `136 ms`. No retry or follow-up polling occurred; no response structure, language, cue, timestamp, duration, or semantic evidence was available. Authenticated API capability therefore remains **UNTESTED**.
- This is a local/Codex network-context blocker, not a Supadata provider failure. The next useful discriminator should run from the user's normal desktop network context rather than repeat the blocked Codex network path. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## 2026-09-05 ECHO-20260905-1710 - Desktop authenticated Supadata API PASS

- A user-run authenticated Supadata native-only API probe from the normal desktop network succeeded for Happy (`ZbZSe6N_BXs`): HTTP `200`, approximately `3,353 ms`, `lang=en`, `availableLangs=en`, `cueCount=75`, non-empty content, and monotonic offsets. `semanticMatch=true`; no transcript text was retained.
- This is distinct from ECHO-20260905-1700: the prior Codex network-context request had a local fetch `TypeError` with no HTTP response. Authenticated Supadata API native capability is now proven from the user's normal desktop network; the prior result remains an execution-environment network blocker, not a provider failure.
- Next discriminator: one authenticated native-only matrix for Shape of You, See You Again, Roar, and Faded. Do not retry Happy. After that matrix, make the integration decision. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## 2026-09-05 ECHO-20260905-1720 - Supadata integration budget blocker

- The confirmed authenticated native-only API matrix is **5/5 acquisition PASS** overall: Happy HTTP 200, approximately 3,353 ms, 75 cues; Shape of You HTTP 200, approximately 14,352 ms, 92 cues; See You Again HTTP 200, approximately 2,789 ms, 79 cues; Roar HTTP 200, approximately 2,288 ms, 31 cues; Faded HTTP 200, approximately 2,110 ms, 42 cues. All were non-empty with monotonic offsets; strict semantic matching was 4/5 with See You Again matcher-inconclusive, not provider failure, because its 79-cue structure matched the prior semantic PASS.
- Direct caller inspection found caption-only `fetchYouTubeServerTranscript` gives same-origin Vercel `/api/transcript` an **8,000 ms** timeout. The Vercel handler currently spends up to **1,000 ms** on its VPS attempt and **6,500 ms** on `youtube-transcript` before any post-npm provider could run. A post-npm `SUPADATA_TIMEOUT_MS=2,500` path would therefore be both too short for the measured 14,352 ms positive and unreachable within the current caller budget.
- No Supadata source integration remains: the scoped draft in `api/transcript.ts` and `src/api/__tests__/transcriptHandler.test.ts` was removed. This is an architecture/product decision gate, not a provider failure. Choice A is to increase the Vercel caller/server budget and choose a provider order, likely allowing Supadata before npm; Choice B is to keep the current latency budget and defer Supadata integration. No tests, commit, push, deploy, or production mutation occurred.

## 2026-09-05 ECHO-20260905-1534 - Active-goal scope guard and current handoff

- Added a durable active-goal scope-discipline rule to `DECISIONS.md`: after the goal/root cause/acceptance criteria are specific, each investigation, test, read, or edit must have a clear current hypothesis, acceptance-criterion, regression, or safety purpose. Start/recovery history reads and history needed by a concrete hypothesis remain valid; unrelated history, speculative edge cases, repeated stable tests, and unrelated polishing are scope drift.
- Current Supadata status: native-only capability remains **untested**. The anonymous unified API is documented as requiring authentication; the one no-key direct request returned no HTTP response (`fetch failed`), so it did not establish an API error or capability result. No local Supadata credential exists. The official Playground is the remaining no-key path, pending explicit Chrome Computer Use approval; no Run has been completed.
- No provider spend, VPS, source behavior/config/test mutation, production request, commit, push, or deploy occurred. `VPS_NEEDED_NOW=false`; next step is only the bounded Playground probe after browser-control approval, otherwise stop at the credential/tool boundary.

## 2026-09-05 ECHO-20260905-1735 - Reliability-first Supadata fallback implemented

- The accepted authenticated native-only Supadata matrix remains **5/5 acquisition PASS**: Happy approximately 3,353 ms / 75 cues; Shape of You 14,352 ms / 92 cues; See You Again 2,789 ms / 79 cues; Roar 2,288 ms / 31 cues; Faded 2,110 ms / 42 cues. Strict semantic matching was 4/5 plus one See You Again matcher-inconclusive result, not provider failure.
- Choice A is implemented locally: configured VPS first, then opt-in Supadata native, then existing youtube-transcript/npm. No-key behavior preserves the old chain. The handler uses a 21,000 ms overall deadline, Supadata gets up to 18,000 ms, the caption-only Vercel caller allows 22,000 ms, and later providers are bounded by remaining time. The Supadata request is server-only, one-shot, `mode=native`, `text=false`, with optional requested language only; normalized cues are validated before acceptance.
- Typed outcomes and arbitration are covered: 206/unavailable continues safely; 401/403/429/5xx/network/timeout remain provider/acquisition errors or typed timeout; malformed and empty payloads are rejected; 206 cannot overwrite an earlier provider timeout/acquisition block; Supadata never invokes ASR/generate. Logs contain provider/outcome/latency metadata only, without keys, URLs, or transcript text.
- `vercel.json` was not changed. The application budget is local and the deployed Vercel runtime/function-duration and `SUPADATA_API_KEY` binding remain deployment-time verification items; no dashboard, production secret, deployment, commit, or push was touched. `VPS_NEEDED_NOW=false`.
- Validation: focused transcript Vitest pair **55/55 PASS**; typecheck, production build, targeted ESLint, and `git diff --check` PASS. The installed-Chrome delayed Study behavior passed in **14.2 s** with non-empty captions after the old 8 s boundary and explicit no-ASR assertions; the outer Playwright command timed out during runner/webServer cleanup, so E2E completion is **validation-layer BLOCKED**, not a product assertion failure. Pre-existing dirty work was preserved.

## 2026-09-05 ECHO-20260905-1808 - Deployment-readiness read-only verification

- Git truth remains root `D:/CODE/project/EchoLearn`, branch `main`, HEAD `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8`, origin `git@github.com:Shmily0826/EchoLearn.git`; all pre-existing dirty and untracked work remains preserved.
- `.vercel/project.json` is present and links this checkout to Vercel project `echolearn` and its existing team/org metadata. `vercel.json` contains rewrites only; there is no explicit `maxDuration` or runtime override. Package deployment scripts use the existing Vite build and do not include a Vercel CLI dependency.
- Local `.env.local` exists, is ignored by `.gitignore`, and has a non-empty `SUPADATA_API_KEY` by boolean presence check only. No value was printed or persisted. Production/Preview/Development Vercel variable presence could not be checked: `vercel` is unavailable on PATH and `npx --no-install vercel` is unavailable, so no CLI-authenticated query was possible.
- The client scan found no production `VITE_`/`import.meta.env` Supadata exposure; remaining matches are server/API tests only. The server logging scan found no Supadata key, transcript text, or URL logging pattern. No provider, YouTube, app, dashboard, commit, push, or deploy request was made.
- Read-only conclusion: the 21,000 ms handler / 22,000 ms caller design is locally configured but deployed runtime capacity and server-side `SUPADATA_API_KEY` binding remain unverified. No `vercel.json` change is justified. Next release sequence is: verify Vercel env names/targets and runtime metadata in an authorized CLI/dashboard context, then obtain separate explicit authorization for commit, push, and deploy.

## 2026-09-05 ECHO-20260905-1818 - Vercel duration configured; secret setup blocked

- Git truth was reconfirmed before editing: root `D:/CODE/project/EchoLearn`, branch `main`, HEAD `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8`, origin unchanged, and all pre-existing dirty/untracked work preserved.
- `vercel.json` now minimally declares the official schema and `functions["api/transcript.ts"].maxDuration = 30`; all 7 existing rewrites remain unchanged and no other function is configured. Native PowerShell JSON validation passed: parsed successfully, schema present, transcript duration 30, rewrite count 7.
- `npm run build` passed after the config edit. No provider, YouTube, app, dashboard, commit, push, or deploy request was made.
- The single permitted temporary CLI attempt (`npx -y vercel@latest`) could not fetch the package because npm returned local `EACCES`; CLI auth, project/env inspection, and Production secret creation therefore remain blocked. The local ignored `.env.local` key remains present by boolean-only check; its value was never printed.
- Release boundary: runtime ambiguity is resolved locally by the explicit 30-second function limit, but Production `SUPADATA_API_KEY` binding remains unverified/unconfigured. The next authorized action is only to add the existing key to Vercel Production through an available authenticated CLI/dashboard path; commit, push, and deploy remain separately unauthorized.

## 2026-09-05 ECHO-20260905-2125 - Current dashboard secret report

- The user reports that Vercel Dashboard Production-only `SUPADATA_API_KEY` has now been manually added. This is dashboard state reported by the user, not independently verified by Codex; no secret value was read or stored.
- ECHO-20260905-1818 remains historical truth for the earlier CLI `EACCES` blocker. No redeploy has occurred, so production runtime behavior and the deployed secret binding must not be claimed active.
- Local source/config release-prep remains green per ECHO-20260905-2120. Commit, push, and deploy remain separately unauthorized. `.playwright-cli/` and `.tmp-playwright-daemon/` are browser-control investigation artifacts and must be excluded from staging.

## 2026-09-05 ECHO-20260905-2228 - Production Supadata fallback validation

- User-confirmed Vercel revision `61fe54d` is **Ready** and **Production** on `main`.
- Exactly one production caption-only request was made through `https://echo-learn.uk/api/transcript` for video `ZbZSe6N_BXs`: HTTP `200`, `4512 ms`, response source `supadata`, language `en`, `75` non-empty cues, valid timestamps, and monotonic ordering. No failure code was returned.
- The request used no retry or polling, no direct Supadata call, no ASR, Generate, or auto mode, and no secret access. No transcript text was printed or retained.
- This conclusively validates the deployed Supadata native fallback at the server boundary. Browser Study-page E2E remains optional/non-blocking: it could add UI confidence but would not materially change the release decision. No source/config/test edits or additional deployment action occurred.

## 2026-09-05 ECHO-20260905-2245 - Caption Diagnostics V1

- Added optional end-to-end caption provenance and privacy-safe Supadata attempt outcomes. Successful paths retain raw provider IDs (`supadata`, `vps`, `npm`, and existing native/Worker values); the Study renderer translates the source once, fixing the previous double-label risk. Dashboard navigation, reload, manual loads, ASR-result persistence, Bilibili part loads, and saved sessions preserve optional provenance without a schema migration.
- Added a browser-local aggregate for Supadata attempts, successes, unavailable/206 outcomes, timeouts, failures, and estimated credits. Study shows the compact estimate only when Supadata was attempted and labels it as this-browser/device estimate and likely usage; it is not billing or global telemetry. Storage failures remain non-fatal.
- No provider order, timeout, latest-request-wins, caption/ASR boundary, or new infrastructure changed. Diagnostics contain no key, URL/video ID, transcript text, upstream payload, cookie, or token.
- Focused Vitest validation: **84/84 PASS** across transcript handler, client fallback, diagnostics aggregate, request lifecycle, session persistence, and source-label tests. `npx tsc -b --pretty false`: PASS. Targeted ESLint: PASS with 0 errors and 8 existing StudyPage hook/dependency warnings. `npm run build`: PASS. No provider or production request was made; no E2E rerun was needed for this bounded correction. Commit/push/deploy: NO.
