# Caption Timeout / Budget Register

> Phase 1 consolidation artefact (2026-09-06). Every caption-related timeout or
> budget constant, its location, and its rationale. Consolidation target: these
> become a single budget table with propagation tests instead of ~30 scattered
> literals. Values are against `main` at `f51c1bc` plus the working tree.

## The one invariant

```
client endpoint budget  ≥  server overall deadline  ≥  Σ provider slices
22 s (Vercel endpoint)     21 s (api/transcript.ts)    1 + 18 + 6.5 s (clamped to remaining)
```

This invariant currently holds by convention only; no test asserts it (Phase 3 item).
Platform ceiling: Vercel `maxDuration: 30` (`vercel.json:5`).

## Client — `src/services/youtubeTranscript.ts`

| Value | Constant / site | Purpose |
|---|---|---|
| 4000 ms | local-proxy fetch timeout (`:639`) | Local proxy is fast or assumed down |
| 5 min | `LOCAL_PROXY_SKIP_MS` (`:689`) | Skip marker after local-proxy failure |
| 5000 ms | `WORKER_TIMEOUT_MS` caption-only (`:775`; 2026-09-06 A/B, commit `469bb40`) | Worker caption budget — 0/36 observed successes made the 12 s wait pure latency; 5 s preserved 12/12 final success (P90 9.2 s vs 14.7 s) |
| 90000 ms | `WORKER_TIMEOUT_MS` with `allowAsr` (`:775`) | ASR: VPS race 75 s + Whisper 120 s overlap → generous ceiling |
| 22000 ms | `VERCEL_TIMEOUT_MS` (`:779`) | Vercel handler 21 s deadline + margin |
| 1500 ms ×2 | `CAPTION_RETRY_COUNT` / `CAPTION_RETRY_DELAY_MS` (`:83-84`) | Caption-content fetch retries (json3→default→srv3) |
| 15000 ms | `resilientFetch.ts:20` default | Generic client fetch default |

## Vercel — `api/transcript.ts`

| Value | Constant | Purpose |
|---|---|---|
| 21000 ms | `TRANSCRIPT_DEADLINE_MS` (`:23`) | Overall handler deadline; providers clamp to remaining budget |
| 1000 ms | `VPS_TIMEOUT_MS` (`:24`) | VPS is a fast probe or skipped (yt-dlp cold starts are slow) |
| 18000 ms | `SUPADATA_TIMEOUT_MS` (`:28`) | Sized for measured Supadata worst case (Shape of You ≈ 14.4 s, 2026-09-05 matrix) |
| 6500 ms | `NPM_FALLBACK_TIMEOUT_MS` (`:25`) | npm youtube-transcript worst case |
| 30 s | `vercel.json` `maxDuration` | Platform function ceiling |
| 60 s window / 20 req | per-IP rate limit (`:43-44`) | Abuse control |

## CF Worker — `cf-worker/src/index.js`

| Value | Constant | Purpose |
|---|---|---|
| 11000 ms | `CAPTION_DEADLINE_MS` (`:37`) | Overall caption cascade deadline |
| 4000 ms | InnerTube bounded slice (`:549`) | Fast rejection before cheaper stages |
| 8000 ms | per InnerTube client / per Invidious / per Piped instance (`:1239, :1753, :1869`) | Instance-level bound |
| 45000 ms | webpage stage (`:1350`) | Page fetch is heavy but pre-deadline clamped |
| 20000 / 30000 ms | timedtext fetch (`:1519, :1531`) | Timedtext transfer bound |
| 5000 ms | `VPS_CAPTION_BUDGET_MS` (`:38`) | **Dead** — unused on the YouTube path |
| 9000 ms | `BILIBILI_CAPTION_BUDGET_MS` (`:39`) | Bilibili caption budget forwarded to VPS |
| 75000 ms | VPS ASR race (`:504-507`) | Client allowAsr budget 90 s − margin |
| 120000 ms | Groq Whisper (`:2150`) | Transcription ceiling (audio ≤ 25 MB) |
| 240000 ms | VPS ASR / audio fetch (`:880, :991`) | Bilibili ASR budget (client 90 s… platform race) |
| 5 min | instance health cooldown (`:368`) | Avoid hammering dead Invidious/Piped instances |
| 60 s window | per-IP rate limit (`:338`) | Abuse control |

## VPS — `vps-ytdlp/main.py`

| Value | Constant | Purpose |
|---|---|---|
| 11000 ms | `MAX_CAPTION_BUDGET_MS` (`:102`) | Rejects forwarded caption budgets larger than the Worker deadline |
| 180 s | `YTDLP_TIMEOUT` (`:254`; stale comment at `:25` says 90) | yt-dlp default for info/audio paths |
| 75 s | `ASR_REQUEST_TIMEOUT` (`:385`) | Matches Worker VPS-ASR race |
| 55 s / 172 s | `AUDIO_DL_TIMEOUT` / `AUDIO_OVERALL_TIMEOUT` (`:367-373`) | Audio download / overall audio pipeline |
| 180 s | `GROQ_TIMEOUT` (`:378`) | Whisper transcription on VPS |
| 3600 s | `YTDLP_CACHE_TTL` (`:257`) | Transcript cache TTL |

## Bilibili

| Value | Site | Purpose |
|---|---|---|
| 15000 ms (90 s ASR) | client → Worker `bilibiliTranscript.ts:182-186` | Bilibili is yt-dlp-bound, slower than YouTube |
| 30000 ms | client → Vercel `bilibiliTranscript.ts` | Vercel is a thin proxy |
| 180000 / 30000 ms | Vercel → VPS `api/bilibili.ts:132, :147` | yt-dlp extraction / short-link resolution |

## Experimental (archived on `research/architecture-consolidation-archive`, commit `b5cf7bd`)

| Value | Site | Purpose |
|---|---|---|
| 25000 ms | browser fallback deadline `browserTranscriptFallback.ts:349` | Headed-browser slot budget |
| 12000 ms | ScrapingBee subtitles adapter `cf-worker/src/scrapingbeeYoutubeSubtitles.js:16` | Standalone eval only |
| 45000 ms | health-check per control attempt `scripts/health-check.mjs` | Live synthetic probe bound (still on main) |

## Known tensions (for Phase 3/4 review)

1. Worker ASR-audio budget (240 s) exceeds the client `allowAsr` Worker budget (90 s);
   the 75 s VPS race wins first, but Whisper 120 s can exceed the client budget —
   protected only by the client abort, not by design.
2. Vercel `NPM_FALLBACK_TIMEOUT_MS` (6.5 s) + `VPS_TIMEOUT_MS` (1 s) + `SUPADATA_TIMEOUT_MS`
   (18 s) sums to 25.5 s > the 21 s deadline; only the remaining-budget clamping makes
   this safe, which is exactly why propagation tests are needed.
3. `YTDLP_TIMEOUT` doc/comment drift (90 vs 180 s) at `main.py:25`.
