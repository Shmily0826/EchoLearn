# EchoLearn release checklist

## Current release candidate

The release candidate is `4368124` on `echolearn-maintenance`.
It includes the audio quota and byte-range fixes, cross-device sync, AI
vocabulary improvements, and maintenance updates. See [draft PR #42](https://github.com/Shmily0826/EchoLearn/pull/42).
See the [architecture](ARCHITECTURE.md) for service ownership and the
[testing guide](TESTING.md) for local checks.

Verification for `4368124` passed on 2026-11-09.

- GitHub CI passed all four jobs, including 19 Worker tests and 124 browser
  tests across both shards. The Linux WebKit skip-link focus case passed.
  The known Windows WebKit failure remains reproducible locally.
  [GitHub CI run](https://github.com/Shmily0826/EchoLearn/actions/runs/42567599354)
- The Vercel Preview check passed.
  [Vercel Preview deployment](https://vercel.com/shmily0826s-projects/echolearn/9UPvXr7JaUaTmVujiuE5MzFnG4az)
- The Wrangler release bundle exposes only the default handler. It started
  locally under workerd and returned HTTP 200 from `/api/health`.

## Open issues and acceptance

| Priority | Area | Evidence and remaining check |
| --- | --- | --- |
| High | Worker audio and quota | Local regressions verify that cold requests for the same cache key share one VPS fetch and one quota debit within a Worker isolate. Suffix ranges select the trailing bytes, and valid ranges ending past EOF stop at the last byte. On the deployed Worker, verify concurrent and warm byte ranges, origin request count and quota delta. Exercise Bilibili's Vercel audio fallback separately because it has its own rate limiter. |
| High | Verified-account sync | The local emulator preserves both additions and the deletion across three clients, including a separate concurrent-write probe. With the updated client on three isolated devices, repeat add, delete, stale save, and a clean pull using an authorized QA account. |
| High | AI vocabulary | Mocked streaming, candidate filtering, fallback, old-cache bypass, same-version reuse and saved-lesson restore passed. Use representative captions and a capped real provider run to judge vocabulary coverage, glosses and CEFR quality. |
| Medium | VPS English captions | The October probe reached the VPS but YouTube blocked acquisition before the language gate. A successful acquisition of a suitable sample is still required to evaluate the deployed gate. |
| Medium | Android local media | Deferred for this release. On a physical Android device, import a roughly 90 MB audio file with subtitles, verify playback, and check that the lesson restores after refresh. |

## Release sequence

- [x] Run the relevant local checks and the GitHub CI gate for `4368124`,
   including the [skip-link focus case](../e2e/mobile-pwa.spec.ts) in Linux
   WebKit. The evidence above is tied to that revision.
- [x] Verify which components need a release. The candidate changes Web and
   Worker code. Its diff leaves canonical Firestore rules, VPS source and
   Android native source intact. A Vercel build covers the web and Vercel
   functions. Worker release is separate.
- [ ] With release authorization, reconfirm the current rollback versions.
   Release Cloudflare Worker `yt-transcript-proxy` first. Run the audio gate
   below before merging to `main`, which can release Vercel Web and API.
   If the Worker gate fails, stop and restore the previous Worker version.
   Follow the [rules runbook](../deploy/RULES_RELEASE.md) when rules are in scope.
- [ ] Verify deployed identities and then exercise the acceptance rows above.
   Use [QA accounts](QA_ACCOUNTS.md) and the
   [deployed-host boundaries](TESTING.md#deployed-host-browser-validation).
   Record commit or deployment IDs, date, environment, and result separately
   from local evidence.

## Production preflight

- The current Worker sends 100% of traffic to version
  `4f6c78f7-92d7-466d-908b-038a89a35901`. The Worker and VPS health
  endpoints returned HTTP 200. The current Vercel rollback baseline is
  `cc08c94`.
  [Vercel production record](https://vercel.com/shmily0826s-projects/echolearn/Epvf4LM4osj3v1EgpDJ16jZfiDXb)
- QA account A signed in and Firebase confirmed its email is verified.
  Use A in three isolated sessions for the sync acceptance. Use a single
  explicitly authorized provider invocation for the AI vocabulary spot check.

### Worker audio gate

1. Use `https://www.bilibili.com/video/BV1X54y1p7Dd`. The VPS already has a
   nonempty 5,497,305-byte MP3 for that sample. Add a unique outer `qa_run`
   query parameter to the Worker `/api/audio?url=...` URL. Reuse that exact
   URL throughout the Worker test. This starts with a fresh Worker cache key
   while keeping the same source URL for the VPS disk cache.
2. Read QA A's `asr:uid:<uid>:<UTC date>` value from the remote `QUOTAS`
   binding before the requests. Treat a confirmed missing key as zero. Verify
   read access with a prefix list if a value lookup returns 404. Record only
   the count. Check the VPS service journal with
   `sudo -n journalctl -u echolearn-ytdlp.service --since <UTC-start>`.
   Filter by the sample and time window, and count only `GET /api/audio`
   access records. Preflight confirmed journal access and a matching health
   access record.
3. Send two simultaneous authenticated Range requests. For requests that
   share an isolate and overlap during the cold load, expect one `MISS` and
   one `COALESCED`, one VPS access record and a quota increase of one.
   Follow with warm suffix and overlong-end ranges. Expect `HIT`, HTTP 206,
   correct `Content-Range` and bytes, and no further access or quota increase.
   Compare bytes against the complete cached response. A start past EOF
   should return 416. Allow for KV propagation before judging the count.
   If requests do not overlap within an isolate, record the coalescing check
   as inconclusive.
4. After recording the Worker counts, make one separate Range request to
   `/api/bilibili?audio=1&url=...` on Vercel. Check status, byte range and
   content against the same sample. Count this request separately because it
   goes directly to the VPS.
