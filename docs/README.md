# EchoLearn documentation

Start here to find the right document. Each kind of record has one home, so
update that file instead of writing the same fact in several places.

## Where things live

| Question | Document |
| --- | --- |
| What is the current release, and what is still open? | [Release checklist](RELEASE_CHECKLIST.md) |
| How do the web app, Vercel API, Worker, VPS, Firebase and Android fit together? | [Architecture](ARCHITECTURE.md) |
| Which command or test suite do I run? | [Testing](TESTING.md) |
| Which maintenance or live-probe script does what? | [Scripts index](../scripts/README.md) |
| Why is something built this way? | [Decisions](DECISIONS.md) |
| How do I release Firestore rules? | [Rules release runbook](../deploy/RULES_RELEASE.md) |
| Which QA accounts exist and how are they used? | [QA accounts](QA_ACCOUNTS.md) |

## Reference and design records

These describe one subsystem or one past design decision. Code and tests link
to them, so keep their names stable.

- [Caption budgets](CAPTION_BUDGETS.md) and the
  [caption error contract](CAPTION_ERROR_CONTRACT.md) for the transcript path.
- [Reliability baseline V1](RELIABILITY_BASELINE_V1.md), used by
  `scripts/reliability-baseline/`.
- [Verified-account sync test design](VERIFIED_SYNC_TEST_DESIGN.md).
- [Worker fate decision](WORKER_FATE_DECISION.md).

## History

[`archive/`](archive) holds dated records that no longer describe the current
project. Do not update them except to fix links.

- [Progress log, September–October 2026](archive/progress-2026-09-to-10.md)
- [Validation evidence, August–October 2026](archive/test-report-2026-08-to-10.md)
- [September progress snapshots](archive/progress-snapshots-2026-09.md)
- [Caption reliability, 4–7 September](archive/caption-reliability-2026-09-04-to-07-progress.md)
  and its [evidence](archive/caption-reliability-2026-09-04-to-07-evidence.md)
- [Old maintenance prompts and runners](archive/maintenance)

## Recording convention

1. Record current status, open issues and acceptance evidence for the active
   release in the [release checklist](RELEASE_CHECKLIST.md). Do not start a
   separate progress log or test report.
2. Once a release is accepted and the next cycle begins, move that release's
   evidence into `archive/releases/YYYY-MM-DD.md` and leave a one-line link in
   the checklist.
3. Add a decision to [Decisions](DECISIONS.md) only when it should constrain
   future work. Mark replaced decisions `SUPERSEDED` rather than deleting them.
4. Keep the counts in [Testing](TESTING.md#verified-local-baseline) tied to a
   named commit, and refresh them when that baseline moves.
