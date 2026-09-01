# EchoLearn Progress

This file is the source of truth for current project status only. Historical root causes belong in `.workbuddy/memory/YYYY-MM-DD.md`, validation detail belongs in `TEST_REPORT.md`, and durable rules belong in `DECISIONS.md`.

Updated: 2026-09-01

## Current priority

Recruiter-safe YouTube subtitle stabilization and reliable real Video → Transcript → Study behavior.

## Current separation

- Branch: `main`; release-record commit `6176800e59ce4bdd8bb67b60ac78e92fada9e954` is synchronized to `origin/main`.
- The accepted production Worker is version `9fcbd50b-d197-4691-951b-d9a8c4039197` (active deployment `974ee470-4498-4c79-b74a-b6109cc2feaf`); the Worker source is the only production candidate in this release record.
- The push-triggered Vercel production deployment is `dpl_GAAtbhbfZmjgevm1Pfz1vGeU5n5X` and is `READY`; it contains unchanged runtime frontend/API source because the Vercel/frontend candidate files were excluded. The local Vercel/frontend fallback candidate is not deployed.
- Production is a separate validation layer from local work and GitHub state; its acceptance evidence is recorded below and in `TEST_REPORT.md`.

## Acceptance gate

The gate is satisfied for the Worker-only production path: one sequential caption-only matrix achieved 7/7 positive controls (100%, above the 80% gate), the no-caption control failed truthfully with typed `provider_timeout`, and the real guest Video → Transcript → Study flow displayed 277 non-empty lines with usable controls and zero page errors. Cache HIT/MISS was not captured per matrix row, so this is not claimed as a cold provider matrix; the cache namespace is shared at transcript version `v=1`.

## Open state

The Worker-only production acceptance is complete under `ECHO-20260901-0139`. The remaining local `api/transcript.ts`, frontend service, and VPS changes describe an un-deployed coordinated fallback candidate; they are not required for the accepted Worker-only path and must not be deployed merely because they remain dirty.

## Next

Keep the Vercel/frontend and VPS candidates separate until a future coordinated release is explicitly justified and validated; the accepted Worker source is now synchronized to GitHub.
