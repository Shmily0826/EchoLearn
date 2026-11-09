# EchoLearn release checklist

## Current release candidate

The release candidate is `4bc16e7` on `echolearn-maintenance`.
It includes the audio quota and byte-range fixes, cross-device sync, AI
vocabulary improvements, and maintenance updates. See [draft PR #42](https://github.com/Shmily0826/EchoLearn/pull/42).
See the [architecture](ARCHITECTURE.md) for service ownership and the
[testing guide](TESTING.md) for local checks.

Verification for `4bc16e7` passed on 2026-11-09.

- GitHub CI passed all four jobs, including 19 Worker tests and 124 browser
  tests across both shards. The Linux WebKit skip-link focus case passed.
  The known Windows WebKit failure remains reproducible locally.
  [GitHub CI run](https://github.com/Shmily0826/EchoLearn/actions/runs/42557822122)
- The Vercel Preview check passed.
  [Vercel Preview deployment](https://vercel.com/shmily0826s-projects/echolearn/8AyWPekLnnunUMGawu6iBXmoGiUb)

## Open issues and acceptance

| Priority | Area | Evidence and remaining check |
| --- | --- | --- |
| High | Worker audio and quota | Local regressions verify that cold requests for the same cache key share one VPS fetch and one quota debit within a Worker isolate. Suffix ranges select the trailing bytes, and valid ranges ending past EOF stop at the last byte. On the deployed Worker, verify concurrent and warm byte ranges, origin request count and quota delta. Exercise Bilibili's Vercel audio fallback separately because it has its own rate limiter. |
| High | Verified-account sync | The local emulator preserves both additions and the deletion across three clients, including a separate concurrent-write probe. With the updated client on three isolated devices, repeat add, delete, stale save, and a clean pull using an authorized QA account. |
| High | AI vocabulary | Mocked streaming, candidate filtering, fallback, old-cache bypass, same-version reuse and saved-lesson restore passed. Use representative captions and a capped real provider run to judge vocabulary coverage, glosses and CEFR quality. |
| Medium | VPS English captions | The October probe reached the VPS but YouTube blocked acquisition before the language gate. A successful acquisition of a suitable sample is still required to evaluate the deployed gate. |
| Medium | Android local media | Browser coverage exists. On a physical Android device, import a roughly 90 MB audio file with subtitles, verify playback, and check that the lesson restores after refresh. |

## Release sequence

- [x] Run the relevant local checks and the GitHub CI gate for `4bc16e7`,
   including the [skip-link focus case](../e2e/mobile-pwa.spec.ts) in Linux
   WebKit. The evidence above is tied to that revision.
- [ ] Verify which components need a release. The candidate changes Web and
   Worker code. Its diff leaves canonical Firestore rules, VPS source and
   Android native source intact. A Vercel build covers the web and Vercel
   functions. Worker release is separate.
- [ ] With release authorization, confirm the target, deployment order and
   rollback revision for each affected service. Treat a merge to `main` as
   potentially releasing the Vercel web app through the Git integration.
   Follow the [rules runbook](../deploy/RULES_RELEASE.md) when rules are in scope.
- [ ] Verify deployed identities and then exercise the acceptance rows above.
   Use [QA accounts](QA_ACCOUNTS.md) and the
   [deployed-host boundaries](TESTING.md#deployed-host-browser-validation).
   Record commit or deployment IDs, date, environment, and result separately
   from local evidence.
