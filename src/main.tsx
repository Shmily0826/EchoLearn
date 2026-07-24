import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

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
  </StrictMode>,
)
