# EchoLearn Active Decisions

This file contains only durable, currently active architecture, product, and operational decisions. It is not a progress log or test report.

## D-001 — Documentation source-of-truth ownership

- Date: 2026-09-01
- Status: ACTIVE
- Decision: `PROGRESS.md` is the current project-status source; `TEST_REPORT.md` is the validation-evidence source; this file contains active durable decisions; `.workbuddy/memory/YYYY-MM-DD.md` contains historical engineering journals; task handoffs contain per-task state.
- Rationale: Keep current status, validation evidence, durable rules, and historical investigations separate and easy to audit.
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
