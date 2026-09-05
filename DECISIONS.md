# EchoLearn Active Decisions

This file contains only durable, currently active architecture, product, and operational decisions. It is not a progress log or test report.

## D-001 — Documentation source-of-truth ownership

- Date: 2026-09-01
- Status: ACTIVE
- Decision: `PROGRESS.md` is the current project-status source; `TEST_REPORT.md` is the validation-evidence source; this file contains active durable decisions; `.workbuddy/memory/YYYY-MM-DD.md` contains historical engineering journals; task handoffs contain per-task state.
- Rationale: Keep current status, validation evidence, durable rules, and historical investigations separate and easy to audit.
- Supersedes: None recorded.
- Superseded by: None recorded.

## ECHO-20260905-2125 - User-reported Production secret status

- Date: 2026-09-05
- Status: CURRENT / UNVERIFIED
- Decision: Record the user's report that Vercel Dashboard Production-only `SUPADATA_API_KEY` was manually added, while preserving ECHO-20260905-1818 as the historical point when setup was blocked. Do not treat the dashboard report as independently verified or as proof that the secret is active in a production runtime before redeploy.
- Boundaries: No secret value was read or stored. No redeploy has occurred, so production behavior remains unchanged. Local source/config release-prep remains green per ECHO-20260905-2120. Commit, push, and deploy still require explicit authorization. `.playwright-cli/` and `.tmp-playwright-daemon/` are investigation artifacts and must not be staged.

## ECHO-20260905-1818 - Explicit Vercel transcript function duration

- Date: 2026-09-05
- Status: ACTIVE
- Decision: Add `functions["api/transcript.ts"].maxDuration = 30` to `vercel.json`, with the official Vercel schema declaration, while preserving all existing rewrites and leaving every other function untouched.
- Rationale: The local Supadata design allows a 21,000 ms handler deadline and a 22,000 ms caller budget. An explicit 30-second function limit avoids reliance on dashboard/runtime defaults and safely covers the handler while remaining within the accepted Vercel plan limits.
- Secret boundary: Production `SUPADATA_API_KEY` was not configured in this cycle because the one permitted temporary Vercel CLI attempt failed while fetching `vercel@latest` with local `EACCES`. No secret value was printed, echoed, or sent through an alternate path; no retry, token creation, dashboard mutation, commit, push, or deploy occurred.

## ECHO-20260905-1735 - Supadata native fallback, reliability-first budget

- Date: 2026-09-05
- Status: ACTIVE
- Decision: Supersede the ECHO-20260905-1720 budget blocker and implement the reliability-first fallback order `configured VPS -> opt-in Supadata native -> existing youtube-transcript/npm`. When `SUPADATA_API_KEY` is absent, the existing VPS -> npm behavior remains unchanged. Supadata is server-side only, uses exactly `mode=native` and `text=false`, makes one request per attempt, and never enters Generate/ASR/media acquisition.
- Budget: Use a 21,000 ms Vercel handler deadline, an 18,000 ms Supadata cap, and a 22,000 ms caption-only same-origin Vercel caller timeout. Later providers receive only the remaining handler budget; no additive full-timeout assumption is used. The fast Worker path remains on its existing budget.
- Rationale: The accepted native-only API matrix is 5/5 acquisition PASS, with the known positive worst observed latency of approximately 14,352 ms. Supadata must therefore run before npm and admit that latency after the cheap pre-existing VPS attempt. HTTP 206/native unavailable continues the chain without overwriting an earlier typed provider/acquisition failure; provider, timeout, network, malformed, and empty outcomes remain typed and are not mislabeled as no captions.
- Deployment boundary: `vercel.json` is intentionally unchanged because the repository cannot prove the deployed project/runtime mode or the need for an explicit function duration. The application budget is implemented locally; deployed Fluid/runtime duration and environment binding still require deployment-time verification. No production configuration was changed.
- Validation: focused transcript Vitest files passed 55/55; typecheck, production build, and targeted ESLint passed. The mocked delayed Study flow rendered captions after the old 8,000 ms boundary in 14.2 s, with no `allowAsr=1` request and no Generate Transcript/ASR state. The Playwright command then timed out during runner/webServer cleanup, so the E2E harness is validation-layer BLOCKED while the behavior assertions are PASS. No provider request, commit, push, or deploy occurred.

## ECHO-20260905-1720 - Supadata native fallback budget gate

- Do not ship a post-npm Supadata native fallback with a 2,500 ms timeout. The authenticated native-only matrix measured a known-positive Shape of You response at approximately 14,352 ms, while the current caption-only Vercel caller allows 8,000 ms and the existing Vercel chain already reserves up to 1,000 ms for VPS plus 6,500 ms for npm.
- This is a product/architecture gate, not evidence of Supadata failure. Any future integration must first choose between increasing the Vercel caller/server budget and selecting a provider order that can admit the measured latency, likely Supadata before npm, or preserving the current latency budget and deferring Supadata.
- The local implementation/test draft was removed; no source integration, tests, commit, push, deploy, or production mutation resulted from this task.

## Default project collaboration policies

### Research first; do not reinvent

For generic technical problems, third-party/platform/provider/browser/network behavior, issues likely to require repeated experiments, and mature or common functionality, investigate official documentation, known issues and changelogs, active GitHub projects/issues/discussions, maintainer comments, recent community cases, and mature open-source implementations before extended local trial-and-error. Use that external evidence to form a hypothesis, then validate it with the smallest useful EchoLearn A/B. Reuse mature patterns or components when appropriate instead of rebuilding them. This is a default project rule, not a YouTube-specific lesson.

### Edge-case and test-value stop rule

A new issue blocks a milestone only when it reproduces in real execution, is proven by a deterministic test, violates a defined acceptance or safety invariant, creates realistic destructive/corruption/wrong-state/privacy risk, or breaks an accepted workflow. Otherwise record it as backlog or follow-up and continue higher-value work. Speculative reviewer observations and theoretical corner cases are not automatic blockers. Every additional test or review must have a clear hypothesis, acceptance criterion, regression, or release-decision purpose; stop when further testing will not change the engineering decision.

### Active-goal scope discipline

Once the active goal, root cause, and acceptance criteria are sufficiently specific, every subsequent investigation, test, read, or edit must serve a clear current hypothesis, acceptance criterion, regression, or safety purpose. Unrelated historical rollout or memory reading, speculative edge-case exploration, repeating stable tests, and polishing unrelated paths are scope drift; the supervisor should redirect or interrupt work that no longer advances the bounded goal. History remains appropriate at task start or recovery, and when a concrete current hypothesis requires it. This guard prevents token/time waste, accidental scope expansion, stale-context fixation, misleading progress, and risk to unrelated dirty work.

## D-008 - Bootstrap-aware Linux M7 gate remains unaccepted

- Date: 2026-09-04
- Status: ACTIVE
- Decision: A natural anonymous first-party YouTube guest bootstrap is a valid bounded pre-navigation step for the Linux/Xvfb browser-native path, but it did not change M7 `PLAYER_BLOCKED` / `LOGIN_REQUIRED`. Treat this as server/egress/video evidence for the validation axis; do not continue same-host identity/flag or yt-dlp/session-token tuning without a new explicit decision.
- Rationale: The same headed/Xvfb, loopback-CDP, fresh-profile runner independently completed bootstrap, collected valid telemetry, blocked media, and cleaned its process tree/profile. The unchanged M7 result is therefore not evidence of a generic browser harness failure, while the required two-positive real-service gate remains unaccepted.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-006 - Browser fallback remains an isolated gated seam

- Date: 2026-09-04
- Status: ACTIVE
- Decision: Browser-native caption acquisition is represented by a disabled-by-default local contract/adapter. It may trigger only for typed provider/network transport failures, operates as a single-flight single-slot primitive, and writes only validated structured success to a separate browser-provider cache namespace. It is not wired into the current production acquisition cascade until the later isolated Linux/Xvfb host gate passes.
- Rationale: Preserve existing caption/no-caption/ASR semantics while making cancellation, deadline, stale-response, resource, cleanup, and cache behavior testable before introducing a real browser service.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-002 — Caption-first acquisition and explicit recovery

- Date: 2026-09-01
- Status: ACTIVE
- Decision: Caption acquisition remains caption-first and caption-only by default. Paid or ASR paths require explicit opt-in and authorization. Typed provider timeout and captions-not-found outcomes remain distinct.
- Rationale: Preserve the ordinary fast path, user control, and honest failure semantics.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-003 — Validation layers remain separate

- Date: 2026-09-01
- Status: ACTIVE
- Decision: Local implementation/tests, real-provider checks, and production user-flow validation are separate evidence layers. Passing one layer does not imply that the others passed.
- Rationale: Prevent local or provider evidence from being presented as production acceptance.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-004 — VPS deployment verification

- Date: 2026-09-01
- Status: ACTIVE
- Decision: Deploy a VPS candidate via SCP and atomic replacement, then verify the active file and service. Do not rely on a GitHub raw-file fetch as the deployment source.
- Rationale: Make the deployed candidate identifiable and reduce stale-source risk.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-005 — Requested-language semantics

- Date: 2026-09-01
- Status: ACTIVE
- Decision: The requested language is preferred. If it is unavailable, an available-language fallback may be returned with honest language metadata; the request must not be silently redefined as strict language-only selection.
- Rationale: Preserve useful captions without misrepresenting their language.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-007 - Orchestration is opt-in and upstream-preserving

- Date: 2026-09-04
- Status: ACTIVE
- Decision: The browser fallback orchestration controller remains a local, mockable, disabled-by-default seam. It delegates eligibility, validation, single-flight, cancellation, deadline, and stale-response behavior to the adapter; normal-provider success and definitive semantic failures pass through without browser or cache calls. Only validated browser success may produce a separate browser-provider cache decision.
- Rationale: Prove end-to-end routing semantics before introducing a real browser executor, while preserving the accepted production cascade and caption/no-caption/ASR truth boundary.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-009 - Test egress class before browser-service integration

- Date: 2026-09-04
- Status: SUPERSEDED
- Decision: Retain option A as the first browser-fallback architecture candidate, but do not integrate it or purchase infrastructure until one contract-permitted rotating residential/ISP egress class is tested with the existing headed/CDP/media-blocked flow. Use one sticky exit for each fresh browser job; rotate only between independently bounded jobs.
- Rationale: Local residential headed Chrome succeeded on M7 while the separate Linux datacenter host remained `LOGIN_REQUIRED` after guest bootstrap, and public project reports support a cloud-IP hypothesis without providing a reliable success rate. A controlled egress change preserves observability and media blocking; BaaS and transcript vendors add provider-policy, retention, and opaque-upstream risks that require their own capability evidence.
- Guardrails: no login, imported cookies, CAPTCHA solving, audio/ASR, raw URL/session persistence, browser-first routing, or same-host identity/flag/yt-dlp tuning. Bright Data residential is not a candidate while its current AUP prohibits streaming-related domains.
- Supersedes: None recorded.
- Superseded by: D-012; the residential/ISP experiment is outside the current supervisor execution boundary and is not authorized by this decision record.

## D-010 - Pre-purchase residential egress candidate gate

- Date: 2026-09-04
- Status: SUPERSEDED
- Decision: Use IPRoyal rotating residential as the first candidate for the one new-egress capability probe, subject to written confirmation that this exact YouTube automated headed-browser, caption-only, media-blocked use is allowed and subject to acceptable retention/logging terms. Use one sticky exit for the natural guest bootstrap plus watch request. Decodo rotating residential is the backup only after its documented streaming restriction is explicitly cleared; Webshare is a further compliance-gated alternative.
- Rationale: IPRoyal's reviewed public AUP did not expressly prohibit streaming and its product docs expose the needed protocol, geography, sticky-session, and high-end-pool controls, while Decodo/Webshare/Oxylabs publicly classify streaming as restricted. No candidate has supplied audited M7 evidence, so policy fit is only a pre-purchase screen and the real test must remain one fresh bootstrap-aware M7 run with media blocked.
- Guardrails: no purchase or proxy traffic before provider approval; no embedded credentials, logs, cookies, login, CAPTCHA, PoToken, audio/ASR, yt-dlp tuning, or raw URL/session persistence; use the local proxy seam only; reject authenticated SOCKS5 unless a separately reviewed secure mechanism is designed; preserve the existing production-disabled browser boundary.
- Supersedes: D-009 only for historical candidate ordering; its one-new-egress guardrails are not an active authorization.
- Superseded by: D-012; no residential proxy/Proxy-Cheap purchase, traffic, or anti-bot/Login-required experiment is authorized under the current boundary.

## D-011 - Privacy-safe transcript outcome measurement

- Date: 2026-09-04
- Status: ACTIVE
- Decision: Any future aggregate transcript reliability event is limited to `outcomeCode`, `cacheState`, `latencyBucket`, `authState`, and `retryUsed`. `cacheState` is one of `HIT`, `MISS`, `BYPASS`, or `UNKNOWN`; latency is bucketed and never recorded as a raw duration. The event must exclude URLs, video IDs, transcript text, user-entered content, upstream bodies, cookies, tokens, and raw provider payloads.
- Rationale: Cycle 2 needs comparable cache-aware outcomes without creating a content or request-identity telemetry stream. The local pure helper is accepted now; remote analytics wiring remains deferred until the emission point can supply cache/auth/retry state unambiguously and a bounded privacy/product review authorizes the behavior.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-012 - Two-window no-VPS subtitle reliability gate

- Date: 2026-09-04
- Status: ACTIVE
- Decision: Local native-caption success does not equal production success, and fixed or cached controls do not prove fresh acquisition. Keep the current recommendation **NO VPS**; the current next path is no-VPS measurement and source-level/root-cause work. Reopen fallback R&D only after two distinct low-volume, no-VPS bad windows on independently YouTube-confirmed, fresh caption-positive controls. Count a bad window only for technical acquisition failures such as `provider_timeout`, `provider_failure`, network failure, or upstream 5xx; `captions_not_found` is not a technical bad-window failure when native captions were confirmed. If a later window recovers strongly, continue observation rather than create infrastructure. Any production browser fallback or other fallback-service choice requires a separate newly authorized product/safety decision and gate; it remains unintegrated.
- Rationale: Avoid overreacting to one hard-video or transient window and avoid infrastructure churn while preserving a measurable escalation path. See the ECHO-20260904-2235 and ECHO-20260904-2325 entries in `PROGRESS.md` and `TEST_REPORT.md` for the bounded matrices and evidence boundaries.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-013 - Caption Diagnostics V1 stays privacy-safe and browser-local

- Date: 2026-09-05
- Status: ACTIVE
- Decision: Caption successes carry optional raw provider provenance and privacy-safe Supadata attempt outcome through the existing response/session paths. Study translates the raw source exactly once. The UI may show a compact this-browser estimate of Supadata attempts and likely credits, backed by optional localStorage aggregate fields; it must not present the estimate as billing truth or global usage.
- Rationale: Source provenance distinguishes `supadata`, `vps`, `npm`, and existing native/Worker paths, while an attempt outcome remains visible when Supadata fails and a later provider succeeds. Optional session fields preserve old saved sessions without migration. The local aggregate adds useful owner visibility without new cloud infrastructure or content telemetry.
- Guardrails: exclude API keys, URLs/video IDs, transcript text, raw upstream payloads, cookies, tokens, and account data. Preserve provider order, deadlines, latest-request-wins behavior, and the explicit ASR boundary; Caption Diagnostics never invokes ASR or Generate.
- Supersedes: None recorded.
- Superseded by: None recorded.

## D-014 - Caption Diagnostics V1 release boundary

- Date: 2026-09-05
- Status: ACTIVE
- Decision: Accept Caption Diagnostics V1 with the existing Supadata native provenance release. Production deployment is driven by the existing GitHub-to-Vercel path; no direct Supadata validation is required for this UI/provenance release when it would consume a credit. Production static artifacts must contain the diagnostics markers, while interactive Study validation remains separately attributable to account/guest access state.
- Rationale: Commit `98607b4` passed the existing focused/local validation and its Vercel deployment check completed successfully. The public StudyPage artifact contains the new diagnostics markers. A disposable production browser context reached the authentication gate; its API/provider routes were blocked and therefore could not establish an authenticated Study/session flow without introducing account access or provider traffic.
- Guardrails: Do not treat static bundle presence as proof of a live Supadata request or billing decrement. Do not read secrets, use direct Supadata requests, or bypass authentication. Preserve the local validation-layer limitation in release records.
- Supersedes: None recorded.
- Superseded by: None recorded.
