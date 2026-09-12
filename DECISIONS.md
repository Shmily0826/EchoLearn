# EchoLearn Decisions

This file retains durable architecture, product, and operational decisions with explicit `ACTIVE` or `SUPERSEDED` applicability. The current summary wins when applicability differs; historical records remain for traceability. This is not a progress log or test report.

## CURRENT DECISION SUMMARY — 2026-09-12

- `PROGRESS.md` is authoritative for current status; `TEST_REPORT.md` is authoritative for validation evidence; this file is for durable decisions. Historical execution records remain traceable in the dated sections.
- The current non-ASR subtitle architecture is the accepted Option B boundary: same-origin Vercel (`VPS → Supadata → npm`) handles the normal caption path; the Cloudflare Worker is an explicit ASR opt-in path. Earlier Worker-first, synchronous-probe, and subtitle-budget `NEXT` text is historical, not a new implementation request.
- Dictionary reference consistency is **PRODUCTION ACCEPTED** on exact SHA `5094c66c63018dd5a8cb0d39837528d0842c34c7`. Its acceptance smoke used local `/api/dictionary` fixtures and observed zero paid/provider outbound traffic; this does not establish billing truth.
- No proven high-value engineering bug is currently active. Current evidence-dependent follow-up is limited to Supadata cost/billing review, Invidious/Piped health/pruning, and low-priority consolidation leftovers. A real learning-session UX milestone is only a recommended future product-selection direction until explicitly accepted.

## D-001 — Documentation source-of-truth ownership

- Date: 2026-09-01
- Status: ACTIVE
- Decision: `PROGRESS.md` is the current project-status source; `TEST_REPORT.md` is the validation-evidence source; this file contains active durable decisions; `.workbuddy/memory/YYYY-MM-DD.md` contains historical engineering journals; task handoffs contain per-task state.
- Rationale: Keep current status, validation evidence, durable rules, and historical investigations separate and easy to audit.
- Supersedes: None recorded.
- Superseded by: None recorded.

## HISTORICAL ECHO-20260905-2125 - User-reported Production secret status

- Date: 2026-09-05
- Status: HISTORICAL / UNVERIFIED
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

## D-012 - Two-window no-VPS subtitle reliability gate (HISTORICAL / SUPERSEDED)

- Date: 2026-09-04
- Status: SUPERSEDED
- Decision: Historical gate only. Local native-caption success did not equal production success, and fixed or cached controls did not prove fresh acquisition. Its former **NO VPS** recommendation and no-VPS next path are superseded by the later accepted Option B non-ASR architecture; the browser fallback remains unintegrated unless separately authorized and gated. The original two-window measurement criteria remain historical evidence, not current scope.
- Rationale: Avoid overreacting to one hard-video or transient window and avoid infrastructure churn while preserving a measurable escalation path. See the ECHO-20260904-2235 and ECHO-20260904-2325 entries in `PROGRESS.md` and `TEST_REPORT.md` for the bounded matrices and evidence boundaries.
- Supersedes: None recorded.
- Superseded by: Accepted Option B non-ASR architecture recorded in `PROGRESS.md` and `TEST_REPORT.md` under the 2026-09-07 entries.

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

## ECHO-20260908-2333 - Caption cost baseline V1

- Date: 2026-09-08
- Status: ACTIVE
- Decision: Amend D-011's remote-wiring defer for this explicitly authorized bounded baseline. The same-origin `/api/transcript` function emits a narrow JSON metric stream with unique `caption_backend_request`, `caption_provider_attempt`, `caption_provider_result`, and `caption_final_result` event values. Its only permitted fields are `event`, `provider`, `outcome`, and `finalProvider`; backend request is emitted once for each valid normal caption Function execution, provider attempt/result cover VPS, Supadata, and npm at their actual call boundaries, and final result records the final provider or `none`.
- Semantics: Estimated fresh Supadata calls equal emitted `caption_provider_attempt` records with `provider=supadata`; this is a Function-execution/provider-call estimate, not page views, final source labels, or billing truth. Vercel CDN `x-vercel-cache` HIT/MISS is platform-observable only: a CDN HIT bypasses the Function, so cache-served counts are unavailable from application metrics. No client telemetry or database was added.
- Privacy and behavior: Metric payloads contain no trace ID, video ID, URL, transcript text, user ID, IP, cookie, token, or upstream payload. Existing trace/diagnostic logs remain unchanged. Provider order, timeouts, retries, caching, quotas, ASR policy, and Worker/VPS behavior are unchanged.
- Supersedes: D-011 only for the explicitly authorized remote-wiring defer; D-011 privacy guardrails remain active.
- Superseded by: None recorded.

## ECHO-20260909-2106 - P1A DictionaryReference semantic contract

- Date: 2026-09-09
- Status: ACTIVE / LOCAL VERIFIED
- Decision: Keep legacy `DictionaryEntry` fields for compatibility and attach an additive typed `DictionaryReference` at the dictionary service boundary. The reference records queried form, known lemma, provider, source/display languages, translation status, and per-sense source/display text.
- Semantics: Backend responses carry normalized English `source_text` beside legacy translated `definition`; client fallback uses `fallback-en` for non-English targets, while English-target results use explicit `source` status. Missing source text remains `null` rather than being inferred from translated display text.
- Cache: Dictionary cache v5 stores the reference; v5 entries without it are deterministically reconstructed on read. v4 is not resurrected or migrated.
- Boundaries: No Popup, Chinese cleanup, lemma architecture, vocabulary save-pipeline, production, commit, or push change is included.
- Supersedes: None recorded.
- Superseded by: None recorded.

## ECHO-20260911-1833-DOCS-SYNC - Conservative learner meaning and ECDICT evaluation boundary

- Date: 2026-09-11
- Status: ACTIVE / SOURCE VERIFIED
- Decision: Keep learner meaning ordered as **context-ai → quick-gloss → compact dictionary gloss → unavailable**. Do not promote long generic machine-translated dictionary prose into the learner-facing or saved Chinese meaning. Keep the conservative compactness guard as a safety net until better evidence or provider gloss metadata exists; confine English source text to the collapsed dictionary-reference layer when the translated gloss is withheld.
- Rationale: Commits `036057c` and `72e0e10` show that reusing long translated dictionary prose produced translationese in the learner meaning/save path. The hardening commit records `dictionary-translation-not-compact` and adds a saved-word positive control.
- Evaluation boundary: Commit `5ec799a` adds offline ECDICT surface/lemma/context tooling and an opt-in AI comparison harness. ECDICT is useful lexical candidate evidence but its raw translations are noisy and not ground truth. No tracked comparison output proves a quality lift from injection, so do not integrate it into runtime meaning selection or generalize beyond the tested offline sample.
- Reference consistency milestone: Pushed commit `8462641236fc5efb6d90939e8cc045f6ad0c6935` (`Keep dictionary reference meanings consistent`) is the current release. It keeps fully translated references in the requested display language and omits source-less rows from mixed-language references; it does not change learner-meaning priority or add ECDICT to runtime selection.
- Resolution: Resolved and closed by pushed commit `8462641236fc5efb6d90939e8cc045f6ad0c6935`; this reference-consistency issue is not a current blocker.
- Supersedes: None recorded.
- Superseded by: None recorded.

## ECHO-20260911-ANALYTICS-TEST-EXCLUSION - Explicit test traffic analytics suppression

- Date: 2026-09-11
- Status: ACTIVE / PRODUCTION ACCEPTED
- Decision: Suppress Vercel Web Analytics and Firebase custom events only when `sessionStorage['echolearn_test_traffic'] === '1'`. `?dogfood=1` sets that session marker before app render and removes only `dogfood` with `history.replaceState`; no localStorage, UA, webdriver, auth, Firestore, or other product behavior changes.
- Automation: Keep marker installation opt-in through `page.addInitScript`; the current Playwright config is local-only and does not target Production.
- Release: Analytics implementation commit `ac95f39b067e0a4cf8046d2b7db56bacc580b6d5`; build-gate repair commit `3dd523c075d172ca17c2d628cf97d2783ab35922` was the released repair SHA and matched `origin/main` at Production acceptance.
- Evidence: GitHub Actions `test` and `e2e` succeeded for the exact repair SHA, and the Vercel Production deployment succeeded.
- Production acceptance: `https://echo-learn.uk/?dogfood=1&foo=bar` set the session marker and cleaned to `https://echo-learn.uk/?foo=bar`; the same session stayed suppressed, a fresh context was unsuppressed, and observed traffic had zero Vercel Analytics, Firebase/GA Analytics, product, or provider requests.
- Boundary: Dogfood is analytics suppression only; it does not authorize Production Firebase/Auth/Firestore mutation, product API traffic, paid/provider traffic, ASR, or other side effects. Sentry remains separate and out of scope.
- Governance: Canonical deployed-browser validation rules are recorded in `docs/TESTING.md`.
- Supersedes: None recorded.
- Superseded by: None recorded.
