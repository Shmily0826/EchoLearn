# Caption Error Code Contract

> Phase 1 consolidation artefact (2026-09-06). This is the **single normative list**
> of wire-level caption/transcript error codes. Any code emitted across a network
> boundary must appear here. Drift is enforced by
> `src/services/__tests__/captionErrorContract.test.ts`.
>
> Canonical TS module: `src/services/captionErrorContract.ts`.

## Wire-level codes (YouTube + Bilibili)

| Code | Default HTTP | Meaning | Emitted by | Consumed by |
|---|---|---|---|---|
| `captions_not_found` | 404 | Providers ran to completion; no usable captions exist. Definitive — do not retry, do not trigger fallbacks. | Worker, Vercel, VPS, local proxy | Client (terminal UI state) |
| `provider_timeout` | 504 | A provider or the overall deadline expired. Transport-level — later independent routes may still succeed. | Worker, Vercel, VPS | Client (deferred, then retry/fallback) |
| `provider_failure` | 502 | A provider failed (network, 5xx, malformed). Transport-level. | Worker, Vercel, VPS | Client (deferred, then retry/fallback) |
| `youtube_acquisition_blocked` | 403 | YouTube blocked media/caption acquisition for this context. | Worker (ASR/audio branch), VPS | Client (terminal, distinct UI) |
| `transcript_disabled` | 404 | Captions are disabled on this video by the uploader. | Vercel (classifier only, message-derived) | Client (terminal UI state) |
| `asr_required` | 409 | Caption stages exhausted; ASR capability exists and explicit opt-in (`allowAsr=1`) is required. **Never** means "no captions exist". | Worker, Vercel (propagated), VPS | Client (offers Generate transcript) |
| `rate_limit` | 429 | Upstream rate limited the request. | Worker, Vercel Bilibili, client Bilibili | Client Bilibili |
| `invalid_request` | 400 | Malformed client request (bad videoId/BV id/part). | Worker Bilibili routes | Client Bilibili |
| `client_disconnected` | 499 | Caller aborted before completion. VPS-internal. | VPS | Worker (as provider failure observation) |

## Semantic rules (preserve during consolidation)

1. `captions_not_found` and `transcript_disabled` are **definitive no-caption** outcomes.
   `provider_timeout`, `provider_failure`, `rate_limit` are **transport** outcomes.
   Fallback/ASR gating must never confuse the two (this exact bug was fixed 2026-09-05:
   Worker `asr_required` was terminal before non-ASR routes ran).
2. `asr_required` is a *capability* signal from one server, not a global truth. The client
   must defer it until independent non-ASR routes have run, and must never start ASR
   without explicit `allowAsr=1`.
3. A 206 / empty-but-valid upstream response maps to `captions_not_found`, never to a
   transport failure — and an earlier transport failure must not be overwritten by a
   later no-caption result (`chooseFinalFailure`, `api/transcript.ts:385-408`).
4. `client_disconnected` (499) is cancellation, not failure; it must not be retried.

## Non-wire vocabularies (documented, not merged)

These namespaces are local-only and must not leak onto the wire:

- **Measurement** (module archived on `research/architecture-consolidation-archive`,
  commit `b5cf7bd`): `success`, `cancelled`, `invalid_input`, `auth_failure`,
  `rate_limited` were measurement-only additions; the rest reuse wire codes. Note the
  deliberate spelling difference: measurement used `rate_limited`, the wire uses
  `rate_limit`. If a reliability-baseline runner revives the module, its vocabulary
  must be re-pinned against this contract.
- **Browser fallback (experimental, archived)** (archived in the same commit):
  `disabled`, `not_eligible`, `stale_response`, `player_blocked`, `partial_coverage`,
  `cancelled`, `resource_exhausted`, `slot_unavailable`, `cleanup_failure`,
  `invalid_response`. Its trigger gate accepted only `provider_timeout`,
  `provider_failure`, `network_failure`, `upstream_5xx` (the latter two are
  measurement vocabulary).

## Status-to-code fallback conventions

When an upstream response is untyped, classifiers map by status:

- 408 / 504 → `provider_timeout`
- 404 → `captions_not_found`
- 429 → `rate_limit`
- other non-2xx → `provider_failure`

These conventions appear independently in `api/transcript.ts:139-145`,
`api/bilibili.ts:72-79`, and the Worker outcome mapping — a drift test pins them.
