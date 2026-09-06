# EchoLearn Caption Architecture Map

> Generated 2026-09-06 as part of the architecture consolidation programme (Phase 1).
> All `file:line` references are against `main` at `f51c1bc` plus the current working tree.
> This document is descriptive, not normative: source code is the source of truth.
> Companion documents: [CAPTION_ERROR_CONTRACT.md](./CAPTION_ERROR_CONTRACT.md), [CAPTION_BUDGETS.md](./CAPTION_BUDGETS.md).

## 1. YouTube caption pipeline (end to end)

```
User (StudyPage)
  │  Retry button (manual) ── useCaptionRequest (latest-wins lifecycle)
  ▼
fetchYouTubeTranscript()  src/services/youtubeTranscript.ts:1125
  │  in-flight coalescing keyed videoId:lang:asr (:1123)
  ▼
_fetchYouTubeTranscriptImpl()  :1001 — sequential cascade:
  │
  ├─ S0  Local proxy (opt-in)             :1010-1021  → local-proxy/server.js
  ├─ S1  Server APIs                      :758-930
  │     └─ Vercel /api/transcript         (same-origin; VPS → Supadata → npm)
  │        (Option B, 2026-09-07: the CF Worker is no longer probed for
  │         non-ASR captions — it serves only explicit ASR, Bilibili, and
  │         diagnostics; see docs/WORKER_FATE_DECISION.md)
  ├─ S2  Client InnerTube ANDROID→WEB     :490-540    (via proxyUrl)
  ├─ S3  Watch-page HTML scraping         :544-614
  └─ S4  Client npm youtube-transcript    :934-965
```

Proxy resolution `proxyUrl()` (:35-49): dev Vite `/yt-proxy` → prod `VITE_YOUTUBE_PROXY` → Vercel Edge `/api/yt`. When the Edge proxy is used, public CORS proxies (`api.allorigins.win`, `corsproxy.io`) are a last-resort transport (:58-62, :287-300).

Retry ownership: **fully manual**. No automatic cascade-level retry. The StudyPage Retry button (`StudyPage.tsx:1646-1654`, handler `:819`) re-invokes the whole cascade. ASR is a separate explicit action ("Generate transcript", `studyAsrRecovery.ts:6`, `StudyPage.tsx:860-890`) gated on `asr_required` / `recovery.canAsr`, and sends `allowAsr=1` which is served **only by the CF Worker** (`youtubeTranscript.ts:787`).

Deferred-error rule: Worker `provider_timeout` / `asr_required` outcomes are deferred (not thrown) so the Vercel endpoint still gets one chance (`youtubeTranscript.ts:857-928`, `:1046-1056`). This is load-bearing: a Worker 409 `asr_required` means the *Worker's own* caption stages are exhausted, not that all routes are.

Caption-content fetches retry up to 2× with 1500 ms delay across json3 → default → srv3 formats (`:83-84`, `:366-396`).

## 2. Server-side caption paths

### 2.1 CF Worker — `cf-worker/src/index.js` (2455 lines)

Routes (`index.js:428-441`): `/api/transcript`, `/api/bilibili`, `/api/audio`, `/api/info`, `/api/yt`, `/api/health`.

YouTube caption cascade inside `CAPTION_DEADLINE_MS = 11000` shared context (`:37`):

1. Cache read (caption-only; ASR/debug BYPASS) — `:472-485`
2. InnerTube ANDROID → IOS → WEB → TVHTML5 (`:1174-1281`), bounded 4000 ms slice (`:546-556`)
3. Watch-page scraping (`:559-568`, impl `:1339-1446`)
4. Invidious — 10 hardcoded instances, isolate-level health/cooldown map (`:1724-1840`)
5. Piped — 6 hardcoded instances (`:1848-1935`)
6. Outcome mapping (`:604-634`): deadline/timeout → 504 `provider_timeout`; provider failure without ASR capability → 502 `provider_failure`; otherwise 409 `asr_required` (if `YTDLP_API_URL` or `GROQ_API_KEY` present) else 404 `captions_not_found`.

ASR opt-in branch (`allowAsr=1`, `:493-538`): VPS `/api/asr` (75 s race) else Worker-side Groq Whisper (`:1948-2197`; audio via Piped → InnerTube adaptiveFormats → Invidious; 25 MB cap).

`/api/yt` forwarder `handleProxy` (`:1666-1716`): plain allowed-host YouTube forward; the Worker does **not** use the VPS in its YouTube caption cascade.

Dead-in-cascade code: `fetchViaInnerTubeGet` (`:1289`) is never called; `VPS_CAPTION_BUDGET_MS` (`:38`) is exported but unused on the YouTube path; `fetchViaYtDlp` is used only for Bilibili (`:746`).

### 2.2 Vercel /api/transcript — `api/transcript.ts` (658 lines, Node function)

Provider order inside `TRANSCRIPT_DEADLINE_MS = 21000` (`:23`), each provider clamped to remaining budget (`:161-163`):

1. VPS `https://yt-api.echo-learn.uk/api/transcript` (needs `YTDLP_API_KEY`) — 1000 ms (`:24`, `:556-568`)
2. Supadata `https://api.supadata.ai/v1/transcript` (needs `SUPADATA_API_KEY`) — 18000 ms (`:28`, `:570-591`); 206 → `captions_not_found`
3. npm `youtube-transcript` + CONSENT cookie — 6500 ms (`:25`, `:593-643`)

Final-failure arbitration `chooseFinalFailure` (`:385-408`): an earlier non-`captions_not_found` typed failure is preserved over a later Supadata 206. Function limit `maxDuration: 30` (`vercel.json:5`). Per-IP rate limit 20/60 s.

### 2.3 VPS — `vps-ytdlp/main.py` (2650 lines, FastAPI)

Endpoints: `/api/transcript`, `/api/info`, `/api/asr`, `/api/audio`, `/api/health`. X-Api-Key auth. Provider: yt-dlp (`YTDLP_TIMEOUT` default 180 s). Enforces the Worker-sent `X-EchoLearn-Caption-Budget-Ms` header (max 11000 ms, rejects larger with 400; `_caption_request_budget` `:183-200`). Client-disconnect cancellation returns 499 `client_disconnected`.

### 2.4 Other routes

- `api/yt.ts` (195 lines, Vercel Edge): generic allowed-host forwarder to YouTube/googlevideo/googleapis with InnerTube client headers; no timeout.
- `api/bilibili.ts` (176 lines): VPS proxy holding the key; 180 s general / 30 s short-link timeouts.
- Worker `/api/yt` (`handleProxy`) duplicates the `api/yt.ts` role without rate limiting or client-header emulation.
- `local-proxy/server.js` (418 lines): optional user-configured local proxy (npm → InnerTube ANDROID/WEB → watch-page).

## 3. Bilibili pipeline

Client `src/services/bilibiliTranscript.ts` → CF Worker `/api/bilibili` (15 s; 90 s with ASR) → Vercel `/api/bilibili` (30 s) → VPS (yt-dlp). English-gate: a Chinese-only (`ai-zh`) transcript is treated as no usable transcript (`main.py` `ECHOLEARN_BILI_ENGLISH_GATE`). Worker ASR for Bilibili mirrors the YouTube ASR branch.

## 4. Error classification

Nine wire-level codes and their owning surfaces are specified in [CAPTION_ERROR_CONTRACT.md](./CAPTION_ERROR_CONTRACT.md). Implementation sites (each independently defined — primary consolidation target):

| Site | Definition |
|---|---|
| Client YouTube | `TRANSCRIPT_ERROR_CODES` `youtubeTranscript.ts:707-713` |
| Client Bilibili | `BILIBILI_ERROR_CODES` `bilibiliTranscript.ts:21-28` |
| Vercel transcript | `TRANSCRIPT_FAILURE_CODES` `api/transcript.ts:90-97` + classifiers `:139-159`, `:237-242` |
| Vercel Bilibili | `BILIBILI_ERROR_CODES` Set `api/bilibili.ts:32-38` + `typedTranscriptError` `:41-70` |
| CF Worker YouTube | exception classes `:129-143` + outcome mapping `:604-634` |
| CF Worker Bilibili | `bilibiliErrorResponse` `:639-653` |
| VPS | exception → JSON mapping `main.py:2306-2341` |

Canonical module: `src/services/captionErrorContract.ts`, drift-pinned by
`src/services/__tests__/captionErrorContract.test.ts` (2026-09-06). The measurement
and browser-fallback vocabularies were archived with their modules; see
[CAPTION_ERROR_CONTRACT.md](./CAPTION_ERROR_CONTRACT.md).

## 5. Caching layers

| Layer | Location | Key / TTL |
|---|---|---|
| Worker transcript cache | Cache API `cf-worker/src/index.js:2276-2343` | `https://echolearn-cache.invalid/api/transcript?videoId&lang&v=1`, TTL 3600 s; exposed via `X-EchoLearn-Transcript-Cache: HIT/MISS/BYPASS` |
| Worker audio edge cache | `index.js:959-1043` | `ec_ver=AUDIO_CACHE_VER='3'`, `X-Cache: HIT/MISS` |
| VPS transcript cache | in-memory `main.py:2290-2292, :2351` | TTL 3600 s; separate ASR cache (`__asr__` key) |
| VPS audio cache | on-disk `audio_cache/` `main.py:402-406` | — |
| Client in-flight coalescing | `youtubeTranscript.ts:1123-1139` | Map, dropped on settle; not persistent |
| Client localStorage | diagnostics (`echolearn_caption_diagnostics_v1`), local-proxy failure marker (`echolearn_proxy_fail_at`) | not transcript caches |
| Browser-native (unwired) | `browser-native:v1` sessionStorage `browserTranscriptFallback.ts:11` | experimental only |

Rule to preserve: a cache HIT is never fresh-acquisition evidence; D-012 observation discipline depends on this.

## 6. Diagnostics / telemetry layers

1. **Source provenance**: `source` string on results (`local-proxy`/`supadata`/`vps`/`npm`/`youtube`/`asr`…), rendered once by `src/utils/captionSource.ts`, persisted on sessions (`src/utils/studySession.ts:69`).
2. **CaptionDiagnostics**: server emits `{supadata:{attempted,outcome}}` (`api/transcript.ts:178-190`); browser-local aggregate with credit estimate (`src/services/captionDiagnostics.ts`), shown in Study (`StudyPage.tsx:1326-1358`).
3. **Structured trace logging (server-only)**: Vercel `logTranscriptEvent`, Worker `traceLog` + `X-EchoLearn-Trace-Id`, VPS `_trace_event`.
4. **Health check**: `scripts/health-check.mjs` (live probes, cache-marker classification) + vitest-mocked mirror `src/services/healthCheck`.
5. **Unwired**: `transcriptOutcomeMeasurement.ts` (D-011 contract, only its own test imports it).

## 7. Unwired / experimental / dead inventory (consolidation candidates)

Consolidation status (2026-09-06): the experimental research artifacts below were
**archived to the local branch `research/architecture-consolidation-archive`**
(commit `b5cf7bd`); they are no longer in the main working tree. Restore them only
together with a real production consumer.

| Item | Status |
|---|---|
| `src/services/browserTranscriptFallback.ts` (537 lines) | ARCHIVED — disabled seam, was never imported by production |
| `src/services/browserFallbackOrchestrator.ts` (205 lines) | ARCHIVED — local-only controller over the seam |
| `src/services/transcriptOutcomeMeasurement.ts` (94 lines) | ARCHIVED — D-011 contract, no telemetry boundary consumed it; revive with the future reliability-baseline runner |
| `cf-worker/src/scrapingbee*.js` (3 modules + d.ts) | ARCHIVED — not imported by `index.js`; provider NO-GO (credits overdrawn) |
| Worker `proxiedFetch` (`index.js:1102-1147`) | Live but active only when `SCRAPE_API_KEY` is set (ScrapingBee/ZenRows gateway) |
| Worker `fetchViaInnerTubeGet` (`index.js:1289`) | Dead — never called (Phase 2 removal candidate) |
| Worker `VPS_CAPTION_BUDGET_MS` (`index.js:38`) | Dead export on the YouTube path (Phase 2 removal candidate) |
| Public CORS proxies (`allorigins`, `corsproxy.io`) | Live last-resort transport in the client cascade (Phase 4 trimming candidate) |

## 8. Duplication register

1. Caption parsing (json3/XML/VTT + entity decoding) implemented 4×: `youtubeTranscript.ts:178-247`, `cf-worker/src/index.js:1564-1662`, `local-proxy/server.js:281-358`, npm package.
2. Error taxonomy defined 8+× (see §4).
3. InnerTube/OuterTube client emulation in 4 codebases: client (`youtubeTranscript.ts`), Worker (`index.js`), Vercel Edge (`api/yt.ts`), local proxy.
4. Two `/api/yt` forwarders with slightly different guarantees (rate limit, client headers).
5. Bilibili error handling duplicated across client, Worker, Vercel, VPS.

## 9. Timeout / budget summary

Full table in [CAPTION_BUDGETS.md](./CAPTION_BUDGETS.md). Ownership in one sentence per layer:

- **Client** owns per-endpoint timeouts (Worker 12 s / 90 s ASR; Vercel 22 s) and caption-content retries.
- **Vercel handler** owns the 21 s overall deadline and per-provider clamping; `maxDuration: 30` is the platform ceiling.
- **Worker** owns its own 11 s caption deadline and per-provider slices; passes a budget header to the VPS for ASR.
- **VPS** owns yt-dlp's 180 s default but clamps to the forwarded caption budget (max 11 s) for captions.
- The caller budget (22 s) ≥ handler deadline (21 s) ≥ sum of provider slices is an invariant that currently exists only by convention, not by test.
