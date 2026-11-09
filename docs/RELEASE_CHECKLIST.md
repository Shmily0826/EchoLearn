# EchoLearn release checklist

This is the only record of current status, open issues and acceptance
evidence. The [documentation index](README.md) explains where other records
live and how to archive a finished release.

## Current release

`c1ec954` is in production. It merged [PR #42](https://github.com/Shmily0826/EchoLearn/pull/42)
on 2026-11-09 after the Worker audio gate passed, and
[production acceptance](#production-acceptance-on-2026-11-09-utc) is recorded
below. It includes the audio quota and byte-range fixes, cross-device sync,
AI vocabulary improvements, and maintenance updates. See the
[architecture](ARCHITECTURE.md) for service ownership and the
[testing guide](TESTING.md) for local checks.

The release candidate was `4368124` on `echolearn-maintenance`. Its
verification passed on 2026-11-09.

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
| High | Worker audio and quota | **PASS.** Production cold and warm ranges, origin counts, quota delta and the Bilibili Vercel fallback passed. |
| High | Verified-account sync | **PASS.** Three isolated Chromium sessions using QA A retained both additions and the deletion after a stale upload to production. |
| High | AI vocabulary | **PARTIAL.** The single production run passed vocabulary candidate and gloss checks. It returned 6 of 8 requested words, included one clipped vocabulary context, and failed the exact sentence quote check. |
| Medium | VPS English captions | **INCONCLUSIVE live.** The gate passed four controlled cases using the installed VPS source. All live samples failed at acquisition, so the live gate remains unverified. |
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

## Production acceptance on 2026-11-09 UTC

- **Release.** PR #42 was merged as `c1ec954` after the Worker audio gate
  passed. The production domain served the new Vercel deployment. The
  homepage and entry script returned HTTP 200. The Bilibili fallback
  returned HTTP 206 before and after the Web release.
  [CI](https://github.com/Shmily0826/EchoLearn/actions/runs/42569973413) ·
  [Production deployment](https://vercel.com/shmily0826s-projects/echolearn/Dv3x356U11vJmqLdekq2B2oYNBG6)
- **Worker audio.** Version `43b77fea-0e58-4bbe-9b54-079d99538126` returned
  HTTP 200 from health. The parallel requests returned `MISS` and
  `COALESCED`. The VPS journal showed one request and QA A's quota went from
  0 to 1. Warm suffix and overlong-end ranges returned matching bytes with
  HTTP 206, and a start at EOF returned HTTP 416. The VPS count and quota
  stayed unchanged during those warm requests.
- **Verified-account sync.** The first two browser contexts signed in as QA A
  and started with the same deletion fixture. The first added a word and
  deleted the fixture. The second added another word and uploaded from its
  stale state. A fresh third context pulled both new words and all
  27 original words, with the deleted fixture absent. The run seeded only
  test items in local storage and used the deployed UI for deletion, upload
  and sync against production Firestore. The test items were cleaned up.
- **AI vocabulary.** One capped production request returned HTTP 200 in
  6.8 seconds using the bundled transcript, B1–C1 and eight requested words.
  Six unique words matched the prompt candidates, five B2 and one C1. All
  six had Chinese glosses. The glosses fit the words in context, though the
  `hierarchy` example starts mid-word. The rubric reported 15 passes and
  one failure. One sentence joined noncontiguous subtitle lines and failed
  the exact quote check. The provider call was not retried.
- **VPS English captions.** The production service returned HTTP 502 for
  three YouTube and three Bilibili samples before reaching the gate.
  Journal evidence included YouTube sign-in challenges, HTTP 429 and
  Bilibili extraction errors. One normal request with the configured
  YouTube fallback also ended in HTTP 429 at the provider. In a separate
  process on the VPS, the installed handler passed all four controlled
  cases with acquisition stubbed. It accepted Chinese for a Chinese
  request, rejected Chinese for an English request with
  `404 captions_not_found`, and accepted both `en` and `ai-en` for
  English requests. A live acquisition that reaches the gate is still
  needed for end-to-end acceptance.
- **Android local media.** Deferred for this release.

### Desktop study and saved AI replay

- **Desktop study PASS.** On production Web `c1ec954`, a fresh Chrome guest
  profile opened a local WAV with supplied SRT captions. Native playback
  advanced and clicking the second caption moved the playhead to its
  four-second cue. The learner saved one word, reviewed it through Review
  Every Saved Item, and completed the round. Reloading Study restored the
  audio and captions, playback resumed, and the review count remained one.
  The dictionary used a deterministic fixture. Audio and subtitles came
  from local test files.
- **Saved AI sentence seek PASS.** The saved provider response from the
  earlier production run was loaded into a local lesson with the original
  caption timings. The stitched sentence had a `@9:37` seek control.
  Clicking it moved the native player to about 577.05 seconds and
  highlighted the opening caption at 577.044 seconds. The sentence still
  fails the verbatim quote check recorded above. Both desktop checks made
  zero AI or ASR requests.

### Local follow-up

These changes are committed on `echolearn-maintenance` but not yet released.

- The quote filter now requires a continuous word sequence in the
  transcript. The saved production response is a regression fixture for
  both fresh analysis and lesson restore. The fuzzy seek matcher is
  unchanged.
- The updated dependency tree reports zero findings with
  `npm audit --omit=dev`. The Android debug Java compile was reported to
  pass with Capacitor 8.4.3 but was not rerun before commit. The full
  audit still reports a critical `tar` advisory under the Firebase CLI
  development dependency. Android device acceptance remains deferred.
- Lint now reports no warnings.
- On 2026-11-10 the combined tree passed 1,075 application tests,
  33 Firestore emulator tests, 19 Worker tests, 27 reliability tests,
  the build, and 19 desktop Chromium browser tests covering AI analysis,
  English UI, the golden path, device migration and the signed-in session.
  The full browser suite and VPS tests were not rerun.
- A follow-up production VPS probe with `8KkKuTCFvzI` returned HTTP 502
  before the language gate. Its trace reported `youtube_bot_check` and
  `signin_required`.
