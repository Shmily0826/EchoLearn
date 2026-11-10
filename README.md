# EchoLearn

A YouTube & Bilibili-powered English learning tool. Paste a video URL, get AI-curated vocabulary and sentence suggestions tailored to your CEFR level, then review them with spaced repetition.

**Live:** [echo-learn.uk](https://echo-learn.uk) (PWA + Android APK)

## Features

- **Transcript fetching** — Load YouTube or Bilibili captions, with an explicit transcription action when captions are unavailable.
- **AI-powered analysis** — Gemini (DeepSeek as a configurable alternative) analyzes transcripts to recommend vocabulary and sentences calibrated to CEFR levels (A1–C2)
- **Interactive transcripts** — Click any word for instant dictionary lookup with phonetics, audio, definitions, and recursive word exploration
- **Spaced repetition** — Review saved words and sentences at increasing intervals, with refreshers for mastered items
- **Cloud sync** — Firebase Firestore for automatic cross-device sync, plus GitHub Gist backup
- **Guest-friendly accounts** — Core study features work with no login (data stays on your device); optional sign-in (Google or email) unlocks cloud sync, feedback, and cross-device backup
- **Bilingual UI** — Full English/Chinese interface toggle
- **Bilibili support** — Resolve short links and study native captions when available, including multipart videos.
- **PWA + Android** — Install as a PWA or use the native Android app (Capacitor)

## Tech Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Firebase Auth & Firestore · Capacitor 8 · React Router 7 · Gemini API (DeepSeek optional) · Cloudflare Workers · Vercel Functions · FastAPI + yt-dlp (VPS service) · Recharts · Vercel Web Analytics

## Maintainer links

- [Documentation index](docs/README.md) says where each kind of record lives.
- [Architecture](docs/ARCHITECTURE.md) explains how the web app, Vercel API,
  Worker, VPS, Firebase and Android fit together.
- [Testing](docs/TESTING.md) lists daily checks, CI and specialist suites.
- [Maintenance scripts](scripts/README.md) lists local and live tools.
- [Release checklist](docs/RELEASE_CHECKLIST.md) tracks the current acceptance work.

## Accounts, Auth & Sync

EchoLearn is **guest-friendly**: watching videos, saving words/sentences, and spaced-repetition review all work with **no account** — data is stored locally (`localStorage`). Signing in is optional and unlocks cloud features.

- **Sign-in methods** — Google (OAuth via the custom auth domain `auth.echo-learn.uk`) or email + password.
- **Email verification** — Email sign-up sends a verification link. Cloud sync and feedback are **gated on a verified email**, enforced both in the UI and server-side in `firestore.rules`, so throwaway/fake emails cannot write data. Google accounts are auto-verified by Firebase.
- **Cloud sync backends** — (1) **Firebase Firestore** for automatic cross-device sync (requires a verified email); (2) **GitHub Gist** for manual PAT-scoped backup/restore.
- **Account deletion** — In Settings, permanently deletes your Firebase account, its cloud sync data, any feedback you submitted, the analyses your own account cached, and this device's study data (including imported audio and the GitHub backup credential). Firebase requires a recent sign-in for this, so you confirm your identity first and nothing is deleted until that succeeds. Two limits are stated rather than hidden: the **backup Gist itself is not deleted** from GitHub (only the local credential is cleared — delete the gist there if you want it gone), and feedback submitted **before 2026-09-20** used a document layout no client can enumerate, so removing it takes an administrator.

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
  `caption_failed`, `review_completed`, `pwa_install`,
  `pwa_installed_session`) fire from the relevant pages. Funnel events
  (`session_start`, `first_video_loaded`, `first_item_saved`) are defined in
  `src/services/analytics.ts`. Only runs in production builds.
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

## Getting started

Use Node 24 (see [`.nvmrc`](.nvmrc)) and run these commands from the repository root.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. Use guest mode and the bundled lesson to
try the study interface. The browser checks in the [testing guide](docs/TESTING.md)
use local fixtures for core journeys.

See [`.env.example`](.env.example) for supported environment options. Firebase
web settings are currently defined in [the client config](src/lib/firebase.ts).
The [architecture](docs/ARCHITECTURE.md) describes the external services, and the
[release checklist](docs/RELEASE_CHECKLIST.md) describes their separate release steps.

## Legal & Compliance

- [Privacy Policy](https://echo-learn.uk/privacy.html)
- [Terms of Service](https://echo-learn.uk/terms.html)

**Transcript fetching disclaimer:** This app fetches YouTube/Bilibili captions via unofficial methods (InnerTube, page scraping, third-party frontends) for personal educational use. This may not comply with those platforms' Terms of Service. A manual transcript-paste fallback exists in the UI for full compliance. Use at your own risk; the developer assumes no liability for misuse.

- **Your data & account** — Export your data anytime (Settings → Data Export) and delete your account (Settings → Delete account), which removes your Firebase account and all associated cloud data.

## License

Private project. All rights reserved.
