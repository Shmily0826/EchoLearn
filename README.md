# EchoLearn

A YouTube & Bilibili-powered English learning tool. Paste a video URL, get AI-curated vocabulary and sentence suggestions tailored to your CEFR level, then review them with spaced repetition.

**Live:** [echo-learn.uk](https://echo-learn.uk) (PWA + Android APK) — `app.echo-learn.uk` is a legacy alias that 301-redirects here

## Features

- **Auto transcript fetching** — Two-tier fallback: a local proxy on the developer's machine (residential IP, preferred) and a 7×24 server-side path (Cloudflare Worker fronting a VPS yt-dlp service), degrading gracefully to InnerTube / scraping / Whisper when needed
- **AI-powered analysis** — DeepSeek analyzes transcripts to recommend vocabulary and sentences calibrated to CEFR levels (A1–C2)
- **Interactive transcripts** — Click any word for instant dictionary lookup with phonetics, audio, definitions, and recursive word exploration
- **Spaced repetition** — Review saved words and sentences on a 3→7→14→30 day schedule
- **Cloud sync** — Firebase Firestore for automatic cross-device sync, plus GitHub Gist backup
- **Guest-friendly accounts** — Core study features work with no login (data stays on your device); optional sign-in (Google or email) unlocks cloud sync, feedback, and cross-device backup
- **Bilingual UI** — Full English/Chinese interface toggle
- **Bilibili support (experimental)** — Caption fetching works at the backend level; UI surfacing is planned. YouTube remains the fully-supported primary source
- **PWA + Android** — Install as a PWA or use the native Android app (Capacitor)

## Tech Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Firebase Auth & Firestore · Capacitor 8 · React Router 7 · DeepSeek API · Cloudflare Workers · Vercel Edge Functions · FastAPI + yt-dlp (VPS caption service) · Recharts · Vercel Web Analytics (privacy-first, no cookies)

## Architecture

```
Video URL → Parse videoId → Fetch captions (two-tier fallback: local proxy → CF Worker → VPS yt-dlp)
  → Normalize to sentences → Display with video player
  → AI analysis (DeepSeek) → Vocabulary & sentence suggestions
  → Save to localStorage → Sync to Firestore
  → Spaced repetition review
```

### Caption Fetching — two-tier fallback

The web app always fetches captions through one of two tiers, automatically:

**Tier 1 — Local proxy (developer's PC, client-side, preferred)**
- Default endpoint `proxy.echo-learn.uk` is a Cloudflare Tunnel to the
  developer's machine (`local-proxy/`), which uses a residential IP.
- Tried first on every request. If the PC/tunnel is offline, the request
  fails fast (4s timeout) and is skipped for the next 5 minutes, then retried.
- Highest success rate because it is not a throttled datacenter IP.

**Tier 2 — Server-side (CF Worker, 7×24)**
- Reached automatically when Tier 1 is unavailable. First the Vercel
  same-origin `/api/transcript`, then the Cloudflare Worker.
- The Worker tries, in order:
  1. **VPS yt-dlp** (Strategy 0) — a small always-on FastAPI service
     (`vps-ytdlp/`) running yt-dlp with the TVHTML5 client signature, which
     fetches captions **without a residential proxy**. Gated by the
     `YTDLP_API_URL` secret; deploy it on Oracle Cloud Always-Free ($0) so
     other users keep getting captions even when the developer's PC is off.
  2. InnerTube (ANDROID / iOS / WEB / TV clients)
  3. YouTube page HTML scraping
  4. Whisper ASR via Groq (audio transcription — only for no-caption videos,
     and only effective with `YTDLP_PROXY` since datacenter IPs cannot
     download YouTube audio)
  5. Invidious / Piped instances (third-party frontends)

> **Reality check:** Strategies 2–5 run from Cloudflare's datacenter IPs,
> which YouTube throttles/blocks intermittently (`LOGIN_REQUIRED`, 403/530 on
> public frontends). In practice they are an unreliable safety net. The two
> paths that actually work are the local proxy (Tier 1) and the VPS yt-dlp
> service (Tier 2.1). See `vps-ytdlp/README.md` for the free-tier deploy
> steps.

## Accounts, Auth & Sync

EchoLearn is **guest-friendly**: watching videos, saving words/sentences, and spaced-repetition review all work with **no account** — data is stored locally (`localStorage`). Signing in is optional and unlocks cloud features.

- **Sign-in methods** — Google (OAuth via the custom auth domain `auth.echo-learn.uk`) or email + password.
- **Email verification** — Email sign-up sends a verification link. Cloud sync and feedback are **gated on a verified email**, enforced both in the UI and server-side in `firestore.rules`, so throwaway/fake emails cannot write data. Google accounts are auto-verified by Firebase.
- **Cloud sync backends** — (1) **Firebase Firestore** for automatic cross-device sync (requires a verified email); (2) **GitHub Gist** for manual PAT-scoped backup/restore.
- **Account deletion** — In Settings, permanently deletes your Firebase account and all associated cloud data (local data optional).

## Product Analytics

Two complementary layers (both privacy-first, no third-party cookies):

**1. Anonymous reach — Vercel Web Analytics**
- Enabled in the Vercel dashboard (Web Analytics toggle). The `<Analytics />`
  component (`src/main.tsx`) injects the script at runtime; no code config.
- See: Vercel dashboard → your project → **Analytics** tab (PV/UV, referrers,
  country, device, plus the product events below).

**2. User-level behaviour — Firebase Analytics + Firebase Console**
- Firebase Analytics is wired in `src/services/analytics.ts`: every
  `trackEvent` reports to BOTH Vercel and Firebase. Auth events `sign_up` /
  `login` are fired from `src/contexts/AuthContext.tsx`; product events
  (`video_studied`, `word_saved`, `sentence_saved`, `ai_analysis_used`,
  `pwa_install`) fire from the relevant pages. Only runs in production builds.
- See registered-user counts and per-user data directly in the Firebase
  console (no code needed):
  - **Registration count** — Firebase console → **Authentication → Users**
    (total + recent sign-ups; the `method` = email/google breakdown shows up
    once Firebase Analytics is linked to the project).
  - **Per-user study data** — Firestore → browse `users/{uid}/data/sessions`
    (each YouTube video studied = one "deck"), `vocabulary`, `sentences`.
    Count documents / items to see how many sessions each user created and how
    much they saved.
- The Firebase Analytics dashboard (Firebase console → **Analytics**) adds
  funnels, DAU/WAU/MAU and retention on top of those events.

> Note: Firebase Analytics collects device/geo like Vercel does. If you later
> get meaningful EU traffic, add a consent gate before `getAnalytics()` in
> `src/services/analytics.ts`.

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Deploy CF Worker (caption proxy)
cd cf-worker && npx wrangler deploy
```

### Environment Variables

Create a `.env.local` file (never committed) with the following:

| Variable | Location | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Vercel (server) | DeepSeek API key — held server-side in `api/ai.ts`, never in the client bundle |
| `YOUTUBE_API_KEY` | Vercel (server) | YouTube Data API v3 key — held server-side in `api/youtube.ts` |
| `VITE_FIREBASE_*` | Client (.env.local) | Firebase project web config (public by design, secured via Firestore Rules) |
| `VITE_YOUTUBE_PROXY` | Client (.env.production) | (Optional) Custom YouTube CORS proxy base URL |

CF Worker secrets: `YTDLP_API_URL` (base URL of the VPS yt-dlp service, e.g. `https://yt-api.echo-learn.uk` — enables Strategy 0), `YTDLP_API_KEY` (optional shared key protecting that endpoint), `GROQ_API_KEY` (Whisper ASR fallback), `SCRAPE_API_KEY` (optional ScrapingBee/ZenRows gateway), `ALLOW_DEBUG` (set to `1` to enable debug logs)

See `.env.example` for a template.

### Firebase setup (required for auth & sync)

The repo already ships `firebase.json` and `.firebaserc` (project `echolearn-9f369`), so no `firebase init` is needed. Two manual steps remain on your Firebase project:

1. **Enable Email/Password sign-in** — Firebase console → Authentication → Sign-in method → add **Email/Password**. Without it, email sign-up fails with `auth/operation-not-allowed`.
2. **Deploy Firestore rules** — rules live in `firestore.rules` but are **not** deployed by Vercel. Run:
   ```bash
   firebase deploy --only firestore:rules
   ```
   These rules require a verified email for all cloud writes.

## Legal & Compliance

- [Privacy Policy](https://echo-learn.uk/privacy.html)
- [Terms of Service](https://echo-learn.uk/terms.html)

**Transcript fetching disclaimer:** This app fetches YouTube/Bilibili captions via unofficial methods (InnerTube, page scraping, third-party frontends) for personal educational use. This may not comply with those platforms' Terms of Service. A manual transcript-paste fallback exists in the UI for full compliance. Use at your own risk; the developer assumes no liability for misuse.

- **Your data & account** — Export your data anytime (Settings → Data Export) and delete your account (Settings → Delete account), which removes your Firebase account and all associated cloud data.

## Project Structure

```
src/
├── pages/          # Dashboard, Study, Vocabulary, Sentences, Review, Settings, Login
├── components/     # YouTubeEmbed, TranscriptViewer, AIAnalysisPanel, WordDictionaryPopup, etc.
├── services/       # youtubeTranscript, aiAnalysis, dictionaryService, firestoreSync, etc.
├── utils/          # storage, transcriptNormalizer, lemmatizer, URL parsers
├── hooks/          # useAntiTranslate, useInstallPrompt
├── i18n/           # English/Chinese translations
├── contexts/       # AuthContext (Firebase Auth)
└── types/          # TypeScript interfaces
api/                # Vercel Serverless & Edge Functions
cf-worker/          # Cloudflare Worker (caption proxy; front-ends the VPS yt-dlp + fallback strategies)
vps-ytdlp/          # FastAPI + yt-dlp service deployed on a VPS (server-side caption source)
android/            # Capacitor Android project
```

## License

Private project. All rights reserved.
