/**
 * Firebase ID token verification for API routes (Node runtime).
 *
 * Establishes the real authentication trust boundary for /api/ai: provider
 * keys must only be spent for authenticated users. Verifies Firebase Auth
 * ID tokens against Google's public JWKS (RS256) without adding a
 * firebase-admin dependency:
 *
 *   1. Authorization: Bearer <idToken> (client: auth.currentUser.getIdToken())
 *   2. Signature verified against Google's public JWK set for
 *      securetoken@system.gserviceaccount.com (cached in memory, 1h).
 *   3. Standard Firebase ID token claims enforced: iss, aud, exp, iat, sub.
 *
 * Fails closed: any problem (missing/garbage token, unknown kid, bad
 * signature, expired, wrong project) returns null → callers must reject the
 * request before touching any provider.
 */
import crypto from 'node:crypto';

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Firebase project IDs are public identifiers (they ship in the client web
 * config), so falling back to the bundled project ID keeps deployments working
 * without extra env configuration. Override with FIREBASE_PROJECT_ID if needed.
 */
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'echolearn-9f369';

const JWKS_TTL_MS = 60 * 60 * 1000;

interface FirebaseJwk {
  kid: string;
  n: string;
  e: string;
  kty?: string;
  alg?: string;
  use?: string;
}

interface JwksCache {
  keys: Map<string, crypto.KeyObject>;
  fetchedAt: number;
}

let jwksCache: JwksCache | null = null;

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchJwks(): Promise<Map<string, crypto.KeyObject>> {
  const res = await fetch(FIREBASE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: FirebaseJwk[] };
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
    try {
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }));
    } catch { /* skip malformed key */ }
  }
  if (keys.size === 0) throw new Error('JWKS contained no usable RSA keys');
  return keys;
}

async function getPublicKeys(): Promise<Map<string, crypto.KeyObject> | null> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  // Strictly fail-closed once the cache is expired: a failed refresh must NOT
  // fall back to stale keys, or an expired key set would be trusted forever
  // during a prolonged Google outage. Availability trade-off is accepted —
  // AI enrichment for authenticated users is briefly unavailable until the
  // JWKS endpoint answers again. TTL is intentionally a fixed 1h (not parsed
  // from Cache-Control) to keep this cache simple.
  try {
    const keys = await fetchJwks();
    jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
  } catch {
    return null;
  }
}

export interface VerifiedIdentity {
  uid: string;
}

/**
 * Verifies the request's `Authorization: Bearer <Firebase ID token>` header.
 * Returns the authenticated uid, or null when the request is not reliably
 * authenticated. Never throws.
 */
export async function verifyFirebaseIdToken(
  authorization: string | null | undefined,
): Promise<VerifiedIdentity | null> {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

  const keys = await getPublicKeys();
  if (!keys) return null;
  const key = keys.get(header.kid);
  if (!key) return null;

  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  const signatureValid = crypto
    .createVerify('RSA-SHA256')
    .update(`${parts[0]}.${parts[1]}`)
    .verify(key, signature);
  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) return null;
  const authTime = payload.auth_time;
  if (typeof authTime !== 'number' || !Number.isFinite(authTime) || authTime > now) return null;
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (payload.aud !== PROJECT_ID) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;

  return { uid: payload.sub };
}

/** Test-only: clear the in-memory JWKS cache between cases. */
export function clearJwksCacheForTests(): void {
  jwksCache = null;
}
