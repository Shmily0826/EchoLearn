# EchoLearn VPS service

This FastAPI service is called by the Vercel API and the Cloudflare Worker.
See the [project architecture](../docs/ARCHITECTURE.md) for client routes and
the [release checklist](../docs/RELEASE_CHECKLIST.md) for deployed acceptance.

| Endpoint | Role |
| --- | --- |
| GET `/api/transcript` | Fetch platform captions by video ID or URL and return timed lines and language. |
| GET `/api/asr` | Extract audio from a URL and transcribe it through Groq. |
| POST `/api/audio-transcribe` | Legacy multipart audio-upload transcription. |
| GET `/api/audio` | Return playback MP3. Extracted audio can be reused from the VPS disk cache. |
| GET `/api/info` | Resolve media metadata, including Bilibili parts. |
| GET `/api/health` | Report service availability and ASR configuration without acquiring a video. |

The service implementation is in [`main.py`](main.py). YouTube acquisition
depends on the upstream response and available egress. Check the documented
[release evidence](../docs/RELEASE_CHECKLIST.md) before treating an acquisition
path as accepted.

## Local setup

Use Python 3.12 to match CI. From the repository root, in an activated virtual
environment, run:

```bash
python -m pip install -r vps-ytdlp/requirements.txt
npm run test:vps
```

To serve locally, run this from the repository root:

```bash
python -m uvicorn main:app --app-dir vps-ytdlp --host 127.0.0.1 --port 8000
```

This starts the actual service. Request `/api/health` to check it without
acquiring media. Running extraction or transcription requires the relevant
tools and credentials. The [Dockerfile](Dockerfile) describes the container
runtime and installs FFmpeg.

## Service configuration and release

- `YTDLP_API_KEY` protects caption, info, ASR and playback requests when set.
  The upload-transcription endpoint requires a key. Configure matching
  server-side credentials for the callers that use these routes.
- `YTDLP_PROXY` and `YTDLP_COOKIES` affect supported yt-dlp paths. Their
  applicability is platform- and route-specific. Bilibili has API-direct paths
  in addition to yt-dlp.
- `GROQ_API_KEY` enables transcription. `GROQ_MODEL` and
  `ASR_MAX_DURATION` control the model and maximum source length.
- `YTDLP_TIMEOUT` defaults to 180 seconds before per-route and caller limits.
  Caption and ASR caches are in memory. Playback audio is stored under
  `audio_cache/` on the VPS and has a separate lifecycle from Worker cache.

The VPS release is separate from the web and Worker releases. On an
authorized release, record the installed revision and service target, check
the existing process configuration, and verify its health before running any
provider-backed acceptance. The Worker uses `YTDLP_API_URL` for this service.
