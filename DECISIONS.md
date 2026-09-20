# EchoLearn Decisions

This file retains durable architecture, product, and operational decisions with explicit `ACTIVE` or `SUPERSEDED` applicability. The current summary wins when applicability differs; historical records remain for traceability. This is not a progress log or test report.

## CURRENT DECISION SUMMARY — 2026-09-13
- `PROGRESS.md` is authoritative for current status; `TEST_REPORT.md` is authoritative for validation evidence; this file is for durable decisions. Historical execution records remain traceable in the dated sections.
- **Accepted milestones:** `AI_AUTH_COST_BOUNDARY_V1`, dictionary reference consistency, the Option B/Supadata Vercel-first non-ASR subtitle boundary, and the YouTube route-leave regression remain accepted at their recorded evidence levels. Lemma provenance remains **STALE / NOT A BUG**.
- **Production AI authority:** current primary is Gemini (`AI_PROVIDER=gemini`), manually verified in the Vercel Dashboard for Production scope on 2026-09-13. `GEMINI_MODEL` and `GEMINI_API_KEY` are configured in Production; no secret value is recorded. Production deployment `ff8f5b7` is **READY**.
- **Provider compatibility decision:** the DeepSeek V4 refresh in `2146c74` is fallback/provider-compatibility work, not a change to the active Gemini primary. The earlier authenticated Production smoke that observed DeepSeek remains historical evidence.
- **Study context continuity:** `STUDY_CONTEXT_CONTINUITY_V1` is **LOCAL VERIFIED** and deployed in `ff8f5b7`, but its bounded Production behavioral smoke remains **UNVERIFIED / PARTIAL** because tooling could not safely seed a synthetic session or install network interception. No Production behavioral acceptance is claimed.
- **Auth-gated capability testing (2026-09-16):** AI Analyze, bulk translation and authenticated persistence cannot be reached by the guest E2E suites by construction. Cover them in two layers: an intercepted-identity fixture in CI, plus a manual on-demand run against a real dedicated test account. See D-009 for the boundary.
- `REAL_LEARNING_SESSION_UX_V2` is the next substantive product-direction candidate, not yet accepted implementation scope.
- No proven high-value engineering bug is currently active. Current evidence-dependent follow-up remains limited to Supadata cost/billing review, Invidious/Piped health and pruning, and low-priority consolidation leftovers.
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

## D-009 - Auth-gated capabilities are tested in two layers

- Date: 2026-09-16
- Status: ACTIVE
- Decision: Every AI-gated capability (Study Analyze, Vocabulary/Sentences bulk translation, authenticated learning-data persistence) sits behind one identity boundary that the guest E2E suites cannot cross: `AuthContext`'s `user` derives solely from Firebase `onAuthStateChanged`, guest mode only sets `localStorage['echolearn_guest_mode']` and never a user, and `api/ai.ts` rejects unauthenticated requests with 401 before any provider call. Cover these capabilities in exactly two layers:
  1. **CI regression, intercepted identity.** Fake the Firebase Auth REST responses at the network layer so the real client SDK commits a signed-in state, and route-mock `/api/ai` to a fixed fixture. This is deterministic, spends nothing, writes no Production data, and covers the full UI behaviour (panel render, CEFR range, save flows, failure states, out-of-order responses).
  2. **Manual on-demand end-to-end, real identity.** A dedicated test account, real provider call, real output judged against a quality rubric. Never in CI.
- Rationale: The alternative of relaxing the identity boundary to make these flows guest-testable would remove the deliberate protection that keeps unauthenticated requests from spending provider keys. The alternative of a Firebase Auth emulator does not work here: `api/_shared/firebaseAuth.ts` verifies RS256 against Google's public JWKS directly (no `firebase-admin`), so an emulator-signed token fails validation, and supporting it would mean changing production authentication code for test convenience.
- Cost boundary: provider cost is not the limiting factor and should not be treated as one. `gemini-3.5-flash-lite` is $0.30/1M input and $2.50/1M output; with the transcript capped at 12000 characters by `smartTruncate` and output capped at 4096 tokens, one Analyze call is roughly $0.008. `aiAnalysis.ts` additionally stores results in a shared Firestore `aiAnalyses` cache keyed by transcript hash with a 30-day TTL, so a repeated analysis of the same video costs nothing. The binding constraints are identity, rate limits (10/minute, 100/hour), model non-determinism, and keeping Production data clean.
- Consequence for test design: because AI output is non-deterministic, provider-quality scoring is a report from layer 2, never a CI assertion. Cache HIT means a layer-2 run can silently stop exercising the provider, so a provider-quality run must confirm it actually missed the cache.
- Supersedes: None recorded.
- Superseded by: None recorded.

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

## GUEST_AI_COST_BOUNDARY_V1 - /api/ai authenticated trust boundary

- Date: 2026-09-12
- Status: ACTIVE / PRODUCTION ACCEPTED (2026-09-13; deployed as `391a08e` + `962f613`)
- Decision: `/api/ai` now requires a verified Firebase ID token (`Authorization: Bearer`, RS256 against Google's public JWKS) BEFORE any provider fetch; unauthenticated requests get 401 and can never spend DeepSeek/Gemini quota. Origin/CORS/per-IP rate limiting remain hardening only, not identity. Client-side, AI enrichment is an authenticated-only capability: Guest save (`enrichVocabularyItem`) and Vocabulary/Sentences auto-translate skip the AI translation path and keep the non-AI fallbacks (dictionary reference meaning, quick gloss); saving never fails for guests. Authenticated users keep existing AI behavior (token attached by `src/services/apiAuth.ts`).
- Evidence: `DICTIONARY_LANGUAGE_AI_GATE_REPRO_V1` proved Guest saves fired `POST /api/ai` (DeepSeek) through `translationService.translateWord`, with no authentication anywhere on the path; language-race hypothesis disproven 5/5. Production acceptance evidence (2026-09-13): anonymous 401 probes, fresh-Guest journey with `/api/ai` = 0, authenticated positive path — see `TEST_REPORT.md` 2026-09-13 and `AI_AUTH_COST_BOUNDARY_V1` below.
- Implementation: `api/_shared/firebaseAuth.ts` (new verifier, no firebase-admin), `api/ai.ts` 401 gate, `src/services/apiAuth.ts` + three AI services, `vocabularyEnrichment.ts` `aiTranslationEnabled` flag (default false = fail-closed), StudyPage/VocabularyPage/SentencesPage/WordDictionaryPopup gating.
- Deploy note: project id falls back to the public bundled `echolearn-9f369` config value; override with `FIREBASE_PROJECT_ID`/`VITE_FIREBASE_PROJECT_ID` env if desired. No secret env required.
- Boundary: No seek-before-ready, Review hierarchy, UX copy, or other polish changes are included.
- Supersedes: None recorded.
- Superseded by: None recorded.

## AI_AUTH_COST_BOUNDARY_V1 - Authenticated positive-path production acceptance

- Date: 2026-09-13
- Status: ACTIVE / PRODUCTION ACCEPTED
- Decision: The AI auth cost boundary is accepted at all three validation layers on Production: (1) anonymous `/api/ai` → 401 before body validation and provider fetch; (2) fresh Guest learning journeys complete with `/api/ai` attempts = 0 (request-level evidence); (3) the authenticated positive path — browser `getIdToken()` Bearer → server JWKS verify → real DeepSeek 200 → usable UI result — is verified for transcript Analyze and vocabulary AI enrichment. AI remains an authenticated-only capability; guests keep the full non-AI learning path.
- Evidence: `TEST_REPORT.md` section "2026-09-13 - AI_AUTH_COST_BOUNDARY_V1 production acceptance" (three real provider calls total this cycle; transient empty-stream fallback observed once and classified as designed degradation, backlog copy note).
- Boundary: Vercel function logs were not read (no safe sanitized access this cycle); provider billing truth remains out of scope. No source changes were made in this acceptance cycle.
- Supersedes: None recorded.
- Superseded by: None recorded.
## 2026-09-18 — Local Git corruption recovery rule
- For a corrupted local .git when remote main is independently trusted, prefer fresh clone → integrity/build validation → reversible path swap over increasingly destructive in-place repair.
- In this Windows/Codex environment, do not use git stash for temporary regression verification. Prefer file copies or git show HEAD:<path> with guaranteed restoration.
- If rename/delete unexpectedly fails, check open handles before assuming ACL/permission failure. In this incident WorkBuddy.exe PID 25992 held D:\CODE\project\EchoLearn\src\services\__tests__.
- Keep the damaged checkout backup until the user later decides whether the three local-only branch SHAs (8a607c6, 4dfc720, b5cf7bd) are worth attempting to recover from non-Git sources.

## ECHO-20260918-E2E-VISIBILITY-AND-FALSIFICATION - Two durable E2E rules
- Date: 2026-09-18
- Status: ACTIVE
- Decision 1 — every page-wide Playwright assertion in this app must be visibility-scoped. `src/App.tsx` keeps each visited route mounted under `display:none` so returning to a page preserves its state, which means an unscoped query can match a copy the learner cannot see. The failure direction is a **false PASS**, not a flake: the buggy element is real, present, and hidden. Use `.filter({ visible: true })` (or a component-scoped test id) on any `getByText` / `locator` that could exist in more than one mounted route or in both the `lg:hidden` and desktop transcript copies.
- Decision 2 — falsify per guard, not per test. When one fix has several render sites, a single "revert everything and watch it go red" run does not prove each site is protected; one guard can be carrying the other. Restore each pre-fix condition individually and require a distinct failing assertion line every time.
- Evidence: `e2e/study-ai-authenticated.spec.ts` — "a suggestion the aligner cannot place never becomes a @0:00 the learner can click" (spec 11/11 desktop-chromium, `npm test` 648/648, `tsc -b` clean, `eslint` 0 errors / 12 warnings). Reverting only `src/pages/SentencesPage.tsx:457` reddened spec line 362; reverting only `src/components/study/SentenceList.tsx:45` reddened spec line 372. Detail in `TEST_REPORT.md` under 2026-09-18.
- Boundary: Decision 1 is a rule about assertions, not about the mounting strategy — keeping routes mounted is unchanged and still deliberate. The player-side seek jump remains outside these rules (no real media in this suite; it stays verified on Production by `npm run ai:seek-smoke`).
- Supersedes: Nothing. The visibility requirement was already practiced in `295cea3` (caption error card) and in `e2e/study-ai-authenticated.spec.ts`'s `visibleTranscriptScrollTop` helper; this is the first time it is written down as a rule after two near-misses.
- Superseded by: None recorded.

## 2026-09-19 — Campaign decisions (worktree agent/overnight-20260919)

- **YouTubeEmbed fix = dependency-array change, not a remount.** Alternatives were
  keying the embed by videoId (tears down the keep-alive player on every video switch,
  regressing context continuity) or cueing from onReady via a mutable ref (more moving
  parts). Adding `status` to the effect deps is the minimal change that re-applies a
  pending switch exactly once, when ready.
- **Unverified logout = guest-equivalent, data kept.** Wiping local data on unverified
  sign-out would be silent data loss; blocking (status quo) deadlocks. `assertVerified`
  guarantees an unverified account has zero cloud data, so keeping device-scoped data
  cannot contaminate any cloud account, and it matches the landing page's promise.
- **Self-registered QA account used `@example.invalid`.** RFC-reserved, never
  deliverable, permanently unverified — exactly the state whose UX honesty the
  campaign needed to assert (and it exposed bug #2).
- **Did NOT spend the 3rd real-AI call.** The only uncached Analyze path required
  loading another uncached video (likely Supadata burn) for information that would not
  change the release decision (provider routing already flagged for user adjudication).
- **Bilibili scoped out of Journey A, then run as an honest-failure probe.** The spec
  listed Bilibili under permissions, not as a mandated journey; bilibili flow is
  mock-E2E-covered. The control-video probe still yielded evidence: the honest error
  card, zero `/api/ai`, and the ASR affordance left unclicked.
- **Unverified logout CORRECTED during closure review: clear at the boundary, not
  keep.** The follow-up Goal's A2 invariant (next verified login's auto-sync must not
  merge the previous account's data) exposed the keep-data variant as a C-class leak:
  the post-login sync reads localStorage, so A's items would reach B's cloud. Final
  behavior: the sync-before-logout guard stays gated on emailVerified (deadlock fixed),
  and `clearAllLocalData` is unconditional after a confirmed sign-out — restoring the
  documented account-boundary invariant. Trade-off: data created under an unverified
  session is lost at logout (no cloud copy can exist); accepted as consistent with
  existing verified-account semantics. A2 test falsified against the unsafe variant.
- **Supadata repeated-burn claim withdrawn.** Closure review of the cache headers
  (browser max-age=0 vs CDN s-maxage=3600 + SWR 86400) showed the "every load re-burns"
  statement conflated a browser revalidation with an origin acquisition; stale-while-
  revalidate serves the previous supadata payload under the same UI label. Proven
  credits: 2. Follow-up, not a release blocker.
- **Deterministic tests over flaky browser loops for the subtitle-recovery matrix.**
  The browser E2E already pins the alert path; empty-VTT / partial-SRT semantics are
  pinned in vitest where they cannot flake.

## 2026-09-19 — Real-learner interaction & recovery campaign decisions (worktree agent/real-learner-qa-20260919)

- **Cross-device local-audio re-import word duplication: DECISION POINT RECORDED, not fixed.**
  Reproduced live on QA Account A: the same word saved from two different re-import
  sessions of the same file yields two vocabulary items (dedupe key
  `(lemma|word)+sourceVideoId`; re-import mints a new session id each time). Two
  candidate fixes — (a) re-import resumes the original session id, (b) dedupe local-
  audio items by word + file title — both change accepted behavior (L9 resumed-vs-new
  and the meaning of `sourceVideoId`), so the campaign recorded the evidence and left
  the design choice to the owner.
- **Offline lazy-route crash classified dev-only after a layer check.** The route
  error boundary ("Something went wrong") fires in `vite dev` because dev has no
  service worker; the production build's precache serves unvisited lazy routes
  offline (proven on 127.0.0.1 preview and desktop headless). Deliberately NOT filed
  as a product bug; production HTTPS behaves like the preview.
- **Destructive-affordance adjacency recorded (D).** The route error boundary offers
  "Reload Page" next to a red "Clear Data & Reload"; a learner hitting a network
  hiccup could plausibly destroy local data. Changing the error-boundary affordance
  hierarchy is a product decision, so it was recorded, not patched.
- **Honest retraction.** An early P5 observation ("online save of 'preamble' was
  lost") was retracted after instrumentation showed the save landed within 300 ms;
  the loss was the campaign script racing the popup mount, not the sync path.
- **Emulator DNS left untouched.** Production dogfood from Android Chrome was
  harness-blocked (broken DNS via 10.0.2.3); fixing it would require modifying global
  Android network settings, which the goal forbids without necessity. Level 2 was
  achieved against the host production build instead.


## 2026-09-20 — Local-audio recovery & data-loss UX decisions (same worktree)

- **Restoring audio is not a new course (accepted decision implemented).** The
  missing-blob re-import entry now REATTACHES to the existing session. Identity
  boundary: `session.id` + `youtubeId` are the logical lesson identity;
  `localMediaId` is device-local Blob identity and MAY change on restore. The
  replacement Blob gets a fresh id; the old Blob is deleted only when
  unreferenced (`isLocalMediaReferencedByOtherSession`), so a same-device
  import can no longer strand another session's audio.
- **Filename-based dedupe REJECTED (deliberately, again).** Vocabulary dedupe
  stays `(lemma|word) + sourceVideoId`. Filename is not identity — the P5
  same-filename test proves two distinct lessons with one filename stay
  distinct. With restore preserving `youtubeId`, the duplicate-word mechanism
  from 2026-09-19 is closed at the identity boundary; historical duplicate
  records ("preamble"/"follows" x2 on QA Account A) remain as evidence and are
  NOT migrated.
- **Cloud-stripped transcript handling.** `stripSession` intentionally omits
  transcript fields from Firestore. Restore therefore lets the learner-supplied
  subtitle restore those fields, with an explicit UI note that the selected
  files reattach to THIS lesson. No content fingerprinting, no fabricated
  matching, no transcript sync expansion.
- **ErrorBoundary destructive contract.** Confirmation is rendered by the
  boundary itself (works while any route is broken), claims ONLY localStorage
  `echolearn_*` cleanup, and enumerates keys via `localStorage.key(i)` — the
  previous `Object.keys(localStorage)` idiom silently removed nothing in jsdom
  and was replaced during P0 (found by the new tests).
- **Firestore emulator on a campaign port.** Default port 8080 is occupied by
  the user's unrelated tunnel-client.exe (not killed); the rules suite ran via a
  temporary `--config` with port 8099. Default config untouched.


## 2026-09-20 — Learner entry / Review scheduling decisions (branch agent/learner-entry-review-correctness)

- **One definition of "due" for the whole app.** `src/utils/reviewSchedule.ts`
  owns it: due = `nextReviewAt > 0 && nextReviewAt <= endOfToday`, and the
  Dashboard count, the Review landing count, the completion-screen count, the
  Vocabulary and Sentences header "N due" / "Review (N)" links, and the actual
  session queue all derive from the same `collectReviewCards` / `selectDueCards`
  calls. Previously four predicates disagreed — three inside `ReviewPage.tsx`
  alone (one included `nextReviewAt === 0`, one used `now` instead of end-of-today,
  one ignored `> 0`) and one on each library page, which is what let a screen show
  a count the queue did not honour. Durable rule: a Review count is never computed
  beside its queue, and no screen computes it locally at all.
- **Mastered refreshers stay due (unchanged).** Accepted behaviour from the
  original design is preserved: a mastered card re-enters the queue when its
  long-term interval elapses. What changed is the WORDING: the button is
  "Review Every Saved Item" with the total-queue count, because the label
  "Review All Unmastered" described a queue it never built. Fix the label rather
  than silently narrow the queue.
- **`nextReviewAt === 0` on a non-mastered item means UNSCHEDULED, not
  mastered.** Manual adds now enter the normal first-review schedule
  (`tomorrowMs()`), matching every other save path. Legacy rows that still carry
  `0` are labelled "Not scheduled" and are never counted due anywhere; they are
  NOT bulk-rewritten at read time or in storage — repairing a display by
  mutating a learner's records is not a fix.
- **Learning-material actions are first-level on Study.** The single Local Audio
  importer sits above the transcript, not at the bottom of it, and Clear is
  offered whenever anything is on screen — including the deliberately
  unpersisted Sample Video. Two rejected shortcuts: creating a fake persisted
  session so the existing `session &&` gate would show Clear, and adding global
  storage to remember that the Sample was dismissed. Two importer instances are
  also rejected: the restore flow stays a separate `variant="restore"` affordance
  so it cannot compete with the import flow for the selected files.
- **Discoverability is asserted against the initial viewport.** A test that
  reaches a control by `data-testid`, or that lets Playwright scroll to it,
  proves the control EXISTS, not that a learner can FIND IT — which is exactly
  how 673 unit tests and 77 E2E tests missed both Study entry defects. New
  discovery assertions use role/name plus a bounding box above the fold, at
  1440x900 and 390x844.

- **An E2E spec may not depend on live third-party latency.** A campaign that saves
  words through the lookup popup was the last spec still falling through to the
  public Free Dictionary / Datamuse APIs, because `vite dev` has no
  `/api/dictionary` handler; it passed alone and dropped a save under full-suite
  load. Any spec that touches a provider-shaped route must stub it and abort the
  external fallback, so CI measures the app rather than the network.

## ECHO_AUTH_DATA_AND_AI_CACHE_SAFETY_V1 — deletion contract and AI cache trust boundary

- **Accepted account-deletion contract (order is the contract).** 1) prove
  identity by reauthentication, 2) delete cloud data with every failure
  propagated, 3) `deleteUser`, 4) purge the device. Firebase documents exactly
  this shape — a sensitive operation needs a recent sign-in and the recovery is
  "authenticate again, then call `reauthenticateWithCredential()`" — and states
  no numeric recency window, so none is claimed anywhere in the UI. The previous
  order (cloud wipe → local wipe → `deleteUser`) could destroy a learner's data
  and then fail, leaving the account alive.
- **The one non-atomic boundary is named, not papered over.** If cloud cleanup
  succeeds but `deleteUser` then fails, the account survives with the device's
  local data fully intact, so the learner can sign in, re-sync and retry. The
  reverse ordering would have left cloud documents no client can ever reach
  again. No cross-service "transaction" is claimed across Auth, Firestore,
  IndexedDB and GitHub, because none exists.
- **The deletion promise now matches the copy.** Device purge covers
  localStorage study data, both sync-marker sets, the GitHub PAT + gist id, and
  every persisted Local Audio Blob (`indexedDB.deleteDatabase`). Ordinary logout
  keeps its narrower semantics on purpose — it must not delete a learner's
  audio files or backup credential. README and the Settings hint now state the
  two real limits: the remote **Gist is not deleted** (only the local
  credential is), and pre-2026-09-20 flat feedback needs an administrator.
- **Feedback became deletable by nesting the uid in the path**
  (`feedback/{userId}/messages/{id}`). A rule cannot rescue documents whose ids
  the client never kept and could never list, which is why owner-delete alone on
  the flat collection was a dead end. `list` carries
  `request.query.limit <= 50` and the client mirrors it with `limit(50)` in a
  bounded loop, because Firestore rules can see `request.query.limit` but there
  is no documented `request.query.predicates` to assert an owner filter with.
  The flat create rule stays for backward compatibility with the deployed
  frontend and should become `if false` once this frontend ships.
- **Legacy flat feedback is an open gap with a provable boundary, not a
  completed fix.** The new flow deletes only `feedback/{uid}/messages/*`. The old
  flat documents cannot be reached by any client at all, so no rule change makes
  them deletable by their owner. What was established instead is that the
  historical set is *separable*: a collection-group query on `feedback` returns
  exactly the depth-2 legacy documents and never the current subtree (which lives
  in the `messages` group), verified in the emulator. So the cleanup is an
  administrator action with a safe procedure — enumerate and count, confirm
  `createdAt` is before the cutover, then delete by explicit id non-recursively —
  and one named hazard: `firebase firestore:delete /feedback` is recursive over
  `/feedback/{uid}/messages/*` and must not be used.
- **AI cache trust boundary: an owner-scoped subtree, and the legacy corpus
  frozen to read-only.** `aiCache/{writerUid}/analyses/{key}` is readable and
  writable only by its own verified session, so no other account can overwrite
  or pre-create what a learner is served. The old public `aiAnalyses/{key}`
  collection is now `read: true / write: false` at the rule level — nobody,
  legitimate or malicious, can add to it — **and the new client does not read it
  either**. Freezing it does not retroactively make it trustworthy: any signed-in
  or unverified client could previously write it, so its contents stay untrusted
  input, and serving them would reintroduce the poisoning path through the back
  door. It is deletable by an administrator as a collection group.
- **Learning-data cloud removal is one batched write, and that is a documented
  guarantee, not an assumption.** Firestore states a batched write is committed
  all-or-none ("either all of the operations succeed, or none of them are
  applied"), so the three sync documents plus the first feedback page either all
  go or none go; per-document `deleteDoc` was removed from this path and a test
  asserts it is never called. What batching does *not* cover is stated plainly:
  feedback beyond the first page goes in further batches (a later failure leaves
  learning data already gone and says so), and Firestore and Firebase Auth are
  still separate services.
- **The only-copy interlock, and the AC it exists because a client cannot
  satisfy.** If this device holds no copy of the cloud learning data, deleting the
  cloud documents would be irreversible the moment `deleteUser` fails afterwards,
  and no client-side ordering can undo that — so `deleteUserData` refuses with
  `no-local-copy` and the UI points at export or the device that has the data.
  **The strict acceptance criterion "no learner loses data merely because a
  deletion step fails" is therefore recorded as a design limitation of a
  pure-client design, not as solved**; closing it properly needs a trusted server
  (Admin SDK / Auth-triggered function), which is explicitly out of scope here
  rather than introduced quietly.
- **Rejected for the shared cache, with reasons.** Attaching `userId` to the
  document is not a boundary (anyone can write that field); create-only shared
  writes do not stop first-writer poisoning; and no documented privileged-writer
  pattern exists without the Admin SDK or Cloud Functions, because rules cannot
  validate a client-computed SHA-256 and server libraries bypass rules by
  design. Firestore TTL is console/gcloud-only and works per collection group,
  so it cannot prune legacy feedback without also pruning live submissions. The
  Delete-User-Data extension is deprecated (service closes 2027-03-31).
  **Consequence accepted:** cross-user cache HITs stop accruing — restoring full
  sharing is a decision that costs a new service-account credential, and it is
  listed as such rather than smuggled in.
- **Rules deployment order is part of the design, and the plan is an artifact.**
  Rules are deployed independently (`firebase deploy --only firestore:rules`,
  propagation up to ~10 minutes for active listeners). Ship the rules first: they
  only add two collections and freeze legacy cache writes, and the currently
  deployed frontend tolerates that freeze because its cache write is already
  best-effort/try-catch. Shipping the frontend first would break it — nested
  feedback and `aiCache` writes would be denied by the rules then live. Neither
  step may weaken `users/{uid}/data/*` isolation. Because a rules deploy cannot
  be listed back over the REST API for this project, "effective" is confirmed
  behaviorally (`scripts/verify-rules-propagation.mjs`, GET-only: `aiCache/...`
  answers 403 before Stage 1 and 404 after), and every deployable ruleset is a
  committed file with its own `--config` (`deploy/RULES_RELEASE.md`,
  `firebase.stage2.json`, `firebase.rollback.json`) plus a generator that refuses
  to emit Stage 5 unless it matches Stage 1 in exactly one anchor — no deployment
  may depend on someone re-typing rules from memory.
- **Reproduction evidence is transient by design.** The audit gap was
  demonstrated by running the committed emulator suite against the pre-change
  rules (an unverified session's write became the served content), then
  restoring the old file. The old rules are not committed as a fixture: a second
  copy of security policy would only be able to drift.
