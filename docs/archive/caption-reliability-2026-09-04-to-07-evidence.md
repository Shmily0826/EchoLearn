# Caption reliability evidence archive — September 4–7, 2026

These dated records describe the original experiments and decisions. Paths in the records refer to the repository root unless specified otherwise. Use the [testing guide](../TESTING.md) for current validation.

[Test report](test-report-2026-08-to-10.md) · [Archived progress](caption-reliability-2026-09-04-to-07-progress.md)

## 2026-09-04 ECHO-20260904-0021 — AWS browser-host feasibility inventory

### Scope and actual result

- Performed a read-only inventory of the existing AWS host `3.107.69.57`; no Chrome/Chromium, Xvfb/`xvfb-run`/`xdpyinfo`, `DISPLAY`, browser automation runtime, Docker/Podman/containerd/nerdctl, or task-local CDP runtime was available.
- Host capacity observed: 2 CPUs, 908 MiB total RAM, approximately 510 MiB available, and 0B swap. No browser experiment ran because the required browser/display precondition was absent.

### Evidence boundary and state

- Sanitized external evidence is retained at `D:\CODE\API\echolearn\evidence\ECHO-20260904-0021` (`inventory.json`, `manifest.json`, checksums). It records the inventory and the explicit no-browser-experiment boundary; it contains no claim about server timedtext semantics.
- Local repository remained on `main`, with the existing dirty work preserved; GitHub state was not changed. The AWS production service and system packages were not mutated, and no install/download/SSH action was performed in this cycle.

### Remaining gap and next decision

- The server-side browser feasibility question remains open: browser working-set, Xvfb overhead, request concurrency, and server cost were not measured. Given 908 MiB/no swap, do not co-locate a persistent browser stack by assumption.
- Next decision: evaluate a separately isolated browser execution host/service first. A one-shot user-space pilot on the existing host is only a later, explicitly authorized gate with a measured budget and immediate stop conditions.

## 2026-09-04 ECHO-20260904-0032 — local browser-native YouTube subtitle prototype

### Method and actual result

- Local-only prototype used directly spawned headed system Chrome `152.0.7977.66` with a fresh disposable `--user-data-dir`, loopback CDP, `--no-first-run`, and `--no-default-browser-check`; Playwright attached with `chromium.connectOverCDP`. The headed Playwright launch path was not equivalent on this machine and produced empty timedtext bodies, while external Chrome restored the usable result.
- M7 baseline and controlled media A/B both classified **SUCCESS**: one `200 application/json` timedtext response, 65,976 bytes, 466 parsed events/segments, and matching timeline results. Media was blocked after the A/B comparison for the bounded matrix; no audio extraction, ASR, or media result was used.
- The diversified matrix ran exactly once for 24 non-target videos: **18 SUCCESS**, **4 PLAYER_BLOCKED**, **1 CAPTION_PARTIAL_COVERAGE**, and **1 NO_CAPTION_TRACK**. Intended-available content was 18 controls with **17/18 SUCCESS**; six controls were excluded from that denominator. Four fixtures ran three stability repeats plus baseline: **12/12 SUCCESS**, with unchanged classification and line-count ranges.

### Validation, resource observations, and evidence boundary

- Parser validation: **8/8**; full application tests: **441/441**; typecheck and build passed; lint had **0 errors / 13 existing warnings**; `git diff --check` passed. The cleanup race fix was exercised, including task-owned Chrome/profile cleanup behavior.
- Observed matrix latency was **11,554–14,225 ms**, average **12,047 ms**. Node RSS was recorded at **140,845,056–262,078,464 bytes**. Chrome working-set and server-side resource/cost measurements were unavailable; bandwidth and monetary cost were not measured.
- Sanitized external evidence is retained at `D:\CODE\API\echolearn\evidence\ECHO-20260904-0032`; the local runbook also exists in gitignored `.workbuddy/memory/MEMORY.md`. This tracked entry is the durable recovery record for the launch method and acceptance boundary.
- This is local browser evidence only: it does not prove Worker/Vercel/VPS/AWS/production behavior. No caption text, cookies, login/session data, request secrets, media/audio, or ASR output was persisted or reported.

### Remaining gap and next decision

- The prototype supports a bounded feasibility stage, but does not justify production integration. Chrome working-set, Xvfb/display overhead, host concurrency, sustained failure rate, bandwidth, and cost remain unmeasured.
- Next decision: run a separate fresh-profile browser execution pilot at single concurrency with explicit privacy, timeout, cleanup, RSS/Chrome working-set, bandwidth, and fail-closed classification evidence. Do not install on or co-locate with the 908 MiB/no-swap AWS VPS without a separately authorized one-shot budget test; stop on memory pressure, swap/OOM, cleanup failure, ambiguous player/caption state, secret/cookie exposure, or any production mutation risk.

## 2026-09-04 ECHO-20260904-0148 — local browser-resource telemetry hardening

### Implementation and safety boundary

- Extended only `scripts/local-native-youtube/` with a sanitized telemetry helper and focused tests. Windows resource sampling uses the spawned Chrome root PID and a CIM/PowerShell descendant walk, so Chrome children are included even when they do not carry the disposable profile argument. The sampler records peak aggregate working set, private bytes, process count, and a coarse aggregate CPU-time delta; sampling failures remain nullable diagnostics and do not alter caption classification.
- Added CDP `Network.requestWillBeSent`, `Network.loadingFinished`, and `Network.loadingFailed` accounting. Only request count, encoded bytes, failure/event counters, and coarse `caption`/`media`/`other` categories are retained. Media and `/videoplayback` requests remain blocked for the positive control. No raw URL, query string, header, cookie, token, request body, or caption text is persisted.
- Added `--about-blank-smoke` (three sequential fresh-profile cycles) and `--positive-control` (one M7-only fresh-profile capture) modes. The first smoke attempt exposed a sampler timeout/PowerShell compatibility defect and was not used as resource evidence; after the in-scope fix, the required smoke was rerun successfully. No bulk matrix, target `YweN5PUyGgc`, A/B, ASR, audio, server install, production mutation, commit, or push was performed.

### Actual validation and measured result

- Focused local harness tests: **13/13 PASS** across the parser and telemetry test files. `node --check` passed for the changed harness modules. `git diff --check` passed.
- About:blank smoke: **3/3 PASS**, all with 0 initial cookies, 0 CDP requests, 0 encoded bytes, 2 valid process-tree samples, 0 sampling failures, and first-attempt profile cleanup. Latency was **6,032–6,127 ms**. Peak aggregate Chrome tree working set was **926,441,472–938,397,696 bytes**; private bytes **562,106,368–580,759,552 bytes**; peak process count **12**; peak aggregate CPU-time delta **2,078–2,312 ms**.
- Exactly one M7 positive control with media blocked: **SUCCESS**; latency **13,605 ms**; Node RSS **111,534,080 bytes**; peak aggregate Chrome tree working set **1,956,499,456 bytes**; peak private bytes **1,482,866,688 bytes**; peak process count **15**; six valid samples, 0 sampling failures, and peak aggregate CPU-time delta **17,484 ms**. Network telemetry observed **210 requests** and **5,158,461 encoded bytes**: caption **1 / 12,899 bytes**, media **15 / 0 bytes**, other **194 / 5,145,562 bytes**; 189 loading-finished and 17 loading-failed events; no malformed telemetry events. Cleanup removed the fresh profile on the first attempt.
- Caption evidence remained independent of telemetry: player `OK`, two caption tracks, one 200 `application/json` timedtext response, 65,976 in-memory response-body bytes, 466 parsed events/segments/usable lines, timeline span ratio approximately 0.990, and 0 page errors. Telemetry was diagnostic only and could not create a caption success.

### Capacity recommendation and evidence boundary

- The measured active single-browser peak is approximately **1.96 GB aggregate working set / 1.48 GB private bytes**, with a quiet about:blank baseline of approximately **0.93 GB working set / 0.56 GB private bytes**. For a future single-concurrency server pilot, use an isolated host with at least **4 GiB total RAM** and an explicit no-swap/OOM policy; treat **2.5 GiB available-memory headroom for the task-owned browser tree** as a minimum acceptance budget derived from the observed 1.96 GB peak plus modest operating margin. This is sizing guidance, not provisioning or a cost estimate.
- Pilot acceptance should require fresh logged-out profiles, media blocking, bounded timeout, valid process-tree samples, encoded-byte/category telemetry, no memory pressure/swap/OOM, first-attempt cleanup, and fail-closed handling when resource observation is unavailable. Start at one concurrent browser only; do not infer higher concurrency, sustained rates, provider pricing, or monetary cost from this single local control.
- This is **local Windows evidence only**. It does not establish AWS/VPS feasibility, server performance, Worker/Vercel behavior, production acceptance, or any deployment recommendation. The existing 908 MiB/no-swap AWS host remains unsuitable for this browser pilot by measured capacity margin, and no infrastructure action is authorized in this task.

### Repository state at cycle end

- Branch remained `main`; existing unrelated dirty files and the previously updated `PROGRESS.md` / `TEST_REPORT.md` were preserved. Task-owned additions are limited to the local-native-youtube telemetry helper/test and harness changes. No commit, push, deploy, AWS mutation, paid infrastructure, or system package installation occurred.

## 2026-09-04 ECHO-20260904-1116 — Linux headed/Xvfb pilot preflight blocker

### Scope and actual result

- Re-anchored the accepted local telemetry checkpoint and performed a read-only local provisioning preflight. No browser traffic, host mutation, package installation, cloud API mutation, production AWS access, commit, push, or deploy was performed.
- No reusable separate non-production host was identified. The existing AWS host remains explicitly excluded because it has 908 MiB RAM and no swap.
- No configured provisioning path was available on this machine: `aws`, `doctl`, `gcloud`, `az`, Terraform, Docker, and Podman were absent; expected AWS/DigitalOcean/GCP/Azure configuration directories were absent. `ssh`/`scp` binaries exist, but no usable non-production host identity or connection target was available; the local SSH directory could not be inspected due to access denial, and no key contents were read.

### Evidence boundary and state

- The Linux headed/Xvfb browser pilot was **not executed** because the required separate host and credentialed access path were absent. Therefore there are no pilot memory, process, network, caption, latency, or cleanup measurements to report for this task.
- Local repository remained on `main` at `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`, matching `origin/main`; unrelated dirty work was preserved. Production Worker/Vercel/VPS/AWS state was not changed.

### Blocker and next decision

- Genuine blocker requiring user-supplied external state: provide an already-running isolated Linux host with SSH access, or explicitly configure one approved disposable-host provisioning path with region/plan/cost and credentials available to this environment.
- Once supplied, the next bounded gate remains one isolated headed/Xvfb pilot at single concurrency with at least 4 GiB RAM, a 2.5 GiB task-browser available-memory budget, fresh logged-out profile, media blocking, two accepted positive controls, sanitized telemetry, deterministic cleanup, and no production integration. No host was created, so there is no host to destroy or hand back.

## 2026-09-04 ECHO-20260904-1128 — browser-native fallback productization gate

### Decision

- **GO for gated productization work; NO-GO for production integration in this cycle.** The accepted local evidence shows meaningful value for caption-bearing videos whose normal server/provider paths are blocked or fail transiently: 17/18 intended-available matrix controls succeeded, four-fixture stability was 12/12, and one media-blocked M7 control succeeded with structured captions.
- The prior DigitalOcean VM lifecycle is complete: `170.64.143.102` was intentionally destroyed after `USER_MAY_DESTROY_DO_VM=true`; materially distinct yt-dlp/session/cookie/visitor-data axes were exhausted. It is not unfinished work and must not be recreated for this decision.

### Current production flow and boundary

- The browser client first uses an explicitly configured local proxy only when the user opts in. The normal production service calls the Cloudflare Worker `/api/transcript`; caption-only Worker requests read the Worker cache first, then run the bounded InnerTube, webpage, Invidious, and Piped caption cascade under an approximately **11 s** caption deadline. Worker/VPS credentials remain server-side.
- The frontend treats a Worker caption timeout as transient and gives same-origin Vercel `/api/transcript` one independent bounded attempt. Vercel may call the VPS caption route with its server-side key and otherwise uses the bounded `youtube-transcript` fallback. The VPS caches successful caption payloads in memory and runs yt-dlp caption-only acquisition; ASR/audio remain explicit separate paths.
- If those paths do not return usable lines, the frontend may continue through its existing proxied InnerTube/web/npm strategies or surface typed/diagnostic failure. `captions_not_found`, `transcript_disabled`, `asr_required`, invalid/auth/rate-limit outcomes, and known semantic outcomes are not equivalent to provider transport failure. The local dirty Worker/VPS files are future candidates, not the accepted production release.
- There is currently no browser-native production provider, browser cache, browser host, or Linux/Xvfb evidence. Existing Worker cache namespace is `v=1`; frontend in-flight dedup is keyed by video/language/ASR mode; VPS cache stores successful results only.

### Product value, limits, and option ranking

| Option | Assessment |
|---|---|
| A. Dedicated single-concurrency browser fallback after eligible provider failure | **Recommended.** Targets the demonstrated access/provider gap while preserving the fast caption cascade and limiting resource/abuse exposure. |
| B. Browser-first for every YouTube cold miss | Reject. The observed 13.6 s latency and 1.96 GB Chrome-tree peak make it an unnecessarily expensive first path when current providers succeed faster. |
| C. Managed third-party browser/transcript service | Defer/reject for now. It adds opaque privacy, retention, quota, and pricing dependencies without evidence that it improves this specific failure mode. |
| D. Do not productize browser fallback | Not recommended as the final decision. It would discard a credible 17/18 intended-available recovery signal, though it remains the safe fallback if the Linux gate fails. |

- Plausible coverage: caption-bearing videos where datacenter/provider fetches fail, bot/transport handling differs, or browser-native timedtext access succeeds. The browser path does not create captions where the player exposes no track, does not repair `PLAYER_BLOCKED`, and does not make a partial/truncated caption complete. Those outcomes remain explicit browser diagnostics, not fabricated success.
- Cost/risk characteristics: approximately **13.6 s** local positive latency before any preceding provider-failure time; **1,956,499,456 B** peak aggregate browser working set, **1,482,866,688 B** private bytes, and **15** processes; **5,158,461** encoded bytes across **210** requests with **0** media bytes. A single browser can consume a large fraction of a small host and repeated public requests can create YouTube/provider abuse risk.
- Privacy/security: use only validated video IDs and language, fresh logged-out profiles, loopback CDP, no imported cookies/login, media blocking, no arbitrary URL/SSRF input, and no persisted raw URLs, query strings, headers, cookies, tokens, request bodies, or caption text. Caption lines may pass transiently to the authorized caller because they are the product result; diagnostics must remain sanitized.

### Recommended architecture and exact policy

- Add a dedicated, private browser fallback service behind server-to-server authentication. The existing server orchestration invokes it only after the normal caption providers exhaust an **eligible transport/provider failure**. The service owns one browser slot, Xvfb/headed Chrome lifecycle, profile isolation, resource guard, and cleanup. It is not called directly by the public browser client and is not co-located with the 908 MiB production VPS.
- Eligible triggers: typed `provider_timeout`; typed/gathered `provider_failure`; upstream 5xx/network failure across the normal caption providers; and a future caption-specific acquisition-blocked code if its semantics explicitly mean timedtext access rather than media/audio access.
- Non-triggers: cache hit; `captions_not_found`; `transcript_disabled`; `asr_required`; invalid input; authentication failure; rate limit; user cancellation; known `PLAYER_BLOCKED`; known no-caption-track; and any media/audio acquisition failure. Do not use browser fallback to bypass explicit ASR consent or to turn an ambiguous failure into no-caption truth.
- Proposed bounded budget, to be validated on Linux: **25 s end-to-end** for queue admission, headed acquisition, and cleanup; at most **2 s** waiting for the single slot, approximately **18 s** acquisition, and up to **5 s** forced cleanup. No browser-layer retry. The caller cancels immediately on client disconnect/deadline and the service kills the owned process tree before releasing the slot.
- Single-flight/dedup: coalesce identical `videoId + lang + caption-mode` requests to one in-flight job; never allow concurrent browser jobs in the initial pilot. A stale/late result must be discarded by request generation/trace identity and must not overwrite a newer video/session result.
- Cache: check the canonical caption cache before starting a browser. Write only validated non-empty structured success after cleanup; never cache provider/browser failures or partial results. Use a browser-provider/versioned cache marker rather than silently changing the existing `v=1` namespace during implementation.
- Resource guard: reject admission when the slot is occupied or host memory is below the measured safety floor; sample the full descendant tree; stop on memory pressure, swap/OOM, process-count anomaly, CDP loss, or cleanup ambiguity. A resource-observation failure is a diagnostic/provider failure, never a caption success.
- Safe observability: provider/outcome code, trace ID, latency, queue wait, cache hit/miss, browser version, player status, track count, parsed line/event/segment counts, caption body byte count, total encoded bytes, request count/categories, peak process count, peak working/private bytes, CPU delta, cancellation, and cleanup result. Do not persist raw request identity or content.

### Smallest service contract (design only)

- Internal request: `POST /v1/caption-transcript`, authenticated server-to-server; `{ videoId, lang, traceId, deadlineAt }`. Accept only an 11-character YouTube ID and bounded language value; reject arbitrary URLs and any ASR/media flag.
- Success `200`: `{ ok: true, lines, language, isAutoGenerated, source: "browser-native", diagnostics }`, where diagnostics contain only the safe fields above. `lines` are transient product output and are not written to telemetry logs.
- Failure: internal typed outcomes `browser_timeout`, `browser_runtime_failure`, `browser_resource_guard`, `browser_cancelled`, `browser_busy`, `browser_player_blocked`, `browser_no_caption_track`, `browser_empty_response`, and `browser_partial_coverage`. The orchestrator maps transport/resource failures to existing `provider_timeout`/`provider_failure`; it does not map a browser negative observation into a fabricated success or definitive no-caption result without the existing semantic rule.

### Finite validation ladder and remaining work

1. **Architecture/contract decision — COMPLETE now.** Document option A, trigger taxonomy, budgets, cache/cleanup/privacy rules, and contract. No infrastructure required.
2. **Isolated local implementation/tests — MUST before local real-provider integration; can proceed now.** Add a provider adapter behind the existing orchestration seam, mock the browser service, test eligible vs ineligible triggers, response validation, timeout/cancellation, single-flight, stale responses, cache writes, no-ASR boundary, and fail-closed telemetry. This is local code only and should not alter production routing until the host gate passes.
3. **One batched Linux/Xvfb host lifecycle — MUST before real browser-service integration and MUST before production deploy.** Use one separate 4 GiB+ host; record exact plan/region/cost; install headed Chromium/Chrome plus Xvfb in an isolated user/service boundary; run 2–3 about:blank cycles, then exactly two accepted positives (M7 and one distinct prior positive) with fresh profiles, loopback CDP, no headless flag, media blocked, process-tree peak, encoded network categories, >=25% host memory headroom, timeout/cancellation, orphan scan, and cleanup. Do all host-dependent checks in this one lifecycle; do not recreate the destroyed DO VM or use the production AWS VPS.
4. **Local orchestration integration and high-value E2E — MUST before production deploy.** With the real service endpoint isolated, verify the existing fast path remains first, eligible fallback triggers exactly once, definitive outcomes do not trigger it, two positives return structured captions, negatives remain typed, stale responses cannot overwrite state, and no raw telemetry is persisted.
5. **Production canary/acceptance — MUST before general release.** Requires explicit deployment authorization, feature flag/rollback, server-side auth, one-slot capacity/rate limits, two positive controls plus a bounded negative/blocked control, no media bytes, no orphan processes, no secret/session leakage, and observed failure/timeout metrics. This is not authorized in the current task.
6. **Optional confidence:** larger non-target matrix, controlled concurrency/load, browser-version variance, longer soak, and third-party comparison. None is required before deciding whether the bounded A architecture is worth pursuing.

- Linux/Xvfb reproduction is **not mandatory before isolated local interface/adapter implementation and mocked tests**. It **is mandatory before real browser-service integration acceptance and any production deployment**, because headed/Xvfb semantics, Linux process footprint, cleanup, and anonymous YouTube behavior remain unproven.
- Stage position: architecture decision is complete; local adapter/test work can proceed without infrastructure; the next external gate is exactly one future batched 4 GiB+ host lifecycle followed by two positives. Production integration is not justified yet.

### Repository and environment state

- This cycle changed documentation only. `PROGRESS.md` and `TEST_REPORT.md` were updated; no application/provider code was changed. `git diff --check` passed with existing Windows line-ending/config-ignore warnings.
- Branch remains `main`; `HEAD` and `origin/main` remain `6616139a0810f45b09c5c232054fa6860c9c4aa3`. Existing dirty/untracked work is preserved. No host was created, reused, installed, destroyed, or left running in this cycle; no cost was incurred or estimated.
- GitHub, Worker, Vercel, VPS, AWS, and production state were not mutated. No commit, push, deploy, or production integration occurred.

## 2026-09-04 ECHO-20260904-1137 - isolated browser fallback contract

### Scope and implementation

- Added `src/services/browserTranscriptFallback.ts` as a local-only contract and orchestration seam. It is disabled by default and is not imported by `fetchYouTubeTranscript` or any production route.
- Trigger policy is pure and fail-closed: only `provider_timeout`, `provider_failure`, `network_failure`, and `upstream_5xx` can invoke the fallback. Definitive no-caption, transcript-disabled, ASR-required, invalid/auth/rate-limit, cancellation, known player-blocked, no-track, partial-coverage, media, and audio outcomes remain non-triggers.
- The typed mapper accepts only non-empty structured timed lines with valid timing and maps browser/service outcomes to explicit `provider_timeout`, `provider_failure`, `player_blocked`, `captions_not_found`, `partial_coverage`, `cancelled`, `resource_exhausted`, `slot_unavailable`, `cleanup_failure`, and `invalid_response` errors. Invalid or diagnostic-only responses cannot become success.
- The adapter models one browser slot with same-key `videoId + lang + caption-mode` single-flight, per-subscriber cancellation and deadline handling, underlying abort when all subscribers leave, and generation-based stale-response discard. Cache eligibility is a pure boundary and writes only validated structured success under `browser-native:v1`; it does not mutate the existing production `v=1` namespace.

### Tests and validation

- Added deterministic Vitest coverage for eligible/non-eligible triggers, response mapping, sanitized diagnostics, disabled-by-default behavior, duplicate coalescing, slot rejection, cancellation propagation, all-subscriber abort, deadline timeout, stale-response discard, executor cleanup failure, malformed/empty responses, and cache eligibility.
- Validation result: focused Vitest `36/36` passed; `npx tsc -b --pretty false` passed; targeted ESLint on the two new files passed with no errors; and `git diff --check` passed with existing Windows line-ending/config-ignore warnings.
- Real browser, YouTube, Linux/Xvfb, cloud, production, and server tests were intentionally not run. The future Linux/Xvfb real-service gate remains a single batched lifecycle on a separate 4 GiB+ host with two accepted positive controls; the destroyed DigitalOcean VM remains complete and will not be recreated.
- Existing production behavior remains unchanged because no application provider call site was modified.

### Evidence and state boundary

- This cycle provides local TypeScript contract/orchestration evidence only. It does not establish Linux browser behavior, service capacity, production recovery rate, pricing, or deployment readiness.
- No host was created or reused; no system package was installed; AWS/Vercel/Worker/VPS/production were untouched; no commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1200 - Linux/Xvfb pilot SSH access blocker

### Preflight and boundary

- User supplied the new separate validation VPS `170.64.184.233` and authorized installation only on that host. The previously established project identity path was checked without reading key contents.
- SSH reached the supplied address, but `ubuntu@170.64.184.233` and the single bounded `root@170.64.184.233` retry both returned `Permission denied (publickey)` using that same established key.
- No authenticated remote command ran. Therefore no host baseline, package/runtime availability, headed/Xvfb setup, browser run, resource/network telemetry, cancellation, cleanup, restartability, or privacy evidence exists for this cycle.

### State and next action

- No remote mutation, package installation, EchoLearn deployment, production AWS/Vercel/Worker/VPS mutation, commit, push, or deploy occurred. Production AWS `3.107.69.57` was not contacted.
- Host lifecycle state: user-reported created; SSH authentication unresolved; no destruction action taken. `USER_MAY_DESTROY_HOST=false` because only the user may authorize destruction.
- Genuine blocker: provide the correct authorized SSH identity and login user for `170.64.184.233` or perform the manual access correction. After access is supplied, run the full one-host Linux/Xvfb checklist in one lifecycle without recreating the prior DigitalOcean VM.
- Local implementation and mock gates remain accepted from prior cycles. This cycle produced no new browser or server evidence.

## 2026-09-04 ECHO-20260904-1152 - mocked browser fallback orchestration

### Scope and implementation

- Added `src/services/browserFallbackOrchestrator.ts`, a local-only controller over `BrowserFallbackAdapter`. It is not imported by `youtubeTranscript.ts`, Worker code, Vercel code, VPS code, or any production route.
- The controller models normal-provider outcome -> pure eligibility decision -> optional browser request -> unified transcript outcome and cache decision. Normal success and definitive semantic/user-controlled failures pass through unchanged in meaning and do not invoke browser or cache.
- Eligible `provider_timeout`, `provider_failure`, `network_failure`, and `upstream_5xx` outcomes can invoke the explicitly enabled isolated controller. Browser success is normalized to the unified transcript shape and is cache-eligible only after adapter validation under the separate `browser-native:v1` namespace.
- Browser timeout/failure/resource/slot/cleanup/invalid/partial/no-caption/player-blocked outcomes remain typed failures. Cancellation, deadline, stale generation, and duplicate same-key requests propagate through the adapter; duplicate requests share one execution and never launch a second browser slot.

### Behavior validation

- Added deterministic controller tests with fakes only, including the sequence `provider_timeout -> browser success -> unified usable transcript/cache decision` and `captions_not_found -> no browser call -> preserved truth`.
- Focused adapter + orchestration Vitest: **54/54 passed**.
- `npx tsc -b --pretty false`: passed.
- Targeted ESLint on the adapter, controller, and two focused test files: passed with no errors.
- `git diff --check`: passed with existing Windows line-ending/config-ignore warnings.
- No real browser, YouTube, target video, broad matrix, Linux/Xvfb, cloud, production, or full application suite was run. Existing transcript production-path tests were not rerun because no live provider boundary was modified.

### Stage decision and evidence boundary

- The local mocked-orchestration stage is **complete**. There is no remaining high-value local-only prerequisite before real-service validation; the next mandatory gate is one future batched separate >=4 GiB Linux/Xvfb host lifecycle.
- That future lifecycle must cover headed semantics, about:blank cleanup/resource checks, two accepted positive controls, media blocking, telemetry, cancellation/timeout, orphan detection, and >=25% memory headroom. Do not recreate the destroyed DigitalOcean VM or use the production AWS host.
- This cycle is local TypeScript/mock evidence only. No host was created or reused, no infrastructure or system package was changed, and no AWS/Vercel/Worker/VPS/production/GitHub state was mutated. No commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1218 - Linux headed/Xvfb pilot and bootstrap-aware M7 diagnostic

### Host and runtime

- SSH access was restored using the established local key path without reading or printing its contents. The supplied host was confirmed as the separate validation VPS `170.64.184.233`, hostname `ubuntu-s-2vcpu-4gb-syd1`; production AWS `3.107.69.57` was not contacted.
- Host baseline: Ubuntu 24.04.4 LTS, Linux 6.8.0-124-generic x86_64, 2 vCPU (`DO-Regular`), `4,106,100,736` total RAM bytes, no swap, and approximately `80 GB` disk. Chromium `152.0.7977.64` from `/snap/bin/chromium`, Xvfb, task-owned Node `22.14.0`/npm `10.9.2`, and `playwright-core 1.62.1` were installed/configured on this host only. System Node `18.19.1`/npm `9.2.0` were left unchanged.
- The runner launched external headed Chromium under Xvfb with no headless flag, a fresh disposable logged-out profile, loopback-only CDP, Playwright `connectOverCDP`, and media/video blocking. No EchoLearn production service was deployed.

### Bootstrap-aware diagnostic result

- The one bounded diagnostic first opened a natural first-party anonymous YouTube guest page in the fresh profile, waited for the bounded bootstrap window, and then navigated to M7 `M7lc1UVf-VE`. Bootstrap completed; the initial cookie count was `0`, the in-memory post-bootstrap count was `9`, and the profile was deleted during cleanup. No cookie values, visitor data, tokens, auth material, headers, request bodies, URLs, or caption text were persisted.
- Bootstrap traffic telemetry was aggregate-only: `131` requests and `3,914,144` encoded bytes; media `10 / 0` bytes and other `121 / 3,914,144` bytes. For the subsequent M7 navigation: `186` requests and `4,439,044` encoded bytes; caption `0 / 0`, media `10 / 0`, other `176 / 4,439,044`.
- M7 remained **`PLAYER_BLOCKED`**, reason **`player status LOGIN_REQUIRED`**; player duration and caption-track count were absent, with `0` timedtext responses, `0` parsed events/segments/usable lines. Latency including bootstrap was `18,160 ms`. This materially distinct bootstrap did not change M7 status or caption capture, so it is recorded as server/egress/video-specific evidence rather than a harness defect. No second positive or mini-matrix was run after this terminal diagnostic.

### Resource, cleanup, and acceptance

- The M7 diagnostic collected `68` valid process-tree samples with `0` sample failures. Peak full Chrome descendant tree: `1,897,988,096` working-set bytes, `809,574,400` private bytes, `13` processes, and `2,200` aggregate CPU ticks. Host memory after the run was `3,436,810,240` available bytes of `4,106,100,736` total (`>25%`); no swap/OOM was observed. The peak working set was below `75%` of host total.
- M7 cleanup passed: disposable profile removed, profile-associated process count `0`, orphan process count `0`. A final read-only host check found no Xvfb/Chromium process or disposable pilot profile. The earlier same-host pilot had already passed three about:blank smokes, a distinct accepted positive with structured captions and media `0`, cancellation cleanup, and restartability; those checks were not repeated after the terminal M7 diagnostic.
- Acceptance: headed/Xvfb semantics **PASS**; valid telemetry/headroom **PASS**; media transfer **0 bytes** **PASS**; bootstrap completion **PASS**; M7 real positive **FAIL** (`LOGIN_REQUIRED`); two-positive gate **NOT ACCEPTED**; bootstrap-aware M7 cleanup **PASS**; server pilot overall **NOT ACCEPTED** because the required M7 positive did not capture structured captions. This is local/isolated validation-host evidence only and makes no production or cost claim.

### Sanitized evidence and state

- Sanitized evidence was written on the validation host and copied locally to `D:\CODE\API\echolearn\evidence\ECHO-20260904-1218-bootstrap`. Manifest SHA-256: `2e38f728596a7dc2f820e3d8305628f44a682423112d383dcb0ed0b83dec8ba5`. Local checksum file SHA-256: `b5435be8a5e81628510d58d74de83b4ec3ec2d69512c089b9cfbe3a8bfc848e0`.
- The validation VPS remains running and was not destroyed. High-value host checks that do not depend on M7 are complete; the required real-service gate is terminally unaccepted for this bounded bootstrap axis. No further same-host identity/flag tuning or yt-dlp/session-token experiment is justified without a new explicit decision. `HOST_MAY_BE_DESTROYED=false` for Codex; user-only lifecycle decision remains pending.
- Local repo remained on `main`, `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`, matching `origin/main`. Existing unrelated dirty/untracked work was preserved. No commit, push, deploy, production integration, AWS/Vercel/Worker/VPS production mutation, or paid infrastructure action occurred.

## 2026-09-04 ECHO-20260904-1258 - different-egress/service-class decision research

### Checkpoint and scope

- Re-anchored the repository at branch `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; existing dirty and untracked work was preserved. Read the current browser fallback contract/orchestrator, production client cascade, Vercel/Worker/VPS boundaries, and current progress/report/decision/journal entries.
- No YouTube request, vendor account, proxy purchase, infrastructure creation, production request, deployment, commit, or push occurred in this cycle. This is architecture research, not provider success evidence.

### Evidence synthesis

- The strongest causal signal remains: local residential headed Chrome captured M7 captions, while the separate Linux datacenter VPS remained `LOGIN_REQUIRED` even after natural anonymous guest bootstrap. Public project evidence is consistent but not quantitative: the `youtube-transcript-api` README says cloud-provider IPs are commonly blocked and recommends rotating residential proxies, but warns that proxies do not guarantee success. Its open [POST-429 rotation issue](https://github.com/jdepoix/youtube-transcript-api/issues/612), [residential-proxy failure report](https://github.com/jdepoix/youtube-transcript-api/issues/421), and [PoToken-required report](https://github.com/jdepoix/youtube-transcript-api/issues/592) show that a residential label or IP rotation does not prove reliable caption access. No audited cross-provider success rate for M7 was found.
- YouTube's current [Terms of Service](https://uk.youtube.com/t/terms) restrict automated access except for stated exceptions such as prior written permission or applicable law. The official [Captions API](https://developers.google.com/youtube/v3/docs/captions/list) requires OAuth scopes and is designed around authorized caption resources; it is not a general anonymous transcript API for arbitrary public videos. Legal/compliance review is therefore a release prerequisite for every unofficial browser/proxy/vendor path.

### Bounded category comparison

| Category | M7-recovery evidence | Fit with current browser path | Main risks | Decision |
|---|---|---|---|---|
| Dedicated browser service + permitted rotating residential/ISP egress | Directionally strongest: changes the observed datacenter variable, but no public M7 rate and residential failures are documented | Highest. Reuses headed Chrome, guest bootstrap, CDP, request interception, structured timedtext parsing, and media blocking. Keep one stable exit for the session; rotate only between independent jobs | Proxy/AUP/ToS approval, variable IP reputation, bandwidth billing, own browser operations, no guarantee against player or video restrictions | **First validation candidate** |
| Managed remote browser/BaaS | Browserbase and Browserless document CDP/Playwright and proxy support, but neither supplies audited M7 caption results | Technically plausible; route interception can remain in the Playwright session, but provider telemetry and retention must be verified | Browserbase documents proxy restrictions including streaming; BaaS may retain sessions/replays; vendor egress and target-policy coupling; browser-time + proxy-byte billing | **Conditional second choice** |
| Transcript/caption vendor/API | API docs expose native-vs-generated modes and simple per-request/credit models, but public claims are vendor evidence, not M7 proof | Lowest implementation/ops burden; native-only mode could preserve caption semantics if enforced | Opaque upstream/egress, cannot independently prove `media=0`, possible hidden ASR fallback, video-ID/request retention, vendor ToS and availability dependency | **Conditional third choice; not ready** |

### Current pricing/traffic model (no purchase or cost forecast)

- Proxy category is generally bandwidth-priced with possible monthly minimums: current official examples show [Webshare rotating residential](https://www.webshare.io/residential-proxy) at 10 GB for `$27.50` and 25 GB for `$65`, and [Decodo residential](https://decodo.com/proxies/residential-proxies/pricing) at 3 GB for `$3.75/GB` and 10 GB for `$3.50/GB` plus VAT. These are observed list prices only, not an EchoLearn cost estimate.
- BaaS adds session time and proxy traffic: [Browserbase pricing](https://www.browserbase.com/pricing) lists a `$20/month` Developer tier with 100 browser hours and 1 GB proxy allowance, with overages; [Browserless pricing and unit docs](https://www.browserless.io/pricing) meter browser time in 30-second units and residential traffic at 6 units/MB. Browserbase also documents proxy restrictions that include streaming, while Browserless documents residential/external proxies and a Google/YouTube-oriented proxy preset. These pages do not establish caption success.
- Transcript vendors are request/credit-priced: [Supadata](https://supadata.ai/pricing) lists 100 free credits, 300 for `$5`, and 3,000 for `$17`, with one native transcript costing one credit and generated transcript minutes costing more; [YouTubeTranscript.dev](https://www.youtubetranscript.dev/pricing) lists 1,200 credits for `$9` and 4,000 for `$29`; [TranscriptAPI](https://transcriptapi.com/) lists `$5/month` for 1,000 credits and one credit per successful request. TranscriptAPI's [privacy policy](https://transcriptapi.com/privacy/) states that requested video IDs, request parameters, performance/usage data, and error logs may be collected, with usage logs retained up to one year. No vendor was contacted or used.

### Decision and minimum next experiment

- **Recommended:** keep the existing option-A dedicated single-concurrency browser fallback, but test only a contract-permitted rotating residential/ISP egress class next. Use a sticky exit for the natural bootstrap plus watch session, fresh logged-out profile, no imported cookies, no CAPTCHA/login automation, and the existing media block. This offers the best observability and the clearest way to verify browser-native `media=0`; it remains a hypothesis, not a production guarantee.
- **Backup:** a managed BaaS provider only after written confirmation that the target/use case is allowed, the exact egress can be selected, streaming restrictions do not apply, session/replay retention can be disabled or bounded, and raw CDP/network interception plus media blocking work. A transcript vendor is acceptable only after native-only behavior, no audio/ASR fallback, error mapping, retention, and M7 capability are contractually demonstrated.
- **Do not recommend now:** browser-first acquisition, static/datacenter proxy rotation, Bright Data residential for this use case while its [AUP](https://brightdata.com/acceptable-use-policy) prohibits streaming-related domains, or any vendor whose success claim cannot be tied to a controlled M7 probe.
- Minimum future experiment, not run here: one new egress class and one fresh bootstrap-aware M7 request; no retry. Require player `OK`, caption track present, non-empty structured timedtext, media encoded bytes `0`, aggregate request/network telemetry, resource/headroom and deterministic cleanup. Only if M7 succeeds, run one distinct already-accepted positive; require both positives before any isolated service integration. If M7 remains blocked, stop and classify the result without changing identity, flags, cookies, tokens, or yt-dlp behavior.

### Evidence boundary and state

- This cycle supplies current public documentation/project-issue evidence and a product decision only. It does not establish any provider's M7 success rate, YouTube permission, production reliability, pricing for EchoLearn, or media-byte behavior. Existing real Linux M7 evidence remains the strongest server-side observation: `LOGIN_REQUIRED` after natural bootstrap.
- Browser fallback remains disabled and unreferenced by production call sites. The validation VPS remains running and unchanged since the prior pilot; production AWS/Vercel/Worker/VPS production state was untouched. No commit, push, deploy, vendor account, or infrastructure mutation occurred.

## 2026-09-04 ECHO-20260904-1326 - residential egress pre-purchase readiness

### Scope and checkpoint

- Re-anchored the local repository at branch `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; all pre-existing dirty and untracked work was preserved. Read the active D-009 decision, current progress/report/journal entries, the disabled browser fallback contract/orchestrator, the production caption cascade boundaries, and the Linux headed/CDP pilot.
- This cycle did not contact `170.64.184.233`, create or mutate infrastructure, send proxy or YouTube traffic, access production, create an account, purchase a plan, or handle provider credentials. The prior DigitalOcean VM remains correctly destroyed and was not recreated.

### Current external evidence and candidate screen

- YouTube's [Terms of Service](https://uk.youtube.com/t/terms) restrict automated access except for stated exceptions such as written permission or applicable law, and the official [Captions API](https://developers.google.com/youtube/v3/docs/captions/list) is designed around authorized caption resources. Every unofficial browser/proxy path therefore requires a separate legal/compliance decision; a proxy vendor's AUP cannot grant YouTube permission.
- The project-level signal remains directional: the [`youtube-transcript-api` README](https://github.com/jdepoix/youtube-transcript-api) describes cloud-provider blocking and recommends rotating residential proxies, while its open [POST-429 rotation issue](https://github.com/jdepoix/youtube-transcript-api/issues/612), [residential failure report](https://github.com/jdepoix/youtube-transcript-api/issues/421), and [PoToken issue](https://github.com/jdepoix/youtube-transcript-api/issues/592) show that a residential label or rotation is not an M7 success guarantee. No audited provider-by-provider M7 success rate was found.
- **Preferred candidate - IPRoyal rotating residential:** its current [AUP](https://iproyal.com/acceptable-use-policy/) prohibits unlawful/unauthorized, rights-infringing, protected/non-public, excessive, or abusive use but the reviewed public AUP did not name streaming as an explicit residential prohibition. Its official [residential documentation](https://docs.iproyal.com/proxies/residential) lists HTTP(S)/SOCKS5, 195+ country coverage, rotation or sticky sessions up to 7 days, username/password or IP allowlisting, and pay-as-you-go traffic; the current [pricing page](https://iproyal.com/pricing/residential-proxies/) shows a 1 GB entry at `$7/GB` (list price observed, not an EchoLearn cost estimate). The [high-end pool documentation](https://docs.iproyal.com/proxies/residential/proxy/high-end-pool) uses a `_streaming-1` configuration, but that label is not written permission for this use case. IPRoyal's [privacy policy](https://iproyal.com/privacy/) describes collection of account/system and traffic-related log data, so retention, target-domain visibility, and a suitable DPA must be confirmed before use.
- **Backup - Decodo rotating residential:** its official [restricted-target documentation](https://help.decodo.com/docs/residential-proxy-restricted-targets) and [FAQ](https://decodo.com/faq/general/do-you-have-any-blocked-sites) explicitly classify streaming as restricted; the FAQ says it may be unblocked after ID verification for rotating residential and not static residential/ISP. Its [quick start](https://help.decodo.com/docs/residential-proxy-quick-start) provides HTTP/HTTPS/SOCKS5 and sticky sessions up to 24 hours; its [pricing](https://decodo.com/proxies/residential-proxies/pricing) shows 3 GB at `$3.75/GB` and 10 GB at `$3.50/GB` plus VAT, with a 3-day trial described in the public FAQ. It is usable for a future probe only after explicit written approval for YouTube caption-only browser access and confirmation of retention/logging.
- **Additional conditional alternative - Webshare rotating residential:** current [restricted-target guidance](https://help.webshare.io/en/articles/10068143-restricted-websites-on-our-rotating-residential-proxy-network) explicitly lists streaming platforms and directs the customer to compliance; its [endpoint generator](https://help.webshare.io/en/articles/16310718-endpoint-generator-rotating-residential) supports HTTP/SOCKS5, country/ASN targeting, and sticky sessions from 1 minute to 24 hours. Its current [pricing](https://www.webshare.io/residential-proxy) lists 10 GB at `$27.50` and 25 GB at `$65`. It is not preferred without written approval. Oxylabs was screened out on the same basis because its official [restricted-target documentation](https://developers.oxylabs.io/proxies/residential-proxies/restricted-targets) also lists entertainment/streaming and requires customer-success confirmation.
- Candidate status is therefore: IPRoyal **best public-policy fit but still written-confirmation required**; Decodo **backup after restricted-target approval/KYC**; Webshare **additional fallback after compliance approval**; Bright Data **excluded** while its [AUP](https://brightdata.com/acceptable-use-policy) prohibits streaming-related domains. None supplies audited M7 caption evidence in the reviewed material.

### Local harness proxy readiness

- Added `scripts/local-native-youtube/proxy-config.mjs` and `proxy-config.test.mjs`. `linux-pilot.mjs` now reads proxy settings only from environment, adds only the credential-free endpoint to Chromium's `--proxy-server` argument, removes proxy username/password from the Chromium child environment, and handles only proxy auth challenges through the CDP Fetch domain. Non-proxy auth challenges are cancelled. The evidence payload records only `{ configured, protocol, authConfigured }`; it never records endpoint, username, password, headers, cookies, tokens, raw URLs, or caption text.
- Supported input is an explicit `http://`, `https://`, or unauthenticated `socks5://` endpoint with host and port. Credentials embedded in the endpoint, partial credentials, line breaks, unsupported protocols, and authenticated SOCKS5 are rejected with fixed diagnostic codes. Authenticated SOCKS5 is intentionally not claimed because this external-Chrome seam has no secure credential channel for it; use HTTP(S) for the future pilot unless a separately reviewed mechanism is added.
- The existing headed/Xvfb launch, loopback CDP, fresh logged-out profile, media/video interception, Network encoded-byte telemetry, process-tree telemetry, cleanup, and production-disabled architecture remain intact. No production call site imports or invokes this runner or its proxy helper.

### Minimum user input and one future run shape

- User/provider must supply only: provider and product tier; written permission/approval for this YouTube automated browser/caption-only use; a provider-generated endpoint without embedded credentials; username/password through a secret channel (or an approved IP allowlist); selected country/region/ASN; sticky-session identifier/TTL semantics; and retention/logging/DPA confirmation. Do not supply a private key, YouTube login, cookies, visitor data, PoToken, or audio/ASR permission.
- The exact Linux command shape is below. The secret file is an operator-provided protected file and the values shown are placeholders only; do not paste real credentials into chat, logs, evidence, Git, or shell history:

```sh
set -a
. /run/secrets/echolearn-proxy.env
set +a
ECHOLEARN_BOOTSTRAP_M7_ONLY=1 \
ECHOLEARN_PILOT_EVIDENCE=/root/echolearn-pilot/evidence/ECHO-20260904-egress-m7 \
node scripts/local-native-youtube/linux-pilot.mjs
```

The protected env file has this shape, with no real values in this report:

```dotenv
ECHOLEARN_PROXY_SERVER=http://proxy.example.invalid:PORT
ECHOLEARN_PROXY_USERNAME=PROVIDER_USERNAME
ECHOLEARN_PROXY_PASSWORD=PROVIDER_PASSWORD
```

The runner's current `ECHOLEARN_BOOTSTRAP_M7_ONLY=1` path performs exactly one natural guest-bootstrap-aware M7 attempt. If and only if it returns player `OK`, a caption track, non-empty structured timedtext, media encoded bytes `0`, valid resource/headroom telemetry, and deterministic cleanup, run one distinct accepted positive in a separate fresh profile. No retry, matrix, or provider rotation is authorized by this pre-purchase decision.

### Decision and evidence boundary

- **Recommended:** proceed only to one user-approved IPRoyal rotating-residential capability probe, using a sticky exit for the natural bootstrap plus watch session and the current browser-native media-blocked harness. This is the smallest experiment that changes the observed datacenter egress variable while preserving browser semantics and measurable `media=0`.
- **Backup:** Decodo rotating residential after written streaming-target approval/KYC; Webshare after equivalent compliance approval. Managed browser/transcript vendors remain conditional alternatives requiring separate native-only, retention, media, and M7 capability evidence.
- **Not recommended:** browser-first routing, static/datacenter rotation, Bright Data for this use case, login/cookie/PoToken/yt-dlp tuning, or any provider whose policy or retention is unclear.
- This cycle establishes **local harness readiness only**. Provider credentials, real proxy connectivity, M7 recovery, actual cost/traffic, YouTube permission, production reliability, and production integration remain unverified. Production remains unchanged.

### Validation actually run

- Passed local-only validation after the proxy seam: focused Vitest for caption parser, network telemetry, and proxy config (**25/25**); `node --check` for the runner and helper; targeted ESLint for the runner/helper/test; `npx tsc -b --pretty false`; `git diff --check`; and static `rg` search confirming the proxy helper/runner are confined to the local pilot directory and no production call site references them. No full app suite, live provider test, VPS/SSH check, or YouTube request was run.

## 2026-09-04 ECHO-20260904-1438 - local Proxy-Cheap prerequisite hardening

### Scope and implementation

- Local-only changes hardened `scripts/local-native-youtube/linux-pilot.mjs` without contacting the validation VPS or any provider. New `pilot-contract.mjs` and deterministic tests define the allowlisted `full`, `m7-only`, and `distinct-positive-only` modes, exact sanitized M7 manifest/hash prerequisite, fail-if-present evidence claim, one global deadline, unprivileged sandbox policy, observed-PID ownership, bootstrap/watch semantics, strict M7/positive acceptance, and privacy-safe salted coarse proxy-exit proof validation.
- The runner now has explicit CDP phase transitions: ending bootstrap drops late events and disables Network, then a separate `Network.enable` is awaited before the M7 epoch begins. Timedtext response state is epoch-separated as well. The runner loads one `before` observation before the job, loads a separate `after` observation only after M7 capture/cleanup, and binds them by checkpoint time; a precomputed pair or an after timestamp before M7 fails closed. No IP-check request was made.
- Evidence output is unique/fail-if-present with a default under unprivileged `os.tmpdir()`. Proxy credentials are removed from Chromium and Xvfb child environments, including standard proxy variable names. Root/`--no-sandbox` is an explicit non-eligible compatibility path; the intended gate requires an unprivileged user with Chromium sandbox enabled. Process cleanup retains initially and subsequently observed descendants to cover reparented children.
- `browserTranscriptFallback.ts` now rejects success without native-caption/no-ASR, player/track/language, structured timedtext, non-partial, zero-media, zero-malformed, and cleanup-success truth. Known-track empty responses map to `provider_failure`, cache eligibility requires the same validated diagnostics, orchestration failures retain `upstreamCode`, and request-scope generations protect cross-video late results. The seam remains disabled and unreferenced by live production paths.

### Deterministic validation

- `npx vitest run --config scripts/local-native-youtube/vitest.config.mjs`: **38/38 passed** across 4 files.
- `npx vitest run src/services/__tests__/browserTranscriptFallback.test.ts src/services/__tests__/browserFallbackOrchestrator.test.ts`: **57/57 passed**.
- `node --check` passed for `linux-pilot.mjs`, `pilot-contract.mjs`, and `telemetry.mjs`; `npx tsc -b --pretty false` passed; targeted ESLint for changed harness/service files passed with no errors; `git diff --check` passed with existing line-ending/config-ignore warnings.
- Static production-reference search found only the isolated fallback module/tests and local pilot assets; no live YouTube, Worker, Vercel, VPS, or application acquisition call site invokes the new seam.

### Readiness and evidence boundary

- This local prerequisite gate is **READY for one bounded real Proxy-Cheap M7 capability probe**, subject to provider written-use/policy confirmation and user-supplied credentials through a secret channel. It is **NOT** production-integration approval and does not prove residential-class reliability; egress remains a hypothesis and a future one-exit result is only a capability result.
- No proxy credentials, provider account, purchase, proxy request, YouTube request, SSH/VPS action, infrastructure mutation, production mutation, commit, push, or deploy occurred in this cycle. The prior validation VPS `170.64.184.233` was not contacted this cycle; production AWS/Vercel/Worker remain unchanged. The future real run must use distinct before/after checkpoint files and stop unless strict M7 passes.

## 2026-09-04 ECHO-20260904-1514 - Proxy-Cheap capability gate access checkpoint

### Scope and host preflight

- Re-anchored local `main`: `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; existing dirty and untracked work was preserved and no files were staged. No reset, clean, stash, commit, push, deploy, or production mutation occurred.
- Read-only SSH to the separate validation VPS `170.64.184.233` succeeded as root. Baseline: Ubuntu 24.04.4, kernel `6.8.0-124-generic`, 2 vCPU, total RAM `4,106,100,736` bytes, available RAM `3,587,674,112` bytes, swap `0`, root disk total `82,086,711,296` bytes with `77,488,017,408` bytes available; Chromium `/snap/bin/chromium` `152.0.7977.64`, Xvfb `/usr/bin/Xvfb`, Node `18.19.1`, npm `9.2.0`. The host is the validation VPS, not production AWS `3.107.69.57`.
- A safe local source-name audit found no `ECHOLEARN_PROXY_SERVER`, `ECHOLEARN_PROXY_USERNAME`, `ECHOLEARN_PROXY_PASSWORD`, or Proxy-Cheap credential source. The only matching configured application key was `.env.production` `VITE_YOUTUBE_PROXY`; its code contract is an existing application proxy base URL, not Proxy-Cheap credentials, so it was not used.

### Gate result

- M7: **NOT RUN (0 attempts)** because the required Proxy-Cheap credentials were unavailable. Distinct positive: **NOT RUN (0 attempts)** and remained correctly mode/manifest gated. No proxy or YouTube request was sent.
- Because no browser job ran, this cycle has no new latency, Node RSS, Chrome-tree working-set/private/process, host headroom-at-peak, encoded-network-category, media-zero, cleanup/orphan, cancellation, or restartability measurements. The earlier local/Linux direct-egress evidence remains historical and is not relabeled as Proxy-Cheap evidence.
- No packages/runtime/configuration were installed or changed on the VPS. No evidence directory or raw/secret data was created. The host remains running and was not destroyed; Codex advises `HOST_MAY_BE_DESTROYED=false` until the user resolves credentials and completes the bounded gate.

### Next gate

After policy-approved secret-channel credential delivery and a safe temporal observation mechanism, reuse this same VPS for one fresh `m7-only` run: load `before` before guest bootstrap/M7, obtain/load `after` only after M7 acquisition and cleanup, require strict M7 acceptance plus stable residential/ISP proof, media encoded bytes `0`, resource headroom, cleanup, and privacy. Only if that passes may the exact manifest/hash-gated distinct-positive run occur. Production browser fallback remains unapproved.

## ECHO-20260904-1617 - ScrapingBee dedicated YouTube subtitles bounded capability gate

### Scope and result

- Inspected the existing `cf-worker/src/scrapingbeeYoutubeSubtitles.js`, its declaration, deterministic test file, and local evaluator. The adapter uses only ScrapingBee's dedicated YouTube Subtitles endpoint class with Bearer auth and `video_id`; no HTML scraping API, proxy, residential egress, VPS, deployment, account creation, or account mutation was used.
- Safe presence-only inspection of existing project env/config files and process/user/machine environment scopes found no non-empty ScrapingBee/SCRAPE_API_KEY-style credential. Per the stop rule, the official API was not called.
- Candidate decision: **INCONCLUSIVE**, not provider NO-GO. M7 `M7lc1UVf-VE` requested English: **NOT RUN, 0 attempts**. Conditional hard target `YweN5PUyGgc`: **NOT RUN, 0 attempts**. Exact real requests: **0**. Approximate credits at 5 credits/request: **0**.

### Evidence boundary

- No current-cycle HTTP status, structural timestamped-segment count, latency, compatible-language result, or no-subtitles/unavailable distinction was produced. No transcript text, raw response body, credential, cookie, or secret was printed, logged, persisted, or added to evidence.
- The existing adapter had no clearly demonstrated local schema bug that required a bounded change before the official request; no code change was made. DigitalOcean `170.64.184.233` is not needed for this direct managed-provider validation path.

### Deterministic validation actually run

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **12/12 passed**.
- Targeted ESLint for the adapter, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed; output contained only the repository's existing LF/CRLF conversion warnings.
- No live provider request, broad suite, browser verification, VPS/SSH action, production check, commit, or push was performed.

### Next step

Resolve the exact missing-credential blocker through an already-existing authorized ScrapingBee account/key and a protected process-environment injection. Then run exactly one bounded English M7 request; run the hard target only if M7 strictly succeeds.

## ECHO-20260904-1617 - ScrapingBee dedicated YouTube subtitles real-provider result

### Bounded real-provider result

- The protected local secret file was validated as a non-empty single-line credential and injected only into the child process environment. It was not printed, echoed, hashed, persisted, modified, or included in any command argument, log, evidence, or documentation.
- Using only the existing dedicated adapter/evaluator path, exactly one official `/api/v1/youtube/subtitles` request was made for M7 `M7lc1UVf-VE`, requested language `en`, with the existing Bearer-auth path and approximately 12-second timeout. Sanitized result: status class **`4xx`**, typed outcome **`provider_failure`**, latency **2,228 ms**, structural timestamped segments **0**, non-empty timestamped segments **0**, returned language **`none`**, requested/returned language compatible **false**.
- M7 failed the strict acceptance gate. The exact status code was intentionally not retained; the non-2xx result was sufficient to stop. `YweN5PUyGgc` was correctly gated and not requested.
- Exact live requests: **1**. Approximate credits at 5 credits/request: **5**. Candidate decision: **NO-GO for this configured credential/provider check**. No retry, key rotation, account change, proxy, browser, VPS, DigitalOcean, production, deployment, commit, or push action occurred.

### Code and evidence boundary

- No local adapter schema bug was exposed: the live response was non-2xx, so no official response body was accepted for parsing. No code or deterministic test changes were needed.
- No raw response/body, transcript text, API key, cookies, or unrelated secret was printed, logged, persisted, or included in the report. DigitalOcean `170.64.184.233` is not needed for this direct managed-provider path.

### Deterministic validation after the live attempt

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **12/12 passed**.
- Targeted ESLint for the adapter, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed with the repository's existing LF/CRLF conversion warnings only.

### Terminal state

The approved bounded sequence is terminal for this checkpoint: M7 failed with a 4xx/provider failure and the hard target remained locked. Do not retry or rotate credentials under this task; any future account/provider diagnosis requires separate authorization.

## ECHO-20260904-1638 - DigitalOcean validation VPS lifecycle update

- The user explicitly confirmed destruction of DigitalOcean validation VPS `170.64.184.233`. No connection, recovery, recreation, or validation action against that VPS is permitted in this diagnosis cycle.

## ECHO-20260904-1638 - ScrapingBee bounded account/API diagnosis

### Lifecycle and usage diagnosis

- The user confirmed that DigitalOcean validation VPS `170.64.184.233` was destroyed. It was not contacted, recovered, recreated, or used.
- The protected credential was read only from the specified local secret file and injected into a child process environment. It was not printed, persisted, hashed, modified, or placed in command arguments.
- Exactly one official `GET /api/v1/usage` health check ran. Sanitized result: status `200`, status class `2xx`, auth classification `accepted_2xx`, `maxConcurrency=5`, `currentConcurrency=0`. Credit and renewal values were not retained by the one-shot safe extractor, so the required 5-credit minimum could not be established without violating the one-call budget.
- No YouTube request ran in this task. `rfscVS0vtbw` sample and M7 `M7lc1UVf-VE` without `language` were both gated. Exact YouTube requests: **0**; approximate YouTube credits: **0**. The prior task's M7 4xx therefore cannot be narrowed to 404 versus auth/access from this cycle.

### Bounded adapter correction

- The existing adapter previously mapped every non-2xx response to `provider_failure`. It now maps 401/403 to typed `auth_failure`, 404 to neutral typed `not_found` because the response cannot distinguish requested-language miss from target-level absence, and retains sanitized numeric HTTP status. Other non-2xx behavior remains provider failure; no production integration was added.
- Added deterministic coverage for 401, 403, and 404 mappings and response-body non-exposure. No live response body was persisted or used for the correction.
- Diagnosis result: **INCONCLUSIVE**. Usage authentication is accepted and concurrency is available, but subtitle endpoint entitlement/request semantics and credit sufficiency remain unverified.

### Validation actually run

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **13/13 passed**.
- Targeted ESLint for the adapter, declaration, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed with existing LF/CRLF conversion warnings only.
- No sample/M7 request, browser/VPS action, production action, deployment, commit, push, vendor contact, plan purchase, or key rotation occurred.

### Root-cause boundary

The current evidence rules out an immediately rejected API key at `/usage` and current concurrency exhaustion. It does not establish remaining credits or whether the previous subtitles 4xx was the documented 404 language/availability result, so no provider capability conclusion is claimed.

## ECHO-20260904-1658 - Corrected ScrapingBee usage gate result

### Corrected usage check

- Before any real network call, the local-only usage helper was corrected to accept only finite numbers or canonical numeric strings, reject null/empty/whitespace/boolean/coercible invalid values, and return `null` for non-finite or negative computed remaining credits. Deterministic coverage was added.
- Exactly one non-billable official `GET /api/v1/usage` request ran with Bearer auth. Sanitized result: HTTP **200**, status class **`2xx`**, auth classification **`accepted_2xx`**, `max_api_credit=1000`, `used_api_credit=1010`, computed remaining **`null`** because used exceeded max, `max_concurrency=5`, `current_concurrency=0`, renewal date `2026-08-13T10:07:58.149206`.
- The key is accepted and concurrency is available, but the account balance is exhausted/overdrawn. The required `>=5` credit gate failed closed. The docs sample `rfscVS0vtbw` and M7 `M7lc1UVf-VE` without a language parameter were not requested.
- Exact billable YouTube requests: **0**. Approximate YouTube credits: **0**. Root-cause classification: **account credit exhaustion/overdraw**, not usage authentication or concurrency failure. The prior subtitles 4xx was not re-run and cannot be independently identified as 404 versus auth/access in this cycle.

### Code and validation

- Added local-only `scrapingbeeUsage.js`, declaration, evaluator, and focused tests. Updated the subtitle evaluator/adapter seam to support one explicit no-language request if a future credit-authorized run is separately approved. No production call site was changed.
- Focused Vitest for usage and subtitles: **19/19 passed**. Targeted ESLint passed, `npx tsc -b --pretty false` passed, and `git diff --check` passed with existing LF/CRLF warnings only.
- No sample/M7 request, proxy/browser/VPS action, production mutation, deployment, purchase/upgrade, vendor contact, key rotation, commit, or push occurred. DigitalOcean `170.64.184.233` remains destroyed and unused.

### Terminal diagnosis

ScrapingBee is **NO-GO for the current account until credits are replenished**. This is an account-balance gate, not sufficient evidence of subtitle endpoint capability; no provider plan change or account mutation was authorized.

## 2026-09-04 ECHO-20260904-1723 - Generic Linux browser runtime gate

### Host mutation and runtime

- On disposable validation VPS `134.199.155.9` only, installed Xvfb `2:21.1.12-1ubuntu1.6`, Node `v22.23.2`, npm/npx `10.9.8`, Chromium snap `152.0.7977.64`, and standalone Google Chrome `152.0.7977.82`; created unprivileged user `echolearnpilot` UID `1000`. No production/AWS/Vercel/Worker host was contacted.
- The Chromium snap wrapper exited under the non-interactive root-to-user launch with a snap cgroup error. This was diagnosed from temporary stderr and no residue remained. Standalone Google Chrome was used for the bounded generic smoke; no `--no-sandbox` flag was passed.

### Generic smoke evidence

- Two fresh disposable-profile cycles passed under Xvfb with headed Chrome semantics and loopback CDP. Both reported `about:blank` and `example.com` targets, removed the profile, and ended with zero task-owned Chromium/Xvfb/Node orphans.
- Cycle 1: 3 resource samples; peak Chrome-tree RSS-style working-set estimate `1,472,102,400` bytes, private bytes `275,099,648`, 17 processes. Cycle 2: 3 samples; peak working-set `1,495,740,416` bytes, private bytes `296,505,344`, 17 processes. Post-run host memory was approximately 3.3 GiB available of 3.8 GiB total, with 0 swap; root disk had approximately 72 GiB free.
- Final generic result: **PASS** for Xvfb start, unprivileged headed Chrome launch, CDP reachability, `about:blank`, `example.com`, cleanup, and restartability. Network request/category telemetry was not collected because this was a generic browser-only smoke, not the caption harness.

### Boundary and lifecycle

- No YouTube, transcript-provider, Proxy-Cheap, residential-proxy, cookie, login, token, ASR, audio, production, or AWS/Vercel/Worker request occurred. The intended direct-vs-residential YouTube experiment remains unexecuted; this generic result does not establish M7 capability or production readiness.
- Host remains running and was not destroyed. Infrastructure-only work is complete; recommendation: `HOST_MAY_BE_DESTROYED=true`, subject to the user's lifecycle decision. No local code changed; only durable project logs were updated. No commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1723 - Direct-vs-residential M7 host gate access blocker

### Preflight and access

- Local repository re-anchor: `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, existing dirty/untracked work preserved, no staged changes. No reset, clean, stash, commit, push, deploy, or production mutation occurred.
- New isolated validation VPS `134.199.155.9` was contacted only through the established SSH identity path. Both `root` and `ubuntu` failed with `Permission denied (publickey)`. No remote command ran after authentication failure; no baseline, package installation, runtime setup, upload, or host mutation was performed. Production AWS `3.107.69.57` was not contacted.
- The required local secret file `D:/CODE/API/echolearn/proxy-cheap-runtime.txt` was checked only for existence/size and was **absent**. No credential value was read, printed, hashed, included in a command line, or persisted.

### Gate result

- Direct M7: **NOT RUN (0 attempts)**; SSH access failed before setup. Proxy M7: **NOT RUN (0 attempts)**. Conditional distinct positive: **NOT RUN (0 attempts)**. No proxy/YouTube traffic was sent.
- No host resource, browser process-tree, encoded-network, media-zero, cleanup/orphan, restartability, or exit-proof measurements were collected for `134.199.155.9`. No M7 or egress conclusion is claimed.
- Validation run this cycle: local read-only git re-anchor/status, secret-file presence/size check, and two bounded SSH connectivity attempts. No focused tests were rerun because no code changed and the host gate was blocked. The existing local harness/service tests remain historical checkpoint evidence only.

### Lifecycle and next gate

- Host lifecycle: newly created/reused for this task, still running, not destroyed by Codex. Recommendation: `HOST_MAY_BE_DESTROYED=false` until access is repaired and the bounded comparison is completed.
- Next action requires the user to authorize the established key for `root` or `ubuntu` and make the already-configured runtime secret file available through the secret channel. Then use only this VPS for one direct M7 control followed by at most one Proxy-Cheap M7; no retry or conditional positive unless strict proxy M7 passes. Production integration remains unapproved.

## 2026-09-04 ECHO-20260904-1723 - Infrastructure continuation terminal closure

The preceding access-blocker section is retained as historical evidence from before SSH authorization was fixed. The continuation installed and validated the generic browser runtime on `134.199.155.9`; no YouTube, proxy, provider, or production request was made. Generic infrastructure work is complete, the host remains running and was not destroyed, and the current recommendation is `HOST_MAY_BE_DESTROYED=true`; the intended direct-vs-residential M7 experiment remains unexecuted.

## 2026-09-04 ECHO-20260904-2044 - Cycle 1 worktree hygiene and cache-aware measurement foundation

### Strategy baseline and repository anchor

- This cycle follows the completed Sol+xhigh strategic review. The review findings were independently checked against the current local source before any change: the local dirty set mixes production-sensitive Worker/VPS changes with operational checks, browser experiments, ScrapingBee experiments, and journals; the VPS hostname source fix is already present; the Worker cache marker exists but was not exposed through CORS; and the accepted 7/7 production evidence did not prove per-request cold `MISS`/`HIT` state.
- Local anchor verified before edits: branch `main`; `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`; `origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; ahead/behind `0/0`; no staged changes. The final review also confirmed the branch/HEAD remained unchanged.
- No live YouTube, provider, browser, SSH, network, production, Worker, Vercel, or VPS test ran. No package was installed; no infrastructure, account, spend, deployment, commit, push, reset, clean, stash, checkout-discard, move, or deletion occurred.

### Exact current dirty-file grouping and recommended disposition

The following is the complete non-ignored `git status --short --untracked-files=all` grouping at handoff. Existing files were preserved in place; the dispositions are review/commit-boundary recommendations only.

| Group | Exact files | Recommended disposition |
|---|---|---|
| Production-sensitive Worker | `cf-worker/src/index.js`; `src/services/__tests__/cfWorkerTranscript.test.ts` | Review as a narrow coordinated Worker source/test candidate. Keep separate from the VPS/browser/ScrapingBee experiments; do not deploy from this dirty set. |
| Production/security-sensitive VPS | `vps-ytdlp/main.py`; `vps-ytdlp/test_main.py` | Review as a separate VPS/security candidate. The exact-host source fix is locally confirmed and regression coverage was added; deployment and exploitability remain **UNKNOWN**. |
| Operational/health-check | `scripts/health-check.mjs`; `src/services/__tests__/healthCheck.test.ts` | Keep as monitoring-only work. Health success now reports cache/acquisition observability; fixed controls are not cold-acquisition proof. Live schedule/endpoint behavior remains deferred. |
| Browser experiment | `scripts/local-native-youtube/caption-parser.mjs`; `scripts/local-native-youtube/caption-parser.test.mjs`; `scripts/local-native-youtube/diagnose-external-chrome.mjs`; `scripts/local-native-youtube/diagnose-m7.mjs`; `scripts/local-native-youtube/linux-pilot.mjs`; `scripts/local-native-youtube/pilot-contract.mjs`; `scripts/local-native-youtube/pilot-contract.test.mjs`; `scripts/local-native-youtube/proxy-config.mjs`; `scripts/local-native-youtube/proxy-config.test.mjs`; `scripts/local-native-youtube/run-headed-matrix.mjs`; `scripts/local-native-youtube/telemetry.mjs`; `scripts/local-native-youtube/telemetry.test.mjs`; `scripts/local-native-youtube/vitest.config.mjs`; `src/services/browserFallbackOrchestrator.ts`; `src/services/__tests__/browserFallbackOrchestrator.test.ts`; `src/services/browserTranscriptFallback.ts`; `src/services/__tests__/browserTranscriptFallback.test.ts` | Keep paused/archive-only and unintegrated. Do not move, delete, or fold into the production acquisition cascade in this cycle. |
| ScrapingBee experiment | `cf-worker/src/scrapingbeeUsage.d.ts`; `cf-worker/src/scrapingbeeUsage.js`; `cf-worker/src/scrapingbeeYoutubeMatrix.d.ts`; `cf-worker/src/scrapingbeeYoutubeMatrix.js`; `cf-worker/src/scrapingbeeYoutubeSubtitles.d.ts`; `cf-worker/src/scrapingbeeYoutubeSubtitles.js`; `scripts/eval-scrapingbee-usage.mjs`; `scripts/eval-scrapingbee-youtube-matrix.mjs`; `scripts/eval-scrapingbee-youtube.mjs`; `src/services/__tests__/scrapingbeeUsage.test.ts`; `src/services/__tests__/scrapingbeeYoutubeMatrix.test.ts`; `src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts` | Keep paused/archive-only and unintegrated. No provider retry, account action, purchase, or production integration is justified by this cycle. |
| Documentation/journal | `DECISIONS.md`; `PROGRESS.md`; `TEST_REPORT.md` | Retain as durable records. The required ignored/local journal `.workbuddy/memory/2026-09-04.md` was also updated, but it is not a Git-status file. |
| Other / scoped Cycle 1 measurement foundation | `src/services/transcriptOutcomeMeasurement.ts`; `src/services/__tests__/transcriptOutcomeMeasurement.test.ts` | Keep as a small local pure helper/test candidate. Do not wire a remote analytics sink until the D-011 emission gate is satisfied. |
| Other/unrelated | None identified | No unrelated dirty file was changed or reclassified as in-scope. |

`src/services/cfWorkerTranscript.ts` does not exist in this checkout. The current frontend equivalent is `src/services/youtubeTranscript.ts`; it was inspected for the response-consumption boundary and was not changed because no cache-state consumer or measurement sink was authorized in Cycle 1.

### VPS hostname validation

- `vps-ytdlp/main.py` already parses `urllib.parse.urlparse(target_url).hostname`, lowercases it, accepts only `youtu.be`, `youtube.com`, and `*.youtube.com` for YouTube, and applies exact known-host checks in `_host_allowed`. This is the bounded local fix expected by the review; the prior broad substring implementation is not present in the current local dirty source.
- Added `HostValidationTests.test_youtube_validation_uses_exact_hosts_and_subdomains` to `vps-ytdlp/test_main.py`. It covers accepted root/subdomain/short-link hosts and rejects lookalike domains, suffix attacks, path/query-only mentions, and user-info host confusion.
- No source rewrite was made beyond the pre-existing local candidate. No deployment, production source comparison, exploitability probe, or active-service verification occurred in this cycle. Local source is verified; production VPS revision/config is **UNKNOWN** and remains unmodified.

### Worker cache-state and CORS contract

- The existing local Worker cache marker is now named `TRANSCRIPT_CACHE_HEADER` and is exposed through `Access-Control-Expose-Headers` alongside `X-EchoLearn-Trace-Id`, so browser JavaScript can read it from the Worker response.
- The existing semantics remain intact: valid caption cache response = `HIT`; a normal caption request that misses the cache and reaches acquisition = `MISS`; explicit ASR and debug/diagnostic paths = `BYPASS`. The canonical cache key still uses transcript version `v=1`; no namespace/version change was made.
- ASR success/error responses now carry the `BYPASS` marker as well as the existing trace header. This is response observability only; provider ordering, cache lookup/write behavior, and ASR opt-in behavior were not redesigned.
- Deterministic Worker tests prove cache `HIT`, normal acquisition `MISS`, explicit ASR `BYPASS`, top-level CORS preservation, allowed-origin handling, and exposure of both readable headers. No live Worker traffic or deployment ran.

### Privacy-safe measurement contract

- Added `src/services/transcriptOutcomeMeasurement.ts` with a pure bounded builder. The output contains exactly `outcomeCode`, `cacheState`, `latencyBucket`, `authState`, and `retryUsed`.
- Outcome codes are a fixed aggregate allowlist; cache state is `HIT`/`MISS`/`BYPASS`/`UNKNOWN`; auth state is `guest`/`authenticated`/`unknown`; latency is one of fixed buckets from `<1s` through `>=120s` or `unknown`. Invalid categorical values fail closed and unavailable/invalid timing becomes `unknown` without retaining raw duration.
- Deterministic tests prove exact output keys, bucket boundaries, unknown timing, bounded categorical coverage, invalid-value rejection, and absence of URL/video/content/provider/credential fields from serialized measurement output.
- `src/services/analytics.ts` was not wired to a new event. Exact deferred gate: choose one bounded transcript completion/failure emission point, prove cache/auth/retry state can be supplied without URL/video/content/provider data, then obtain the required privacy/product approval before enabling any remote aggregate event. D-011 records this decision.

### Health-check/evidence hygiene

- The dirty `scripts/health-check.mjs` controls use fixed known caption URLs. They remain availability checks and may be served from cache; a passing body validator alone is not fresh-acquisition evidence.
- Added bounded response classification: a Worker `HIT` is reported as `cache_hit`, `MISS` as `cache_miss_before_acquisition`, `BYPASS` as `cache_bypassed`, and a missing/invalid header as `UNKNOWN` / `not_observable`. The Vercel control therefore cannot be mislabeled as a cold miss when the header is absent.
- Deterministic health tests cover all marker classes, malformed/missing state, a `MISS` response without URL/body retention, and a fixed successful control with no cache header. No live health-check invocation ran; fresh behavior validation is deferred to Cycle 2.

### Validation actually run

- Focused Vitest: `npx vitest run src/services/__tests__/cfWorkerTranscript.test.ts src/services/__tests__/healthCheck.test.ts src/services/__tests__/transcriptOutcomeMeasurement.test.ts` -> **3 files / 47 tests passed**.
- TypeScript: `npx tsc -b --pretty false` -> **passed**.
- Targeted lint: `npx eslint src/services/__tests__/cfWorkerTranscript.test.ts src/services/__tests__/healthCheck.test.ts src/services/transcriptOutcomeMeasurement.ts src/services/__tests__/transcriptOutcomeMeasurement.test.ts` -> **passed with 0 errors**.
- Syntax: `node --check cf-worker/src/index.js` and `node --check scripts/health-check.mjs` -> **passed**.
- Diff hygiene: `git diff --check` -> **passed**; only existing Windows LF/CRLF and Git ignore-permission warnings were reported by the surrounding Git checks.
- VPS Python focused tests: **not run** because both `python --version` and `py --version` reported that no interpreter is installed. No interpreter/package was installed to work around this. The added tests are source-visible but have no executed Python result in this cycle.
- Not run by design: `npm test` full suite, production build, E2E/browser verification, live health checks, live Worker/Vercel/VPS/provider traffic, SSH, deployment, and cloud/production checks. The changed application TypeScript is an unreferenced pure helper, so focused tests plus typecheck/lint were proportionate; no browser/R&D evidence was generated.

### State boundary and next gate

- Local: dirty/untracked research set remains intentionally preserved, with the exact grouping above. The VPS source fix is locally confirmed; the Worker CORS/cache marker and pure measurement foundation are locally tested.
- GitHub: `origin/main` remains at `6616139a0810f45b09c5c232054fa6860c9c4aa3`; no commit or push occurred.
- Production: current production revision/config remains unmodified by this task. The accepted Worker-only production evidence remains separate from this local candidate; per-request cold cache denominator remains unknown. VPS deployment state is not established by this cycle.
- Browser/ScrapingBee: paused/archive candidates, no production call-site integration, no provider spend, and no new VPS/provider action. The temporary DigitalOcean validation VPS lifecycle is complete/destroyed as already established; the newer generic-runtime host was not contacted or changed by this cycle.

Cycle 2 behavior-validation gate: use fresh confirmed-caption URLs, prove explicit `MISS` then `HIT` on the same controlled caption request, verify Guest -> Study, exercise a typed failure followed by Retry, run a negative control, and keep ASR/media/audio out of scope. Do not promote local or fixed-control evidence to production cold-cache proof until those observations are captured with the bounded aggregate contract.

## 2026-09-04 ECHO-20260904-2115 - Cycle 2 behavior validation

### Re-anchor and protected worktree

- Re-verified `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, and no staged changes. The exact Cycle 1 grouping remains the source of truth for the existing dirty/untracked research set. Cycle 2 touched only the Worker boundary test plus the local behavior harness/config and bounded Study error classifier/regression test; the current non-ignored set is 45 entries (40 carried forward plus 5 Cycle 2 additions). No unrelated files were moved, removed, reset, cleaned, stashed, or discarded.
- Current dirty groups remain: production-sensitive Worker (`cf-worker/src/index.js` plus the Worker test), production/security-sensitive VPS (`vps-ytdlp/main.py`, `vps-ytdlp/test_main.py`), operational/health-check (`scripts/health-check.mjs` and its focused test), browser experiment (the `scripts/local-native-youtube/` and browser fallback artifacts), ScrapingBee experiment (the `cf-worker/src/scrapingbee*`, `scripts/eval-scrapingbee-*`, and related tests), documentation/journal (`PROGRESS.md`, `TEST_REPORT.md`, `DECISIONS.md`, `.workbuddy/memory/2026-09-04.md`), and Cycle 2 local validation (`playwright.config.ts`, `e2e/cycle2-behavior-validation.spec.ts`, `src/pages/StudyPage.tsx`, `src/pages/studyCaptionError.ts`, and its test). No other/unrelated group was identified.

### Fresh-caption control status

- Three fresh candidate/control identities were checked with low-risk PowerShell YouTube page reads. All three returned `WebException`; no reliable independent caption-track evidence was obtained.
- Result: **fresh confirmed-caption control NOT VERIFIED**. The identities remain candidates only and are not called fresh confirmed-caption controls anywhere in this evidence. Synthetic transcript content in the local browser harness is not YouTube caption evidence.

### Actual local Worker cache boundary

- `src/services/__tests__/cfWorkerTranscript.test.ts` now exercises the actual Worker module through two `worker.fetch` calls for the same request, backed by an in-memory Cache API. The first response is `X-EchoLearn-Transcript-Cache: MISS`; the second is `HIT`; the provider stub is called only for acquisition; both response bodies are usable; and the cache state header is CORS-exposed.
- This deterministic test is the only Cycle 2 `MISS -> HIT` Worker proof. It is local candidate/test-environment evidence with a synthetic provider response, not live Worker, GitHub, or production traffic. The cache namespace/version remains `v=1`.
- The Playwright harness uses `route.fulfill` response headers named `MISS`/`HIT` to exercise browser rendering and header observation. Those are **simulated browser response markers only** and are not Worker cache proof.

### Behavior harness and bounded fix

- Added `e2e/cycle2-behavior-validation.spec.ts` for a clean Guest -> Study journey, non-empty transcript and Study controls, a typed provider failure followed by exactly one Retry request, and a typed `captions_not_found` negative control with no Generate/ASR path. All non-local traffic is aborted; the harness does not contact YouTube, the Worker, Vercel, a provider, a proxy, or a VPS.
- The first real local browser run using system Chrome passed 2/3 cases: Guest -> Study with simulated `MISS` then `HIT`, and typed provider failure -> Retry. The no-caption case failed because the existing page classifier only recognised a legacy message string. That failure led to the bounded fix in `src/pages/studyCaptionError.ts`, used by `StudyPage.tsx`, with regression tests proving typed no-caption recognition and that typed provider failure/timeout messages are not relabelled.
- After the fix, one bounded Node `child_process` runner was attempted. It was unable to complete the browser rerun in this execution environment; no residual local Vite listener remained. Per the supervisor redirect, no further process-launch investigation was done. Therefore the post-fix browser result is **environment-blocked/partial**, not a pass.
- The existing `useCaptionRequest` deterministic suite still proves stale success/failure responses cannot overwrite the latest request, and the Cycle 2 Retry case asserts one request per retry and no `allowAsr` query. No ASR/media/audio was executed.

### Negative control and health-check boundary

- The negative-control harness response is explicitly typed `captions_not_found`, not a timeout or provider failure. It asserts the no-subtitles state, no transcript lines, no Generate transcript action, no ASR opt-in, and a visible Retry action. The post-fix browser assertion is not rerun due the environment block; the pure classifier regression passes.
- No additional health-check traffic ran. The Cycle 1 health-check classifier remains the required boundary: fixed/cached URL success is availability evidence, and absent/invalid cache headers remain `UNKNOWN` rather than fresh acquisition.

### Privacy, validation, and state

- No new telemetry sink or production analytics wiring was added. The only measurement contract remains D-011: outcome code, cache state, latency bucket, Guest/auth state, and Retry-used. URL, video ID, transcript text, user-entered content, upstream bodies, cookies/tokens, and raw provider payloads are excluded from new aggregate events.
- Focused Vitest command covering the Worker boundary, caption request race/retry plumbing, YouTube error classification, ASR recovery contract, measurement contract, and Study classifier: **6 files / 80 tests passed**.
- TypeScript: `node node_modules/typescript/bin/tsc -b --pretty false` -> **passed**.
- Targeted ESLint for the changed Study files, Cycle 2 E2E, and Playwright config -> **0 errors, 7 pre-existing StudyPage warnings** (hook dependency/unused-disable warnings; no new error).
- Production build: `npm run build` -> **passed**; Vite emitted only the existing large-chunk warning and plugin timing notice.
- `git diff --check` -> **passed**; Git emitted existing Windows line-ending and ignore-permission warnings only.
- Python VPS tests were not rerun in Cycle 2 because no VPS source was changed in this cycle; Cycle 1 recorded that Python is unavailable locally. No live health check, Worker, provider, YouTube, SSH, VPS, production, GitHub, commit, push, or deploy validation ran.
- Local state is dirty and preserved. GitHub remains at `origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`. Production revision/configuration remains unmodified; production cache denominator and deployed VPS state are not established by this cycle. Browser-native and ScrapingBee artifacts remain paused/archive-only.

### Cycle 2 result

**PARTIAL.** The local Worker cache boundary, privacy-safe measurement boundaries, typed error classifier, deterministic stale/retry protections, typecheck, lint, build, and diff checks are verified. Fresh confirmed-caption identity and post-fix browser behavior are not verified; no local or simulated result is promoted to production evidence.

Next behavior gate: fresh independently confirmed native-caption control, then a runnable local browser proof of Guest -> Study/non-empty caption data, real Worker boundary `MISS` then `HIT`, typed failure -> Retry, semantic no-caption negative, and no ASR. Keep the browser `route.fulfill` markers explicitly separate from the Worker `worker.fetch`/in-memory Cache API proof.

## 2026-09-04 ECHO-20260904-2200 - Cycle 2 remaining-gate closure attempt

### Re-anchor and preservation

- Re-verified `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, no staged changes, and the existing 45-entry non-ignored dirty/untracked set. Cycle 1/2 files remain in their original locations. No destructive Git operation, commit, push, deploy, provider spend, VPS/SSH action, or production mutation occurred.

### Gate A - independent caption evidence

- Local YouTube-origin evidence was attempted with a fresh anonymous system Chrome context, direct watch-page navigation, media/googlevideo blocking, and a sanitized check for YouTube player caption-track metadata/CC surface. Three candidates all failed navigation with `net::ERR_NETWORK_ACCESS_DENIED`. The earlier PowerShell page reads for the same bounded set were `WebException`. These are environment/network blockers, not `captions_not_found` results.
- A direct official-page web read returned only a minimal page shell for one candidate and fetch/cache errors for the other two; it exposed no caption-track metadata. No candidate was promoted based on this path.
- Independent public corroboration supplied by the supervisor for `aircAruvnKk` reports: English language, non-generated/native flag (`isAutoGenerated=false` and separately `isGenerated=false`), non-zero transcript segment/cue count, and a crawl timestamp of `2026-08-16`. A third public tool page independently describes the same input as having an existing caption track. Only these aggregate structural fields were retained; no transcript text, raw response, URL payload, cookie, token, or provider body was stored.
- Result: **Gate A corroborated under the acceptance's independent non-EchoLearn-source wording**, with the explicit limitation that it is **not YouTube-origin UI proof**. If the reviewer requires YouTube-origin confirmation specifically, that narrower sub-gate remains **NOT VERIFIED** because local navigation is blocked.

### Gate B - post-fix browser behavior

- The existing `e2e/cycle2-behavior-validation.spec.ts` was run once through Playwright's own local `webServer` management with the system Chrome fallback. It produced no local `5173` listener and no usable suite result; the hung runner was terminated. A read-only process command-line query was permission-denied, so no unidentifiable `node.exe` was killed; a separate listener check found `NO_LISTENER_5173`.
- Result: **environment-blocked/partial, not behavior-failed**. The earlier real-browser 2/3 result remains pre-fix evidence only: Guest -> Study and typed failure -> Retry passed with simulated responses, while typed no-caption exposed the classifier bug. The bounded classifier fix has deterministic regression coverage, but no post-fix browser pass is claimed.
- The browser harness's `route.fulfill` `MISS`/`HIT` values remain simulated browser response markers. The actual local Worker `worker.fetch` + in-memory Cache API test from the prior cycle remains the only Worker cache proof and independently proves same-request `MISS` then `HIT` at the response boundary.

### Deterministic validation and layer boundaries

- Reran focused Vitest for `studyCaptionError`, `useCaptionRequest`, and `youtubeTranscript`: **3 files / 39 tests passed**, including typed no-caption classification, typed failure/retry plumbing, latest-request-wins stale protection, and no implicit ASR request behavior.
- Prior Cycle 2 full deterministic result remains **40 files / 533 tests passed**. TypeScript, production build, targeted ESLint, and `git diff --check` remain passed from the completed post-fix Cycle 2 validation; this task changed no product code.
- Local: deterministic helper/service evidence is verified; browser behavior is not post-fix verified. GitHub: `origin/main` remains unchanged at `6616139a0810f45b09c5c232054fa6860c9c4aa3`. Production: revision/configuration remains unmodified and production cache denominator remains unknown.
- Browser-native and ScrapingBee remain paused/archive-only. No ASR/media/audio, EchoLearn Worker/provider/Vercel traffic, health-check traffic, proxy, VPS, SSH, credentials, spend, or production request was used in this task.

### Final Cycle 2 status

**PARTIAL.** Gate A has bounded independent third-party corroboration for one fresh candidate but not local YouTube-origin UI confirmation. Gate B is environment-blocked after one Playwright-managed attempt; deterministic post-fix guarantees pass, but no post-fix browser E2E pass is claimed.

Remaining behavior gate: when local YouTube navigation and managed Vite execution are available, verify YouTube-origin native caption evidence and rerun Guest -> Study/non-empty captions, actual Worker `MISS` -> `HIT`, typed failure -> Retry without stale/duplicate corruption, semantic `captions_not_found`, and no ASR/media/audio. Keep all simulated browser markers separate from Worker boundary evidence.

## 2026-09-04 ECHO-20260904-2215 - Native approval continuation and Cycle 2 closure

- Native per-request approval was offered and approved for direct YouTube browser traffic and local Playwright/Vite process execution. The YouTube diagnostic used a fresh anonymous system-Chrome profile, direct `youtube.com/watch` navigation, Playwright CDP observation, and sanitized metrics only. M7 `M7lc1UVf-VE` reached `playabilityStatus=OK`, exposed two English tracks (`manual`, `auto`), and produced one direct YouTube `/api/timedtext` HTTP 200 JSON response with 65,976 bytes and 466 parsed events/segments. Browser metadata reported `navigator.webdriver=false`. No audio/media playback, ASR, caption text, cookies, request headers, tokens, or query values were retained.
- Native-approved Playwright-managed `webServer` execution ran cases 1 and 2 successfully, then case 3 failed before app load with `net::ERR_CONNECTION_REFUSED` because the Vite listener disappeared. This is an environment/process-lifecycle failure and not a semantic test failure; no unknown process was killed.
- Authorized bounded fallback: started attributable Vite PID `12328`, verified the localhost `5173` listener, ran `npx playwright test e2e/cycle2-behavior-validation.spec.ts --project=desktop-chromium`, and stopped only the attributable process. Result: **3/3 passed in 7.7s**. Coverage: Guest -> Study/non-empty captions; simulated browser response markers `MISS` then `HIT`; typed provider failure clears loading and Retry performs exactly one same-request retry; semantic `captions_not_found` negative; no Generate/ASR and no `allowAsr` query.
- Evidence boundaries: Playwright `route.fulfill` cache headers are simulated browser markers, not Worker proof. Actual Worker `worker.fetch` + in-memory Cache API `MISS` then `HIT` remains separately recorded deterministic local evidence. Neither result proves production Worker/provider availability or a YouTube-wide success rate.
- No ASR/audio/media acquisition, live Worker/provider/Vercel/production traffic, proxy, VPS/SSH, provider spend, commit, push, deploy, or production mutation occurred. Managed-webServer lifecycle remains a known local issue; the bounded fallback is the validated execution path for this cycle.

## 2026-09-04 ECHO-20260904-2235 - Fresh native controls and bounded production observation

### Re-anchor and scope

- This cycle remained local-first and no-VPS: no VPS creation/use, SSH, proxy service use, ScrapingBee/managed provider, spend, browser-native production integration, ASR/audio/media acquisition, commit, push, deploy, or production mutation. The previously destroyed temporary VPS remains destroyed; no new VPS was created.
- Branch `main`; `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; ahead/behind `0/0`; no staged changes; dirty/untracked work preserved. The historical 24-video matrix was not rerun.

### Five fresh direct YouTube controls

The existing headed system-Chrome/CDP harness ran one fresh logged-out profile per ID, with media/videoplayback blocked and no ASR/audio. These IDs were outside the historical `FIXTURES` list and were confirmed via YouTube player/timedtext evidence:

| ID | Player/title-author | Track evidence | Timedtext/structural evidence | Outcome |
|---|---|---|---|---|
| `arj7oStGLkU` | `OK`; TED; `Inside the Mind of a Master Procrastinator` | 50 tracks; English manual+auto | `200` JSON; 43,156 bytes; 315 events/segments; 315 lines; 17,471 ms | `SUCCESS` |
| `Ks-_Mh1QhMc` | `OK`; TED; `Your Body Language May Shape Who You Are` | 53 tracks; English manual+auto | `200` JSON; 61,689 bytes; 428/428; 428 lines; 14,617 ms | `SUCCESS` |
| `e-ORhEE9VVg` | `OK`; Taylor Swift; `Blank Space` | 1 track; English manual | `200` JSON; 19,613 bytes; 99/99; 98 lines; 15,409 ms | `SUCCESS` |
| `YQHsXMglC9A` | `OK`; Adele; `Hello` | 2 tracks; English auto+manual | `200` JSON; 16,546 bytes; 74/74; 74 lines; 16,126 ms | `SUCCESS` |
| `OPf0YbXqDm0` | `OK`; MarkRonsonVEVO; `Uptown Funk` | 1 track; English manual | `200` JSON; 26,808 bytes; 140/140; 110 lines; 16,879 ms | `SUCCESS` |

All five reported `navigator.webdriver=false`, zero media bytes, zero page errors, zero initial cookies, valid resource samples, and successful disposable-profile removal. Sanitized manifest: `D:\CODE\API\echolearn\evidence\ECHO-20260904-2235-native\fresh-matrix.json`; SHA-256 `5D3E99B18BC3E41DE00D59DDB39DDE94E541F847DA90380FE3B509B77458F2D3`. No transcript text, raw URLs/query values, cookies, headers, tokens, or raw bodies were retained.

### Production-path result and endpoint boundary

- The same five were exercised through `https://echo-learn.uk/study` in fresh guest profiles using URL paste -> Load -> Transcript/Study wait, with media blocked and browser blocks for `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, and `yt-api.echo-learn.uk`. The exact result is **Worker/main acquisition 5/5 typed `provider_timeout`** with Worker `/api/transcript` HTTP `504`, plus same-origin `/api/transcript` HTTP `504` for all five; no non-empty body or UI lines rendered, cache header absent so `UNKNOWN`, Retry visible but unused.
- This must not be called an unrestricted full-production user-path result: the harness intentionally prevented those three endpoints, and a blocked fallback could have changed the outcome. Source inspection shows `proxy.echo-learn.uk` is only an opt-in local-proxy branch via `echolearn_local_proxy_url`; fresh profiles cleared it. `proxy-cheap.echo-learn.uk` has no current source reference. `yt-api.echo-learn.uk` is a server-side Vercel `/api/transcript` fallback when `YTDLP_API_KEY` is configured, not a browser endpoint; browser blocking cannot establish whether that downstream call occurred. The deployed build-time `VITE_YOUTUBE_PROXY` value and server-side downstream branch are not fully observable from this run.
- The first same-five pass had three untyped UI failures and two typed timeouts. An instrumentation-only rerun of the same five exposed Worker and same-origin `504/provider_timeout` for all five. Thus report only the precise Worker/main and same-origin observations; later production fallback behavior is **UNKNOWN**, not `captions_not_found`.
- No reliable no-caption negative was established or fabricated. Existing deterministic local Worker `MISS -> HIT` and local Playwright `3/3` remain separate local/synthetic evidence and are not production proof.

### Validation and recommendation

- `node --check scripts/local-native-youtube/run-headed-matrix.mjs` passed before the native run.
- `node --check scripts/validate-production-fresh-matrix.mjs` passed on the final instrumentation run. `agent-browser` was unavailable, so the established external system-Chrome + Playwright/CDP fallback was used.
- This is one low-volume bad window, not a broad YouTube reliability claim. The local native result is `5/5`; Worker/main production observation is `5/5 provider_timeout`; same-origin is `5/5 504`; cache is `UNKNOWN`; no negative denominator exists.
- Recommendation remains **NO VPS for now**. The observed timeout rate justifies a focused fallback/provider-timeout investigation, but the Sol gate requires a second distinct no-VPS bad window before reopening fallback R&D. Next work should be deterministic/source-level or another explicitly approved read-only observation; no infrastructure, SSH, proxy/provider purchase, ASR/media, browser-native integration, or deploy.

## ECHO-20260904-2325: second fresh native window and unblocked production-path observation

### Local native confirmation

The second bounded external headed system-Chrome/CDP run used fresh logged-out profiles, YouTube-origin player/timedtext evidence, media blocking, and no ASR/audio. The five accepted IDs were outside both the historical 24-video `FIXTURES` and ECHO-20260904-2235: `ZbZSe6N_BXs` (PharrellWilliamsVEVO, `Happy`, manual English, player `OK`, timedtext `200`, 15,163 bytes, 75 events/segments, 75 lines, 14,763 ms); `JGwWNGJdvx8` (Ed Sheeran, `Shape of You`, manual+auto English tracks, `200`, 12,780 bytes, 92/90 events/lines, 16,199 ms); `RgKAFK5djSk` (Wiz Khalifa Music, `See You Again`, manual+auto English tracks, `200`, 18,122 bytes, 79/75 events/lines, 16,092 ms); `CevxZvSJLk8` (KatyPerryVEVO, `Roar`, manual English, `200`, 4,737 bytes, 31/31, 15,816 ms); and `60ItHLz5WEA` (Alan Walker, `Faded`, auto English, `200`, 18,021 bytes, 84 events/171 parsed segments/41 lines, 16,197 ms). Native denominator: **5/5 SUCCESS**; all player `OK`, `navigator.webdriver=false`, initial cookies `0`, page errors `0`, media encoded bytes `0`, and profile cleanup passed. No candidate replacement was needed. Sanitized evidence is outside the repo at `D:\CODE\API\echolearn\evidence\ECHO-20260904-2325-native\fresh-matrix-2.json`, SHA-256 `1A78AB4958E68E68B0D3DCA6B4CEC80876557DDBDBA413752A7033C168C99964`. No transcript text or sensitive request data was retained.

### Production Guest -> Study result

The improved harness ran the same five through `https://echo-learn.uk/study` using fresh guest profiles, URL paste -> Load -> Study wait, media-only blocking, no ASR, no Retry, and cleared `echolearn_local_proxy_url`. It did **not** block any transcript fallback endpoint. Results:

| ID | Worker/main and fallback observation | Final UI | Cache | Latency |
|---|---|---:|---|---:|
| `ZbZSe6N_BXs` | Worker request failed; same-origin `/api/transcript` `504`, typed `provider_timeout` | 0 lines; Retry visible | `UNKNOWN` | 15,064 ms |
| `JGwWNGJdvx8` | Worker request failed; same-origin `/api/transcript` `504`, typed `provider_timeout` | 0 lines; Retry visible | `UNKNOWN` | 14,463 ms |
| `RgKAFK5djSk` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 3,003 ms |
| `CevxZvSJLk8` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 2,386 ms |
| `60ItHLz5WEA` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 2,291 ms |

No Retry was used, no endpoint returned a non-empty transcript body, and page errors were `0/5`. The harness initially labeled the first two final outcomes `untyped_failure` because it only consulted Worker response records; their captured same-origin endpoint records were typed `provider_timeout`. The harness now derives typed outcome from all observed transcript endpoints. It was not rerun after this instrumentation-only correction to avoid replaying the same production cases.

### Endpoint and classification boundary

- ECHO-20260904-2235 remains a constrained first-window result: instrumentation rerun observed Worker/main `5/5` typed `provider_timeout` with Worker `/api/transcript` `504` and same-origin `/api/transcript` `504`; its harness intentionally blocked `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, and `yt-api.echo-learn.uk`, so later fallback behavior was **UNKNOWN**, not unrestricted production proof.
- In current source, `proxy.echo-learn.uk` is only the opt-in `echolearn_local_proxy_url` branch and was cleared in fresh profiles; `proxy-cheap.echo-learn.uk` has no current source reference; `yt-api.echo-learn.uk` is a server-side Vercel `/api/transcript` fallback controlled by `YTDLP_API_KEY`, not a browser endpoint. The live build-time `VITE_YOUTUBE_PROXY` and server environment are not fully observable. The second harness left all of these routes unblocked and recorded `explicitLocalProxyEndpointsBlocked=false`.
- The three `asr_required` results are not `captions_not_found` and not technical bad-window counts. Native YouTube evidence confirms usable captions exist, so this is a provider-acquisition/classification discrepancy: the Worker can report ASR-required after its caption providers yield no usable result, while the client correctly stops before explicit ASR. It is not evidence that the native controls lack captions.
- No reliable no-caption negative was established. Existing deterministic local Worker MISS -> HIT and local Playwright 3/3 remain separate evidence, not production proof.

### Gate verdict and validation

The Sol gate is **MET narrowly for bounded local source/root-cause review**: the first distinct window was 5/5 technical timeout; the second distinct fresh-positive window contains 2/5 technical timeout/network-to-same-origin failures. The remaining 3/5 are typed semantic/authorization outcomes, so this is not a claim of 5/5 technical failure or broad YouTube reliability. No VPS or fallback integration follows automatically. `VPS_NEEDED_NOW=false`; the previously destroyed temporary VPS remains destroyed and no new VPS was created.

Validation run: `node --check scripts/local-native-youtube/run-headed-matrix.mjs` passed; `node --check scripts/validate-production-fresh-matrix.mjs` passed before and after the harness correction; focused Vitest passed **4 files / 79 tests**; `git diff --check` passed with only existing CRLF and inaccessible global-ignore warnings. No product implementation was changed, and no commit, push, deploy, provider spend, SSH, proxy, ASR, media acquisition, or production mutation occurred.

## ECHO-20260905-0012 - Local fallback-order root-cause and regression cycle

### Confirmed source causes

- `src/services/youtubeTranscript.ts` had an overly terminal client decision: typed Worker `asr_required` stopped the server branch before same-origin and client-side independent non-ASR caption routes; a typed server-boundary `provider_timeout`/`asr_required` could likewise prevent InnerTube/page/npm continuation. This conflated “this route exhausted its caption options and ASR is configured” with “all non-ASR caption acquisition routes available to the user are exhausted.”
- `cf-worker/src/index.js` correctly keeps explicit ASR behind `allowAsr=1`, and its `409 asr_required` follows exhaustion of its own bounded caption stages when ASR capability is available. It is not a truthful `captions_not_found` result and is not proof that every frontend fallback was attempted. `api/transcript.ts` uses a 1,000 ms optional yt-api attempt and a 6,500 ms transcript-provider timeout; no broad timeout increase was made.

### Implementation and focused coverage

Changed `src/services/youtubeTranscript.ts` and `src/services/__tests__/youtubeTranscript.test.ts`. The client now defers Worker `asr_required` and server-boundary `provider_timeout`/`asr_required`, runs independent non-ASR routes, and surfaces the typed deferred result only when those routes are exhausted. Explicit ASR still requires consent; no ASR starts automatically. Existing typed errors, cancellation/stale safety, deduplication, Retry, and truthful `captions_not_found` behavior were preserved.

Focused Vitest passed **7 files / 134 tests**, covering Worker `asr_required` followed by independent caption success, exhausted routes retaining terminal `asr_required` without ASR start, timeout continuation to client caption success, provider failure continuation, semantic `captions_not_found`, API/Worker error handling, stale/duplicate/abort behavior, Retry, and ASR opt-in. `npx tsc -b --pretty false` passed. `npm run build` passed with the existing Vite chunk-size warning. Targeted ESLint passed for the changed service/test. `node --check` passed for the touched validation scripts. `git diff --check` passed with only existing CRLF/inaccessible global-ignore warnings.

The optional local Playwright behavior run was attempted once and was environment-blocked by the known Vite webServer lifecycle issue; it timed out with all three tests failing to start. No task-owned listener/process remained afterward. No live YouTube or production behavior evidence was run, and neither prior evidence window was repeated.

### Evidence boundary and recommendation

This is local source/test evidence, not deployed production proof. The prior first-window result remains Worker/main `5/5` typed `provider_timeout` with same-origin `5/5` 504 under a harness that blocked later endpoint hosts; the prior second window remains the unrestricted-by-harness default-route observation (2 technical timeouts, 3 typed `asr_required`). Do not relabel either as evidence of this un-deployed fix. `VPS_NEEDED_NOW=false`; the prior temporary VPS remains destroyed and no new VPS was created. A future production observation must separately verify Worker/main, same-origin/fallback, final UI, cache state (`UNKNOWN` if not observable), latency, and explicit ASR non-start.

## ECHO-20260905-0012 behavior-validation continuation

### Harness diagnosis and fix

- Vite startup itself was verified: `npm run dev` became ready in about 1.2 seconds and Playwright's webServer probe received HTTP 200. The initial failure was the missing bundled Playwright Chromium executable, not Vite startup. Local installed Chrome was used through the existing `ECHOLEARN_E2E_BROWSER_CHANNEL=chrome` configuration.
- The cycle2 spec then exposed a harness defect: cross-origin mocked CF Worker responses did not include `Access-Control-Allow-Origin`, causing the browser to report `Failed to fetch` instead of preserving typed mocked 200/404/502 responses. Added the minimal CORS header to those mock responses in `e2e/cycle2-behavior-validation.spec.ts`.
- An explicit `127.0.0.1` host/command change was attempted but did not improve completion and was reverted. Cycle2 remained unstable across multiple tests: in one run two tests passed and the third got `ERR_CONNECTION_REFUSED` on `page.goto`; another run hung until the outer timeout while Playwright terminated the Vite WebServer. This is runner/teardown evidence, not a product-flow failure. No unrelated processes were killed.

### Stable local behavior evidence

Extended `e2e/study-failure-recovery.spec.ts` with a deterministic Guest → Study scenario in which the mocked Worker returns typed `asr_required` and the independent same-origin/Vercel route returns usable caption lines. The scenario asserts Worker then Vercel ordering, non-empty rendered transcript, no `allowAsr=1`, and no ASR-generation UI. The existing Worker-timeout → Vercel scenario and the new `asr_required` scenario passed together: **2/2, 5.8 s**. The cycle2 no-caption scenario also passed individually after the CORS correction. This is local mocked behavior evidence only; no live YouTube, production, media, audio, ASR, VPS, proxy, or provider traffic was used.

Final behavior status: **PASS** for local app startup and the changed fallback semantics through the stable harness; **BLOCKED** for the cycle2 multi-test runner's independent teardown/lifecycle completion. The implementation remains un-deployed and production behavior is unknown. `VPS_NEEDED_NOW=false`; no commit, push, deploy, or production mutation occurred.

## ECHO-20260905-1237 intended-diff/code-review gate

### Intended candidate (Category A)

The intended candidate is limited to selected hunks in `src/services/youtubeTranscript.ts`, its focused regression file `src/services/__tests__/youtubeTranscript.test.ts`, and the added Worker `asr_required` -> independent Vercel caption Guest -> Study scenario in `e2e/study-failure-recovery.spec.ts`. The CORS headers in `e2e/cycle2-behavior-validation.spec.ts` are retained as harness correctness support only. Current review/evidence sections in `PROGRESS.md`, `TEST_REPORT.md`, and `.workbuddy/memory/2026-09-05.md` are durable record hunks, not wholesale production changes.

The source diff remains limited to deferring typed Worker/server-boundary `provider_timeout` and Worker `asr_required` until independent non-ASR client routes run. It preserves typed terminal behavior when exhausted, explicit ASR consent, no `allowAsr=1` auto-start, semantic `captions_not_found`/acquisition-blocked distinction, cancellation/stale protection, in-flight deduplication, Retry, and existing error rendering.

### Excluded or follow-up dirty work

Category B is excluded: Worker cache observability and tests (`cf-worker/src/index.js`, `src/services/__tests__/cfWorkerTranscript.test.ts`); VPS/yt-dlp; health-check; all ScrapingBee adapters/evaluators/tests; all local-native YouTube scripts/tests; the production fresh-matrix harness; browser fallback adapter/orchestrator modules/tests; transcript measurement modules/tests; and the optional Playwright Chrome-channel configuration. These remain preserved research/infrastructure changes and are not authorized to ride a future commit/deploy.

Category C requires a separate decision: `src/pages/StudyPage.tsx`, `src/pages/studyCaptionError.ts`, and its test are an earlier related typed no-caption UI correction, not required for this fallback-order candidate. `DECISIONS.md` was not changed in this review; D-012 remains canonical and D-009/D-010 remain superseded.

### Review findings and validation

No P0/P1 issue was found in Category A. A pre-existing risk remains: client fallback routes lack one aggregate deadline, so sequential independent attempts can increase latency after a timeout/asr-required response. It is recorded as a separate timeout-design follow-up; no speculative global timeout change was made.

Stable local browser validation passed the existing timeout fallback and new ASR-required fallback together (**2/2, 5.8 s**). The new test proved Guest -> Study, Worker -> independent Vercel ordering, non-empty rendered lines, zero `allowAsr=1`, and no ASR-generation UI. The cycle2 no-caption case passed individually after the CORS correction; its multi-test runner remains a test-infrastructure blocker. Targeted E2E ESLint and `git diff --check` passed. No prior broad suite, live YouTube, production matrix, VPS, proxy, paid provider, ASR, audio, or media test was rerun.

Review verdict: **Category A ready for explicit commit/deploy authorization, not production accepted**. `VPS_NEEDED_NOW=false`; no commit, push, deploy, or production mutation occurred.

## ECHO-20260905-1357 - Exact production deployment and bounded observation

### Deployment verification

The pushed commit `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8` was already deployed by the Vercel GitHub App: GitHub deployment `6275908365` is `Production`, SHA-exact, and `success`, with target `https://echolearn-jhjdwuan4-shmily0826s-projects.vercel.app`. Canonical production `https://echo-learn.uk` returned Vercel HTTP 200 and referenced `/assets/index-DqSgfbdf.js`. No Vercel CLI was installed/authenticated locally, so no duplicate manual deployment was attempted.

### Bounded live behavior

Exactly two previously independently confirmed native-caption controls were observed through fresh production Guest -> Study profiles. Media was blocked; transcript fallbacks were not browser-blocked; local proxy storage was cleared; Generate transcript and Retry were not used.

| Control | Worker/main | Same-origin/client | UI / cache / latency |
|---|---|---|---|
| `ZbZSe6N_BXs` / `Happy` | HTTP 504, typed `provider_timeout` | `/api/transcript` HTTP 504, typed `provider_timeout`; `/api/yt` HTTP 200 but no non-empty lines | 0 lines, Retry visible; cache `UNKNOWN`; 24,579 ms |
| `JGwWNGJdvx8` / `Shape of You` | HTTP 504, typed `provider_timeout` | `/api/transcript` HTTP 504, typed `provider_timeout`; `/api/yt` HTTP 200 but no non-empty lines | 0 lines, Retry visible; cache `UNKNOWN`; 21,790 ms |

Both cases recorded zero browser request query values `allowAsr=1`, zero page errors, no Retry use, and no ASR/audio/media acquisition. API 200 is not treated as success because no transcript lines reached Study. This is post-deploy evidence at `n=2`, not a broad reliability claim and not a rerun of either historical five-control window.

### `/api/yt` root-cause diagnostic

One corrected, single-control Happy observation classified the three same-origin `/api/yt` 200 responses without retaining bodies, raw URLs, headers, cookies, tokens, or transcript text. Two were `POST` InnerTube player JSON responses (4,824 and 3,210 bytes, `LOGIN_REQUIRED`, zero `captionTracks` and zero timed-text events). One was a `GET` YouTube page HTML response (1,210,847 bytes, `ytInitialPlayerResponse` marker present, no `captionTracks` marker). No timedtext call ran because no usable caption track URL was returned. This is consistent with committed `youtubeTranscript.ts`: the player/page stages reject no usable track list and never reach timedtext parsing; no extraction loss was proven.

### Verdict and boundary

Production acceptance is **NOT MET** for this bounded observation (`0/2` final UI successes). The client candidate is deployed exactly and local fallback-order regressions remain separate evidence; the observed Worker and same-origin timeouts plus Login-required/trackless `/api/yt` responses leave the upstream/provider-chain cause unresolved. The diagnostic also ended with 0 UI lines, Retry visible, `allowAsr=1` count 0, and no ASR/audio/media acquisition. No VPS, SSH, proxy, paid provider, source mutation, commit, push, or manual deploy action occurred in this validation cycle; the prior temporary VPS remains destroyed. `VPS_NEEDED_NOW=false`.

### Provider/upstream A/B review

Production `youtubeTranscript.ts` sends same-origin `/api/yt` InnerTube POSTs with Android `20.10.38` and WEB `2.20241201.00.00` client identities, `hl=en`, `videoId`, `contentCheckOk=true`, and `racyCheckOk=true`. `api/yt.ts` translates these to server Android or Chrome/125 User-Agent/client headers, adds a fixed consent cookie and language header, and does not forward browser Origin/Referer, visitorData, playbackContext, browser session cookies, or PO-token/attestation material. Page GETs use the same server-side Chrome/125 identity.

The known-good local control used real logged-out system Chrome directly against YouTube origin, with browser-generated session/context and first-party requests; it independently exposed native `captionTracks` and timedtext HTTP 200 cues. The production Happy diagnostic instead saw two HTTP 200 InnerTube player JSON responses with `LOGIN_REQUIRED`, zero caption tracks/events, then one HTTP 200 page HTML response with `ytInitialPlayerResponse` but no `captionTracks`. No timedtext call occurred. The evidence therefore places failure before subtitle URL exposure and does not show cue-parser loss.

Current upstream context: the [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) describes session/video-bound PO tokens and current `web` Subs enforcement; [#15865](https://github.com/yt-dlp/yt-dlp/issues/15865) records browser-playable videos with non-browser `LOGIN_REQUIRED`; [#17375](https://github.com/yt-dlp/yt-dlp/issues/17375) reports datacenter/public-VPN IP reputation effects and intermittent `LOGIN_REQUIRED`/403; [#17125](https://github.com/yt-dlp/yt-dlp/issues/17125) is a distinct after-track-exposure missing-Subs-PO-token case. These sources support a combined server-context/egress hypothesis, but PO-token enforcement is not proven as the direct cause because no subtitle request was reached. No speculative non-ASR request change was made.

## ECHO-20260905-1424 - Local Node static-recipe discriminator

One direct YouTube-origin Node experiment from local desktop egress replayed the current `/api/yt` static recipe for Happy only. It used Android `20.10.38` and WEB `2.20241201.00.00`, the same body fields (`hl`, `videoId`, `contentCheckOk`, `racyCheckOk`), server-style User-Agent/client headers, fixed consent/language behavior, and no Origin/Referer, visitorData, playbackContext, PO token, or imported cookies.

| Variant | HTTP / structure | Caption evidence |
|---|---|---|
| Android player | `200`, JSON, `playabilityStatus=OK` | 1 caption track; timedtext URL exposed |
| WEB player | `200`, JSON, `playabilityStatus=UNPLAYABLE` | 0 caption tracks |
| YouTube page | `200`, HTML | `ytInitialPlayerResponse` and `captionTracks` markers present |

Only structural metadata was emitted; raw bodies, URLs, cookies, tokens, and transcript text were not retained. Compared with Vercel's Android/WEB `LOGIN_REQUIRED` and trackless page, Android success from the same static recipe raises confidence that Vercel/server egress or IP reputation is a dominant variable. Local WEB failure keeps browser/session/attestation or client-specific enforcement as a contributing factor. Because no timedtext request ran, PO-token enforcement is not proven as the direct cause; the local Android track exposure without a supplied PO token argues against treating it as the immediate failure stage. No source mutation or minimal fix is justified.

## ECHO-20260905-1440 - Existing Cloudflare `/api/yt` discriminator

`handleProxy` was inspected before execution and confirmed as a pure allowed-host YouTube forwarder. The existing Worker route accepts the supplied POST body, applies Android UA/JSON/language/consent headers, forwards the request, and returns the upstream response; it does not enter `/api/transcript`, VPS, ASR, ScrapingBee, or media acquisition.

Exactly one Happy Android InnerTube POST was sent through the deployed Cloudflare Worker `/api/yt` route. The Worker returned HTTP `200`; sanitized upstream structure was JSON, `4,800` bytes, `playabilityStatus=LOGIN_REQUIRED`, zero caption tracks, no timedtext URL, and zero timedtext events. No raw body, target URL/query, cookie, token, or transcript text was retained.

This is negative for Cloudflare as an immediate replacement: local Node direct Android previously returned `200/OK/1 track`, Vercel returned `LOGIN_REQUIRED/0 tracks`, and Cloudflare also returned `LOGIN_REQUIRED/0 tracks`. The changed variable is therefore broader cloud/server egress or environment versus desktop/browser context; exact IP reputation and attestation contributions remain unresolved. No source/config fix is justified and `VPS_NEEDED_NOW=false` remains unchanged.

## ECHO-20260905-1435 - No-VPS solution-design investigation

### Current path map

The frontend first uses an explicitly configured local proxy only when `echolearn_local_proxy_url` exists. Its default server path calls the Cloudflare Worker `/api/transcript`, then same-origin Vercel `/api/transcript`; after typed server failures are deferred, it tries InnerTube Android/WEB and page scraping through Vercel `/api/yt`, then the client `youtube-transcript` package/CORS GET fallbacks. `VITE_YOUTUBE_PROXY` could replace the default `/api/yt` target, but the production build value is unknown.

Vercel `/api/yt` is a server-side YouTube forwarder. It applies server Android/Chrome-125 identities, client headers, fixed consent cookie, and language header, without browser visitor/session context or PO-token attestation. Vercel `/api/transcript` is separate: it attempts the historical `YTDLP_API_URL` VPS route, then the server npm transcript provider. The Worker `/api/transcript` is Cloudflare egress and directly runs Android/iOS/WEB/TV InnerTube, webpage, Invidious, and Piped caption stages; the Worker also exposes a Cloudflare `/api/yt` forwarder. The VPS/provider branch remains historical server infrastructure, not a new action.

### Design boundary and candidates

Local static Android success for Happy and Shape rules out an inherently invalid request body/client recipe, but not server egress or environment. Production `LOGIN_REQUIRED`/trackless responses occur before timedtext exposure; the deployed fallback-order fix therefore remains necessary but not sufficient. The Worker path is architecturally a materially different egress, but current Worker `provider_timeout`/`asr_required` results do not prove that it exposes native tracks, and Cloudflare is not assumed residential/clean.

1. **Existing Worker stage discriminator:** highest information gain, low cost, reversible. A future single-control read-only Worker observation, using existing sanitized debug stage outcomes only if already enabled, could distinguish InnerTube/page/timedtext/deadline failure from Cloudflare egress. Enabling new debug/telemetry would require separate authorization.
2. **Clean Vercel preview/region A/B:** moderate information gain and greater operational cost. Replay the same Android request from a clean exact-commit preview or explicitly authorized Vercel network/region variant. This avoids production mutation but does not guarantee a materially different IP reputation; deployment/authentication and rollback boundaries need approval.

Browser-native fallback, managed alternate egress/provider, and VPS/residential paths remain later, higher-cost options. No solution was implemented or deployed, and `VPS_NEEDED_NOW=false` remains unchanged.

## ECHO-20260905-1555 - Supadata Playground local Playwright blocker

The minimal local browser capability check found Playwright `1.62.1` and the installed Chrome channel. A single fresh browser navigation to `https://supadata.ai/playground` failed before DOM load with `ERR_NETWORK_ACCESS_DENIED`; the script stopped without clicking Run. Therefore there is no Supadata provider result and no native transcript capability evidence. No direct YouTube, alternate provider, proxy, VPS, ASR/audio/media, production, source/config/test, commit, push, or deploy action occurred. This remains an environment blocker rather than a provider verdict; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1534 - Active-goal scope guard and current Supadata handoff

This documentation-only checkpoint records the new durable scope-discipline policy in `DECISIONS.md`. Once the active goal, root cause, and acceptance criteria are specific, additional work must have a clear current hypothesis, acceptance-criterion, regression, or safety purpose; task-start/recovery history and history required by a concrete hypothesis remain allowed. Unrelated historical reading, speculation, repeated stable tests, and unrelated polishing are scope drift.

Supadata native-only capability is still **untested**. The no-key direct API attempt produced no HTTP response (`fetch failed`) and therefore no provider status or capability evidence; no local Supadata credential exists. The official Playground remains the only untested no-key path, requires Chrome Computer Use approval, and has had no completed Run. No provider spend, VPS, source/config/test mutation, production mutation, commit, push, or deploy occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1640 - Supadata Playground Native matrix

The user-launched dedicated Chrome at CDP `9222` was attached successfully with Playwright `connectOverCDP`. It was a temporary local test instrument, not a production architecture. The Playground remained API-key blank, `Language=Auto`, `Mode=Native`, and `Text=false`; Generate/ASR was not selected.

| Control | Result | Structured evidence |
|---|---|---|
| Happy (`ZbZSe6N_BXs`) | PASS | User-manual result |
| Shape of You (`JGwWNGJdvx8`) | PASS | 92 non-empty native cues |
| See You Again (`RgKAFK5djSk`) | PASS | 79 non-empty native cues |
| Roar (`CevxZvSJLk8`) | PASS | 31 non-empty native cues |
| Faded (`60ItHLz5WEA`) | PASS | 42 non-empty native cues |

All five had structured native output with timestamps/durations, monotonic offsets, and semantic binding to the requested video (`semanticMatch=true`). The harness lesson is material: unrelated background HTTP 200s are not settlement. A valid sequential run must require exactly one new `/api/run`, a changed Result fingerprint, matching input URL, and semantic binding before the next click; a click with no `/api/run` is a harness failure, not a provider failure or retry.

This is local browser-context capability evidence only. It does not establish Supadata API-key behavior, API integration, production/cloud egress, cost/privacy/rate-limit performance, or EchoLearn production reliability. Supadata is a strong managed-provider integration candidate for formal API/cost/privacy/latency/reliability evaluation, but is not adopted or production-ready. No EchoLearn source/config/test code changed; no commit, push, deploy, VPS/proxy, provider spend, ASR, audio, or media acquisition occurred. `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1705 - Authenticated Supadata API probe blocker

The project-root `.env.local` `SUPADATA_API_KEY` was confirmed non-empty without disclosure. Exactly one official Supadata transcript GET was attempted for Happy (`ZbZSe6N_BXs`) with `mode=native`, `text=false`, and `lang=en`. It returned no HTTP response and failed in the local/Codex network context with a fetch `TypeError` after approximately `136 ms`. No retry or polling occurred, so authenticated API capability remains **UNTESTED**; there are no HTTP, response-structure, cue, timing, or semantic results to report.

This is a local/Codex network-context blocker, not a Supadata provider failure. The next discriminator should use the user's normal desktop network context and must not repeat this blocked Codex path. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1710 - Desktop authenticated Supadata API PASS

A user-run normal-desktop-network authenticated probe for Happy (`ZbZSe6N_BXs`) succeeded: HTTP `200`, latency approximately `3,353 ms`, `lang=en`, `availableLangs=en`, `cueCount=75`, non-empty content, numeric offsets/durations present with monotonic offsets, and `semanticMatch=true`. Transcript text was not retained.

This is separate from ECHO-20260905-1700, where the same authenticated API capability probe from the Codex network context failed locally with `TypeError` before any HTTP response. The new result proves authenticated Supadata API native capability from the user's normal desktop network; the earlier result remains an execution-environment network blocker, not a Supadata provider failure. Next: run exactly one authenticated native-only matrix for Shape of You, See You Again, Roar, and Faded, without retrying Happy, then decide whether integration evaluation should proceed. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1720 - Supadata integration budget blocker

The authenticated native-only matrix is **5/5 acquisition PASS**: Happy 3,353 ms / 75 cues, Shape of You 14,352 ms / 92 cues, See You Again 2,789 ms / 79 cues, Roar 2,288 ms / 31 cues, and Faded 2,110 ms / 42 cues. All were non-empty with monotonic offsets. Strict semantic matching was 4/5 plus one matcher-inconclusive result for See You Again; its structure matched the prior Playground semantic PASS, so it is not a provider failure.

Direct code evidence: `fetchYouTubeServerTranscript` uses an 8,000 ms Vercel timeout for caption-only requests. The Vercel handler's existing VPS and npm budgets are 1,000 ms and 6,500 ms. A post-npm Supadata timeout of 2,500 ms would not admit the known-positive 14,352 ms result and would violate the integration objective. The unsafe draft was removed; no Supadata integration or new tests remain. No tests were run for the reverted draft. The bounded decision is either (A) increase the Vercel caller budget and choose provider order, likely Supadata before npm, or (B) keep the current budget and defer integration. No commit, push, deploy, or production change occurred.

## ECHO-20260905-1735 - Supadata native fallback validation

### Implementation under test

- Provider order on the Vercel fallback path is configured VPS, opt-in Supadata native, then the existing youtube-transcript/npm provider. Absence of `SUPADATA_API_KEY` preserves the old path.
- Supadata uses one server-side request with `mode=native` and `text=false`; an already-known requested language is passed, otherwise language is left to API default behavior. `content[]` cues are validated for non-empty text and finite nonnegative offset/duration, sorted as required, and converted to the existing seconds-based cue model.
- The handler uses a 21 s overall deadline and an 18 s Supadata cap; npm receives only remaining time. The caption-only Vercel caller is 22 s, while the fast Worker path is unchanged. No `vercel.json` duration change was made because deployed runtime compatibility is not provable from the repository.

### Deterministic validation

- `src/api/__tests__/transcriptHandler.test.ts` and `src/services/__tests__/youtubeTranscript.test.ts`: **55/55 PASS**.
- Covered no-key old behavior; order and single-call behavior; native-only query; optional language; valid cue normalization; malformed/empty payload; HTTP 206 continuation; 401/403/429/5xx/network/timeout typing; remaining-budget abort behavior; earlier provider/acquisition failure arbitration; secret absence from output/logs; no `allowAsr`, Generate, or ASR path; and delayed approximately 14.5 s success within the new budget.
- `npx tsc -b --pretty false`: PASS. `npm run build`: PASS. Targeted ESLint for changed source/tests/E2E: PASS. `git diff --check`: PASS.

### Behavior/browser evidence

- The installed-Chrome single delayed Study case passed its product assertions in **14.2 s**: captions arrived after the old 8 s boundary, rendered non-empty, issued no `allowAsr=1` request, and showed no Generate Transcript/ASR state.
- The outer Playwright command timed out during runner/webServer cleanup after the test passed. No further E2E retry was made; E2E completion is recorded as **validation-layer BLOCKED**, while the behavior assertion remains PASS. No live provider request was made.

### Release truth

- Local source/tests/docs contain the implementation and evidence above. GitHub is unchanged because there was no commit or push. Production is unchanged because there was no deploy, dashboard mutation, or secret setup; Vercel runtime-duration and server-side key binding still require deployment-time verification.

## ECHO-20260905-1808 - Deployment-readiness verification

- Repository state: root, branch, HEAD, origin, and dirty-work inventory were confirmed read-only. No unrelated paths were changed.
- Local binding: `.vercel/project.json` links project `echolearn`; `vercel.json` has rewrites only and no duration/runtime override. `.env.local` contains a non-empty `SUPADATA_API_KEY` by boolean check only and remains ignored. The key value was never printed, logged, or written to a tracked artifact.
- Remote binding/runtime: Vercel CLI is unavailable on PATH and `npx --no-install vercel` is unavailable. Therefore Vercel Production/Preview/Development environment-variable presence and deployed function/runtime duration could not be queried. This is an observation limitation, not evidence that the remote key is absent or that runtime capacity is insufficient.
- Privacy review: no production client `VITE_` or `import.meta.env` Supadata reference was found; only server/API test references remain. No server logging pattern exposes the key, transcript text, or request URL. No provider, YouTube, app, dashboard, commit, push, or deploy request was made.
- Release readiness: local code is validated, but production env binding is **unverified** and deployed runtime duration is **unverified**. `vercel.json` was intentionally left unchanged. Commit/push/deploy remain separate actions awaiting explicit authorization.

## ECHO-20260905-1818 - Deployment configuration update

- `vercel.json` was changed only for the transcript function: official `$schema` added and `functions["api/transcript.ts"].maxDuration` set to **30**. Existing rewrite count remained **7**; no other function changed.
- Native PowerShell validation passed for JSON parsing, schema presence, exact transcript function key/duration, and rewrite preservation. `npm run build` passed after the config change. No unrelated tests or E2E runs were repeated.
- The one bounded temporary CLI attempt failed before authentication with npm `EACCES` while fetching `vercel@latest`. Production/Preview/Development env presence could not be queried and `SUPADATA_API_KEY` was not added. The local ignored `.env.local` secret was checked only for boolean presence; its value was never printed or logged.
- No provider, YouTube, app, dashboard, commit, push, or deploy action occurred. Runtime ambiguity is resolved in tracked local config; Production secret binding remains the sole Vercel setup blocker before the separate commit/push/deploy authorization boundary.

## ECHO-20260905-2125 - Current Production secret status

- User-reported dashboard state: Production-only `SUPADATA_API_KEY` was manually added in Vercel Dashboard. This was not independently verified, and no secret value was read, stored, printed, or logged.
- The ECHO-20260905-1818 CLI blocker remains historical and is not rewritten. No redeploy has occurred, so production behavior and runtime secret activation remain unproven and unchanged.
- Local source/config validation remains release-prep green from ECHO-20260905-2120. Commit, push, and deploy still require explicit authorization. Browser-control artifacts `.playwright-cli/` and `.tmp-playwright-daemon/` must not be staged.

## ECHO-20260905-2228 - Production Supadata fallback validation

- Deployment evidence: user confirmed Vercel revision `61fe54d` is **Ready** and **Production** on `main`.
- One and only one production caption-only request was sent to `https://echo-learn.uk/api/transcript` for `ZbZSe6N_BXs`. Sanitized result: HTTP `200`; latency `4512 ms`; `source=supadata`; language `en`; `75` cues; non-empty; timestamps valid and monotonic; no failure code.
- No retry, polling, direct Supadata request, ASR, Generate, auto mode, secret access, or deploy occurred. Transcript text was not printed or retained.
- Acceptance result: the deployed Supadata native-only fallback is conclusively validated server-side. Browser Study-page E2E is optional and non-blocking because it would add UI confidence without materially changing this release decision.

## ECHO-20260905-2245 - Caption Diagnostics V1

### Focused implementation checks

- Provenance is carried as raw optional `source` data and translated only at the Study display boundary. A dedicated source-label regression test verifies `supadata` renders as one label rather than being translated twice.
- Supadata attempt diagnostics survive fallback-success cases, including Supadata unavailable/failure followed by npm/native success. The browser-local aggregate records one observed attempt, classifies success/unavailable/timeout/failure, and estimates one likely credit per attempt without claiming actual billing.
- Optional session provenance fields remain backward compatible with legacy saved sessions. The stale dashboard-navigation comment claiming source was not recorded was removed.
- The Study signal is compact and reactive after an attempted request: provider, elapsed time, cue count, likely Supadata use, and this-browser attempts/likely credits. No secret, URL/video ID, transcript text, upstream payload, cookie, or token is included.

### Validation actually run

- Focused Vitest: **84/84 PASS** across `transcriptHandler`, `youtubeTranscript`, `captionDiagnostics`, `useCaptionRequest`, `studySession`, and `captionSource` tests.
- `npx tsc -b --pretty false`: PASS.
- Targeted ESLint over changed Caption Diagnostics source/tests: PASS with 0 errors; 8 StudyPage hook/dependency warnings remain from the existing callback/effect structure.
- `npm run build`: PASS; only normal bundle-size/plugin timing warnings.
- No provider, YouTube, production, browser, commit, push, or deploy action was performed in this correction cycle.

## ECHO-20260905-2310 - Release review, push, deployment, and bounded Production validation

### Release review and Git evidence

- Reconfirmed root `D:/CODE/project/EchoLearn`, branch `main`, pre-release HEAD `61fe54d`, and remote `origin` `git@github.com:Shmily0826/EchoLearn.git`. The release index contained only 19 reviewed Caption Diagnostics/Supadata provenance paths. The unrelated `StudyPage.tsx` no-caption helper hunk was deliberately left unstaged; all other unrelated tracked and untracked work remained outside the commit.
- Staged diff review found no `.env*`, browser artifacts, keys, tokens, raw transcript text, or accidental debug files. The review confirmed npm provenance, Supadata-attempt preservation through fallback success, optional session fields, local aggregate storage, server-only key handling, and no ASR/provider-order changes.
- Commit: `98607b4` (`feat: add caption diagnostics provenance`). Push: **PASS**, `61fe54d..98607b4 main -> main`; `origin/main` now equals `98607b4`.

### Deployment evidence

- No Vercel CLI was available and no package was installed. The established GitHub-to-Vercel path was used. Public GitHub status metadata for commit `98607b4` reported context `Vercel`, state `success`, description `Deployment has completed`, deployment target `EAJ4vXhaxkZ63G9YMsrzCnwTkKRT`.
- `https://echo-learn.uk/` returned HTTP 200 from Vercel. The deployed public StudyPage chunk contained `caption-supadata-estimate`, `caption-diagnostics-saved`, and `captionSource` markers. No `/api/transcript`, Worker, Supadata, ASR, or secret request was made.

### Production validation boundary

- A fresh disposable browser context used synthetic non-Supadata session data and blocked `/api/` plus Worker routes. The public app loaded its authentication gate; the guest action did not reach Study within the bounded attempt. Therefore interactive authenticated Study rendering and session reopen were not independently proven in Production.
- This is a validation-layer/account-access limitation, not a failed Caption Diagnostics assertion: the deployed static artifact contains the new UI, local deterministic validation is green, and no paid provider request was made. No production fix or additional retry was justified.
- Release result: **RELEASED/ACCEPTED with interactive Production validation limitation**. Remaining risk is authenticated/guest Study-path confidence, not deployment, GitHub, secret exposure, or Supadata provider correctness.

## 2026-09-06 - Architecture consolidation Phase 0 final gate

- Archive branch `research/architecture-consolidation-archive` (`b5cf7bd`, 33 files) created locally; not pushed. Main promotion slices: `6546d8c` (Worker cache-state header + health-check cache classification + paired tests), `a258707` (typed caption failure classification + error-code contract module + 10 drift tests + contract doc), `65a9c99` (VPS exact-host allowlist hardening), `c512f15` (Playwright channel env gate + gitignore for local browser-control dirs), `e5b97cd` (architecture map + budget register + progress records).
- Validation actually run at the final gate: full Vitest **37 files / 463 tests PASS**; `npx tsc -b` PASS; targeted ESLint 0 errors; `npm run build` PASS; `git diff --check` PASS. VPS `unittest test_main` **43/43 PASS** (Python 3.14.4, isolated venv, first-ever execution of that suite; the throwaway venv and its generated `audio.mp3` fixture were removed afterwards).
- Privacy/secret scan over `f51c1bc..HEAD`: matches are env-variable names and doc descriptions only; no key values, cookies, transcript text, raw provider payloads, or private URLs.
- Final status: `main` working tree clean; `main` ahead of `origin/main` by 5 commits, `origin/main` unchanged at `f51c1bc`; production untouched (no deploy, no provider/Worker/VPS traffic). Remaining Phase 2/4 candidates are registered in `docs/ARCHITECTURE.md` §7.

## HISTORICAL 2026-09-07 - Post-architecture-consolidation reconciliation

This is a documentation reconciliation of existing `PROGRESS.md` and current-source evidence after the 2026-09-06 architecture-consolidation ending. It is not a fresh provider, browser, network, or Production verification.

- Recorded production Worker attribution and budget A/B evidence: the 12-video Worker-only attribution windows were 0/36 overall, and the debug-enabled fast-fail rows directly identified blocked InnerTube/webpage/Invidious/Piped stages; timeout-row equivalence remained an inference because those 504 paths carried no `_debug`. The 12 s / 5 s / 3 s arms each produced Worker 0/12 and final usable 12/12; Supadata-backed L2 calls were 12/11/10, with median time-to-caption 8468/8063/5932 ms and P90 14667/9236/8029 ms. The recorded 5 s caption-only budget was the A/B-era recommendation/decision before Option B and is not the current non-ASR architecture.
- Recorded Option B implementation and validation: Option B later superseded the synchronous non-ASR Worker probe; non-ASR requests now use same-origin Vercel (`VPS → Supadata → npm`), while explicit `allowAsr=1` uses the CF Worker with the existing 90 s budget. The recorded validation was full Vitest 462/462, typecheck, targeted ESLint, build, and diff-check PASS, plus 12/12 usable frozen-matrix results with `source=supadata` and zero transport discrepancies.
- Recorded production sync: the Worker was deployed with Wrangler as version `47465f54`; the recorded smoke checks showed the expected typed caption timeout and the Invidious pool in cooldown.
- Recorded day-close hygiene: pushed commit `d14fd3f` removed the dormant gateway path and tests and corrected the `YTDLP_TIMEOUT` documentation comment. Recorded validation was Worker 22/22, VPS unittest 43/43, full Vitest 460/460, typecheck, build, and diff-check PASS.
- Standing reliability automation is recorded as active for Mondays at 09:00, Worker-only. No scheduler execution was independently re-run in this reconciliation.
- Caption Diagnostics browser-local Supadata attempt and credit counts are estimates only. Actual Supadata billing/credits remain unknown pending dashboard/billing data; no pricing or cost is inferred here.

Fresh independent verification for this bounded reconciliation: none beyond read-only repository/Git inspection and the documentation/source review. The production, GitHub, and Worker records above remain recorded evidence rather than newly re-established state.
