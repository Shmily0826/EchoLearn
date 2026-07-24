# EchoLearn

A YouTube & Bilibili-powered English learning tool. Paste a video URL, get AI-curated vocabulary and sentence suggestions tailored to your CEFR level, then review them with spaced repetition.

**Live:** [app.echo-learn.uk](https://app.echo-learn.uk) (PWA + Android APK)

## Features

- **Auto transcript fetching** — Multi-strategy caption retrieval (InnerTube, web scraping, Invidious, Piped, Whisper ASR) with graceful fallback chain
- **AI-powered analysis** — DeepSeek analyzes transcripts to recommend vocabulary and sentences calibrated to CEFR levels (A1–C2)
- **Interactive transcripts** — Click any word for instant dictionary lookup with phonetics, audio, definitions, and recursive word exploration
- **Spaced repetition** — Review saved words and sentences on a 3→7→14→30 day schedule
- **Cloud sync** — Firebase Firestore for automatic cross-device sync, plus GitHub Gist backup
- **Bilingual UI** — Full English/Chinese interface toggle
- **Bilibili support** — Fetch subtitles from Bilibili videos alongside YouTube
- **PWA + Android** — Install as a PWA or use the native Android app (Capacitor)

## Tech Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Firebase Auth & Firestore · Capacitor 8 · DeepSeek API · Cloudflare Workers · Vercel Edge Functions · Recharts

## Architecture

```
Video URL → Parse videoId → Fetch captions (5-strategy cascade)
  → Normalize to sentences → Display with video player
  → AI analysis (DeepSeek) → Vocabulary & sentence suggestions
  → Save to localStorage → Sync to Firestore
  → Spaced repetition review
```

### Caption Fetching Cascade

The system tries multiple strategies in order until one succeeds:

1. **Local proxy** — Residential IP via Cloudflare Tunnel (optional, highest success rate)
2. **Vercel API** — Server-side `youtube-transcript` npm package
3. **Cloudflare Worker** — Edge-deployed proxy with 5 internal strategies:
   - InnerTube API (ANDROID / iOS / WEB / TV clients)
   - YouTube page HTML scraping
   - Invidious instances (10 third-party frontends)
   - Piped instances (6 third-party frontends)
   - Whisper ASR via Groq (audio transcription fallback)
4. **InnerTube direct** — Client-side API calls via Edge Function proxy
5. **Web scraping** — Extract `ytInitialPlayerResponse` from page HTML
6. **npm package** — Client-side `youtube-transcript` (last resort)

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

CF Worker secrets: `GROQ_API_KEY` (Whisper ASR fallback), `ALLOW_DEBUG` (set to `1` to enable debug logs)

See `.env.example` for a template.

## Legal & Compliance

- [Privacy Policy](https://app.echo-learn.uk/privacy.html)
- [Terms of Service](https://app.echo-learn.uk/terms.html)

**Transcript fetching disclaimer:** This app fetches YouTube/Bilibili captions via unofficial methods (InnerTube, page scraping, third-party frontends) for personal educational use. This may not comply with those platforms' Terms of Service. A manual transcript-paste fallback exists in the UI for full compliance. Use at your own risk; the developer assumes no liability for misuse.

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
cf-worker/          # Cloudflare Worker (caption proxy + Whisper ASR)
android/            # Capacitor Android project
```

## License

Private project. All rights reserved.
