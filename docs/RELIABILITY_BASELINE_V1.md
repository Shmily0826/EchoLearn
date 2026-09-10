# Caption Reliability Baseline V1 — Specification

> Status: LOCAL ACCEPTED (2026-09-10) for the reliability-runner dry-run. Production observation remains NOT RUN; this document does not claim Production validation.
> Successor of the consolidation programme; uses the infra shipped in `6546d8c`/`a258707`
> (cache-state header, typed error codes, provenance `source` field).

## 1. Goal

For a fixed, small, real-video matrix, produce a per-layer acquisition result:

```
URL → L2 Vercel /api/transcript → L3 Study UI usable
```

and answer: **which layer drags the success rate**, with typed evidence — not a single
pass/fail number. One bounded window, no retries beyond the protocol, no new fallback
work triggered by the outcome.

## 2. Fixed matrix (12 videos, independently confirmed native-caption positives)

Source of truth: external sanitized manifests
`D:/CODE/API/echolearn/evidence/ECHO-20260904-2235-native/` (5 IDs) and
`ECHO-20260904-2325-native/` (7 IDs) — all YouTube-origin confirmed SUCCESS with
non-empty timedtext and zero media bytes at capture time.

| # | videoId | Note |
|---|---|---|
| 1 | `ZbZSe6N_BXs` | Happy — known production-positive via Supadata (2026-09-05) |
| 2 | `JGwWNGJdvx8` | Shape of You — Supadata worst case ≈ 14.4 s; production-negative pre-Supadata |
| 3 | `RgKAFK5djSk` | |
| 4 | `CevxZvSJLk8` | |
| 5 | `60ItHLz5WEA` | auto-caption only at capture |
| 6 | `3JZ_D3ELwOQ` | |
| 7 | `L_jWHffIx5E` | |
| 8 | `arj7oStGLkU` | TED talk, manual+auto |
| 9 | `Ks-_Mh1QhMc` | TED talk, manual+auto |
| 10 | `e-ORhEE9VVg` | TED talk |
| 11 | `YQHsXMglC9A` | |
| 12 | `OPf0YbXqDm0` | |

Rule: the matrix is frozen for the window. If a video must be replaced (e.g. deleted
upstream), it is replaced with a fresh YouTube-origin-confirmed positive and the
replacement is recorded; no silent swaps.

## 3. Per-video record (privacy-safe by construction)

One row per video per layer, containing only:

- `videoId` (needed for cache-busting reproducibility; never logged with transcript text)
- layer (`L2-vercel` / `L3-study`)
- HTTP status + typed code from `docs/CAPTION_ERROR_CONTRACT.md`
- `source` provenance (`supadata`/`vps`/`npm`/`innertube`/…) where present
- `X-EchoLearn-Transcript-Cache` state where present; otherwise `absent`
- latency bucket (not raw ms beyond bucketing: <2s, 2–8s, 8–15s, 15–25s, >25s)
- line-count bucket (0, 1–20, >20) — never the lines themselves

Never recorded: transcript text, upstream payloads, cookies, tokens, IP, user identity.

## 4. Protocol

1. **Sequential, one-shot per video per layer** — no automatic retry, no re-run of a
   failed call inside the window. A failed call stays failed for attribution.
2. The current-path runner makes exactly one sequential L2 Vercel request per video.
   It does not probe the Worker, retry, or make a cache-verification second pass.
3. **Inter-call pause ≥ 3 s** to avoid rate limiting artifacts.
4. **Single window**: all calls inside one bounded session; wall-clock window recorded
   (start/end), no cross-window averaging.
5. **L3 (Study UI)** is optional per execution mode; when run, it uses a fresh browser
   profile with media-only blocking and records final UI line-usable + Retry visibility.

## 5. Attribution rules

- A layer is a **transport failure** (`provider_timeout`, `provider_failure`,
  `rate_limit`) if its typed code says so; the next independent layer still runs.
- A layer result `captions_not_found`/`transcript_disabled`/`asr_required` against a
  matrix-confirmed positive is an **acquisition/classification discrepancy** — the most
  valuable outcome class; it is highlighted, not averaged away.
- `source=supadata`/`vps`/`npm` success at L2 is the current Vercel caption-path
  result; the Worker is not part of this current-path measurement.
- Window verdicts: per-layer success rate (n=12) + discrepancy count + the single
  dominant failure layer. No broader YouTube reliability claims.

## 6. Execution modes (gates — user decision required)

- **Gate P (push)**: production observation is only meaningful with the diagnostics
  live. The local commits must be pushed (Vercel auto-deploys the frontend + API).
  Worker deployment/cache state is outside this current-path measurement.
- **Mode A — API probes only** (default): local Node runner calls the same-origin
  Vercel transcript endpoint directly. Cheap, precise, no browser. This is the
  minimum viable window.
- **Mode B — API + guest browser Study flow**: adds L3. Higher confidence, heavier;
  can be a separate later window.

## 7. Boundaries

- No ASR (`allowAsr` never sent), no Generate, no media/audio acquisition.
- No provider spend beyond what the app's normal caption path already spends
  (Supadata credits ≈ n per L2 success; estimated and reported per window).
- Engineering runs are paid-provider **OFF by default**. The baseline runner,
  budget A/B runner, and health monitor skip the Supadata-capable Vercel layer
  unless `ECHOLEARN_ALLOW_PAID_PROVIDER=1` and an exact numeric
  `ECHOLEARN_PAID_MAX_INVOCATIONS` cap are both supplied. The cap is enforced
  before every paid-capable request; malformed or partial configuration fails
  closed. Worker-only and other no-paid checks remain usable.
- No fallback/source changes during the window; results feed the *next* decision.
- The runner is local-only tooling (`scripts/reliability-baseline/`); tests for its
  attribution logic are vitest-mocked — no test touches live endpoints.

## 8. Pre-window checklist

- [ ] Gate P decided (push or defer)
- [ ] Mode A/B decided
- [ ] Manifests re-readable and unmodified
- [ ] Runner + mocked attribution tests on main
- [ ] Window start/end recorded; rows appended to a sanitized local evidence file

## 9. 2026-09-10 local acceptance and release boundary

- P1 reliability runner is **LOCAL ACCEPTED**. The only stale direct call changed was `buildCallPlan({ paidProviderPolicy })` -> `buildCallPlan()`.
- Focused reliability Node tests: **17/17 PASS**. Actual Windows direct-runner dry-run: **PASS**.
- The normal caption plan is Vercel-only; the paid-provider path is blocked by default. No provider traffic occurred.
- No commit or push was made from that acceptance cycle, and no deploy or Production observation was performed.
- This section records local runner acceptance only; it does not turn the dry-run into a Production reliability result.
