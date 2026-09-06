# Worker Long-Term Fate — Decision Material

> Supervisor recommendation material, prepared 2026-09-06. This is not a
> user-approved final architecture decision. The evidence is finite-window
> production evidence and does not establish a permanent property of all
> videos, providers, or future Cloudflare egress.

## 1. Evidence

### Directly measured

The current measured result is that the Worker YouTube caption path is
persistently non-functional for the frozen matrix under the measured
Production Cloudflare egress:

- The frozen baseline produced Worker `0/12` usable results.
- Three additional Worker-only windows produced `0/36` successes.
- The budget A/B produced Worker `0/12` in each 12-second, 5-second, and
  3-second arm, while final usable results were `12/12` in every arm.
- On fast-fail rows with debug attribution, InnerTube ANDROID, IOS, and WEB
  returned `LOGIN_REQUIRED` with the YouTube bot-wall message, `Sign in to
  confirm you're not a bot`.
- TVHTML5 returned `ERROR — no longer supported`; that client has since been
  removed (`60166a3`).
- The webpage path reached the ScrapingBee gateway and returned HTTP 401 at
  measurement time.
- Invidious and Piped pools were unavailable or in cooldown at measurement
  time.
- The VPS fast path directly won 2–3 budget-A/B or dogfood rows as
  `source=vps`, approximately within 0.8–1.2 seconds. The earlier baseline
  window was `12/12` Supadata-backed at the Vercel layer. Across the measured
  windows, Supadata carried the majority of Worker-unreachable captions not
  won by VPS or npm; this is not a claim that Supadata carries every caption.
- The measured 5-second client budget preserved final `12/12` usability and
  reduced P90 from roughly 14.7 seconds to 9.2 seconds in that A/B. This is an
  A/B result, not a universal production guarantee.
- Study dogfood was `4/4` ultimately usable and `3/4` first-load successful.
  One first-load miss later did not reproduce; transient flakiness is the
  current hypothesis, not a confirmed deterministic bug.

### Inference and limits

- The timeout rows are inferred to represent the same blocked state racing the
  caption deadline, supported by per-video code flapping across the repeated
  windows. They remain an inference unless direct debug evidence exists for
  those exact timeout responses.
- The results establish a repeated failure pattern for this frozen matrix and
  measured egress, not a permanent universal failure of every possible video,
  provider, or future Worker egress configuration.
- The 5-second budget removes much of the observed latency tail, but the A/B
  does not by itself prove the same distribution for all production traffic.

## 2. Options

### A. Keep a synchronous 5-second Worker first probe

- Lowest migration cost and preserves a possible future Worker fast path.
- Every caption request continues to pay up to 5 seconds for a path with zero
  measured contribution across the repeated frozen-matrix windows and all
  three budget arms.
- The standing reliability window remains the recovery detector.

### B. Demote only YouTube caption acquisition to a diagnostic path

- The user path calls the existing Vercel caption handler directly rather than
  synchronously probing the Worker first.
- The Worker remains available for Bilibili, ASR, diagnostics, and future
  egress experiments.
- A bounded Worker-only standing reliability window preserves recovery
  telemetry without making users pay the synchronous probe tax.
- This is a client ordering change, not a parallel race or provider rewrite.

### C. Give the Worker real egress later

- Residential/ISP proxy or equivalent could restore the Worker's original
  multi-provider value.
- Parked for now because of vendor spend, policy/ToS review, and operational
  complexity. Supadata and the existing Vercel path remain in place.

### D. Drop the Worker entirely from the YouTube caption path

- Simplest hot path, but not recommended.
- It discards Worker diagnostics and overstates single-provider reliance. The
  existing Vercel path includes VPS, then Supadata/npm as implemented; it is
  not accurately described as Supadata-only.

## 3. Supervisor recommendation

**Recommend Option B: demote only the YouTube caption Worker from the
synchronous hot path to a diagnostic/standing reliability probe.**

Rationale:

1. Measured Worker success on the frozen YouTube caption matrix is zero across
   repeated windows and across the 12-second, 5-second, and 3-second budget
   arms.
2. Keeping the Worker as a synchronous 5-second first probe makes every real
   user pay latency for a path with zero measured current contribution.
3. The standing reliability runner can detect recovery without imposing that
   probe tax on users.
4. Bilibili, ASR, diagnostics, and future egress experiments remain available;
   the Worker can return to the hot path if the standing window shows
   meaningful repeated recovery.
5. This does not remove the Worker or redesign the provider architecture now.

## 4. Sub-decisions

- **`SCRAPE_API_KEY` removal: recommend YES, approval pending.** Remove the
  doomed ScrapingBee call/path from the Worker production path because the
  measured path returned HTTP 401 and ScrapingBee remains NO-GO. This refers to
  removing the call/path safely, not exposing or printing the secret value.
- **TVHTML5: already removed** (`60166a3`).
- **Invidious/Piped: keep temporarily.** They were unavailable or in cooldown
  during the measured window, not proven permanently dead. Prune their lists
  in a later hygiene pass if the standing evidence remains unchanged.
- **Worker `CAPTION_DEADLINE_MS` 11s → approximately 6s: defer / low priority.**
  Option B removes the Worker from the user hot path, so this is not urgent.
  Revisit for compute hygiene if the Worker returns to a synchronous role or
  if a later bounded Worker deployment warrants it.
- **Standing reliability window: recommend YES, approval pending.** Run weekly
  or per release, Worker-only, against the frozen matrix, with no Supadata or
  ASR traffic. Stop after enough evidence for the window’s acceptance rule;
  trigger re-evaluation on meaningful repeated Worker success, not one
  anomalous success.

## 5. Implementation guardrails for Option B

- Change YouTube caption acquisition only. Leave Bilibili and ASR untouched.
- The client should skip the synchronous Worker probe and call the existing
  Vercel caption path.
- Do not introduce an L1/L2 `Promise.race` or duplicate paid upstream requests.
- Preserve typed errors, diagnostics/provenance, cache semantics, and
  guest/auth behavior.
- Before release, validate the frozen 12-video behavior and 3–5 Study UI
  dogfood cases. Final usability must not fall below the current baseline;
  Supadata invocation must not increase unexpectedly; VPS must still be able
  to win; and time-to-caption should improve.
- Rollback must be simple: restore the 5-second Worker-first ordering.

## 6. Decision record

- Supervisor recommendation: **B**
- User/project-owner approval: **granted 2026-09-07 (conversation) — implement per §5 guardrails**
- `SCRAPE_API_KEY` removal: **recommended Y; approval pending** (not included in the Option B change)
- Standing reliability window: **recommended Y; approval pending** (a one-word approval activates a weekly schedule)
- Worker deadline 11s → ~6s: **defer**
