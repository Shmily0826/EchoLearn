/**
 * Shared CORS origin policy for every /api route.
 *
 * Exact-match allowlist only. The previous per-file
 * `origin.endsWith('.vercel.app')` wildcard reflected the Origin header for
 * ANY free Vercel site, letting a lookalike deployment read cross-origin
 * responses from these endpoints. Vercel deployments (production and preview)
 * always call their own /api functions same-origin, so no wildcard is needed;
 * local development is covered by the explicit localhost entries.
 */
const ALLOWED_ORIGINS = new Set([
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

export function resolveAppOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}
