import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { Analytics } from '@vercel/analytics/react'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Auto-update the PWA: when a new service worker is detected after a deploy,
// it installs, takes control, and reloads the page to serve the new bundle.
// Without this, already-open PWA tabs kept serving the old cached JS until a
// manual hard refresh (vite-plugin-pwa's injected registerSW.js lacks the
// auto-reload wiring).
registerSW({ immediate: true })

// Sentry error monitoring — only active when DSN is configured (production)
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
// Must match the `release.name` set in vite.config.ts so uploaded source maps
// attach to the correct release in the Sentry UI.
const SENTRY_RELEASE = 'echolearn-web@prod';
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.PROD ? 'production' : 'development',
    release: SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)
