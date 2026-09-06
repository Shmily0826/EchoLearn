# Worker Long-Term Fate — Decision Material

> Prepared 2026-09-06 for the Phase 5 architecture decision. Evidence-backed options
> only; no implementation in this document. Decision owner: project supervisor.

## 1. What we know (all directly measured unless marked)

### The Worker caption cascade is fully blocked from cloud egress

One debug-enabled attribution window plus four typed-code windows (0/36 + 0/12 baseline):

| Stage | Direct evidence |
|---|---|
| InnerTube ANDROID / IOS / WEB | `LOGIN_REQUIRED` — "Sign in to confirm you're not a bot" (YouTube bot wall on datacenter IPs) |
| InnerTube TVHTML5 | `ERROR — no longer supported` (client deprecated by YouTube; removed in `60166a3`) |
| Webpage scraping | Runs only through the ScrapingBee gateway → `HTTP 401` (credits overdrawn since 2026-09-04) |
| Invidious (10 instances) / Piped (6 instances) | Entire pools in cooldown — dead third-party frontends |
| Slow-timeout rows (504) | *Inference:* same blocked state racing the 11 s deadline (per-video code flapping across 5 windows); now directly attributable too once the deadline `_debug` fix (`417e466`) deploys with ALLOW_DEBUG on |

### What the client actually experiences (post 5 s budget, deployed 2026-09-06)

- Budget A/B (12 s / 5 s / 3 s): final success 12/12 in every arm; 5 s cut P90 14.7 s → 9.2 s with no Supadata cost increase. 5 s shipped.
- Dogfood (Study UI, real guest path): 4/4 ultimately usable, 3/4 first-load; perceived 6.2–14.4 s including metadata/render.
- **New input — VPS fast path is alive**: `yt-api.echo-learn.uk` served 3 A/B rows as `source=vps` within its 1 s probe budget (~0.8–1.2 s), and the dogfood UI correctly showed VPS provenance with no Supadata cost. The production VPS is a real, occasionally-winning provider.
- Supadata currently carries 100% of Worker-unreachable videos; single-provider dependency is real but bounded by the VPS fallback and npm last resort.

## 2. Options

### A. Keep Worker as 5 s first probe (status quo)

- Cost: every caption request spends up to 5 s on a path that has not succeeded once in 5 windows (48 calls).
- Benefit: zero migration work; automatic recovery if YouTube's bot wall ever stops hitting Cloudflare IPs (detected by the standing reliability window); the Worker also serves Bilibili and ASR routes, which are NOT affected by this decision.
- Risk: ~5 s median-side latency tax on every first caption view.

### B. Demote Worker to background/diagnostic path

- Client goes straight to Vercel (Supadata first in handler); Worker is probed async (or only by the reliability runner) to keep egress telemetry.
- Benefit: removes the 5 s tax immediately; keeps the egress watch.
- Cost: client cascade change + regression suite; loses the (currently theoretical) Worker fast path; two request patterns to explain.

### C. Give the Worker real egress (residential/ISP proxy or equivalent)

- Only option that could restore the Worker's original value (multi-provider cascade).
- Cost: vendor spend, policy/ToS review (2026-09-04 research: Bright Data excluded, IPRoyal candidate needs written confirmation), ops complexity. Supersedes nothing — Supadata stays.
- Verdict from earlier rounds: parked; revisit only if the project needs cloud-side multi-provider resilience.

### D. Supadata-first (drop Worker from the hot path entirely, no replacement probe)

- Simplest client path (single endpoint), but maximizes single-provider dependency and loses all Worker egress telemetry.

## 3. Recommendation

**Adopt A now, with a scheduled re-evaluation trigger** — with two amendments:

1. **Standing reliability window (weekly or per-release)**: if the Worker posts any successes on the frozen matrix, immediately re-open B/C (it would mean egress recovered and the 5 s probe is live value again). The runner and attribution tooling already exist.
2. **Bundle the sub-decisions**:
   - `SCRAPE_API_KEY`: remove from the Worker now (every caption request pays a doomed 401 gateway call; ScrapingBee remains NO-GO). Re-add only under option C.
   - TVHTML5: done (`60166a3`).
   - Invidious/Piped: keep as-is for now (they cost nothing while in cooldown and auto-recover if instances revive); prune the instance lists in a later hygiene pass.
   - Worker-side `CAPTION_DEADLINE_MS` (11 s): can drop to ~6 s in a later pass to stop edge compute burning 6 s past the client's 5 s budget. Not urgent (no user-facing effect); batch with the next Worker deploy.

Rationale: A keeps every option open at zero migration cost while the 5 s budget has already removed the user-facing pain that motivated this review. B's win over A is real but small (median-side seconds) and it spends cascade complexity now; if the reliability window stays 0% for another few weeks, B becomes the right default and this document should be re-run with fresh numbers.

## 4. Decision record (to be filled by supervisor)

- Chosen option: ________
- SCRAPE_API_KEY removal approved: Y/N
- Weekly reliability window approved: Y/N
- Worker deadline 11 s → 6 s approved (next deploy): Y/N
