import { describe, it, expect } from 'vitest';
import { resolveAppOrigin } from '../../../api/_shared/cors';

/**
 * The shared CORS origin policy. The previous per-file
 * `origin.endsWith('.vercel.app')` wildcard reflected ANY *.vercel.app
 * origin; these tests pin the exact-match contract so the wildcard can never
 * quietly come back (the handlers all delegate to this one helper).
 */
describe('resolveAppOrigin (shared CORS policy)', () => {
  it('allows the production origins', () => {
    expect(resolveAppOrigin('https://app.echo-learn.uk')).toBe('https://app.echo-learn.uk');
    expect(resolveAppOrigin('https://echo-learn.uk')).toBe('https://echo-learn.uk');
  });

  it('allows the local development origins', () => {
    expect(resolveAppOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveAppOrigin('http://localhost:4173')).toBe('http://localhost:4173');
    expect(resolveAppOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
  });

  it('rejects arbitrary vercel.app origins (the old wildcard hole)', () => {
    expect(resolveAppOrigin('https://evil.vercel.app')).toBeNull();
    expect(resolveAppOrigin('https://echolearn-clone.vercel.app')).toBeNull();
    expect(resolveAppOrigin('https://app.echo-learn-git-main.vercel.app')).toBeNull();
  });

  it('rejects lookalike and subdomain tricks', () => {
    expect(resolveAppOrigin('https://app.echo-learn.uk.evil.com')).toBeNull();
    expect(resolveAppOrigin('https://evil-app.echo-learn.uk')).toBeNull();
    expect(resolveAppOrigin('https://echo-learn.uk:8443')).toBeNull();
  });

  it('rejects garbage and absent origins', () => {
    expect(resolveAppOrigin(null)).toBeNull();
    expect(resolveAppOrigin(undefined)).toBeNull();
    expect(resolveAppOrigin('')).toBeNull();
    expect(resolveAppOrigin('not-a-url')).toBeNull();
  });
});
