# EchoLearn architecture

This map describes the source as released in `c1ec954` (2026-11-09). Use the
[testing guide](TESTING.md) to verify behaviour and the
[release checklist](RELEASE_CHECKLIST.md) to track deployment and acceptance.

## Components and release boundaries

| Component | Responsibility | Release boundary |
| --- | --- | --- |
| [Web and PWA](../src) | React study, review, dictionary UI, local persistence, and calls to backend services. Vite builds the web bundle and service worker. | Vercel web deployment from the Git integration. Repository release records document automatic production builds from `main`. |
| [Vercel API](../api) | Same-origin caption and Bilibili fallback APIs, YouTube metadata, dictionary, and the authenticated AI proxy. Provider keys stay on the server. | Released with the web project. [Function configuration](../vercel.json) owns the configured limits. |
| [Cloudflare Worker](../cf-worker/src/index.js) | Bilibili captions, explicit video ASR, legacy audio-upload transcription, media audio, and diagnostics. Owns Worker cache and daily quota checks. | Separate Wrangler release using [Worker configuration](../cf-worker/wrangler.toml). |
| [VPS](../vps-ytdlp/README.md) | FastAPI service for caption retrieval, metadata, audio extraction and Groq transcription. Vercel and the Worker call the relevant endpoints. | Separate VPS service release. Its installed revision and health are checked independently of GitHub and Vercel. |
| [Firebase](../src/lib/firebase.ts) | Auth, verified-account sync, feedback and per-user AI cache. [Firestore rules](../firestore.rules) enforce access. | Firebase rules have their own release and propagation checks. See the [rules runbook](../deploy/RULES_RELEASE.md). |
| [Android](../android) | Capacitor shell with native integrations. The current shell loads the hosted web app according to [Capacitor config](../capacitor.config.ts). | Native changes require a separate APK build and installation. Hosted web changes can reach installed shells without an APK rebuild. |
| [Local proxy](../local-proxy) | Optional developer-operated caption route with separate network egress. | Started independently and explicitly enabled for the client. |

## Study paths

**YouTube captions.** The [client](../src/services/youtubeTranscript.ts) uses
same-origin `/api/transcript` for the ordinary server request. An explicitly
enabled local proxy can run first. The [Vercel handler](../api/transcript.ts)
tries VPS captions, then Supadata when configured, then its npm fallback
within the request budget. The client can try its own fallback strategies.
Retry re-runs acquisition. Generate transcript explicitly requests ASR through
the Worker. The [caption error contract](CAPTION_ERROR_CONTRACT.md) defines
typed failures shared by these layers.

**Bilibili captions.** The [client](../src/services/bilibiliTranscript.ts)
tries the Worker's caption-only route with same-origin
[Vercel fallback](../api/bilibili.ts). Explicit ASR uses the Worker.
Metadata and playback audio have separate requests. Worker
`/api/audio` looks for a complete edge-cache entry before checking quota and
calling the VPS. It then serves the requested byte range. The
[VPS audio cache](../vps-ytdlp/main.py) is separate and stores extracted audio on
disk. A Worker miss identifies a request to the VPS and can still be a VPS
disk-cache hit. The [audio player](../src/components/AudioPlayer.tsx) can
switch to the Vercel audio fallback after errors. That route forwards ranges to
the VPS and uses its own per-instance IP rate limiter.

**Local audio.** A learner can import audio with subtitles and study it in the
browser. The [local media service](../src/services/localAudio.ts) stores the
audio in IndexedDB. Legacy audio-upload transcription is a separate path.

**AI analysis.** Study passes the transcript to
[the client analysis service](../src/services/aiAnalysis.ts), which builds a
CEFR shortlist and calls [`/api/ai`](../api/ai.ts). The proxy handles provider
authentication and streaming. The client filters vocabulary against the
offered candidates and can fall back to local suggestions. Study binds saved
analysis to a transcript fingerprint. The versioned Firestore analysis cache
belongs to the verified user and has a separate lifecycle from saved lessons.

**Study data.** [Browser storage](../src/utils/storage.ts) holds study data and
deletion markers. [Firestore sync](../src/services/firestoreSync.ts) merges
verified users' words, sentences and lightweight session records with
tombstones. Transactions protect uploads against a competing write. The
browser retains full transcripts and local audio on the originating device.

## Where to look next

- Caption timeouts and provider order live in the callers above. The
  [September budget register](CAPTION_BUDGETS.md) and
  [old caption map](archive/maintenance/caption-architecture-2026-09-06.md)
  retain the historical investigation.
- [Decision history](DECISIONS.md) and [validation evidence](archive/test-report-2026-08-to-10.md)
  keep dated records.
- [Maintenance scripts](../scripts/README.md) separate local checks from live
  probes and release helpers.
