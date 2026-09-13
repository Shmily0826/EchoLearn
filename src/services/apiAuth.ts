import { auth } from '../lib/firebase';

/**
 * Authorization headers for authenticated AI proxy calls (/api/ai).
 *
 * The server verifies the Firebase ID token as a real trust boundary, so
 * authenticated users keep full AI enrichment while guests never reach the
 * provider. Returns {} for guests — callers should also skip AI work
 * client-side to avoid pointless 401 round-trips.
 */
export async function aiAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    // Token refresh failed (offline etc.) — let the server reject instead of
    // blocking the caller with a local error.
    return {};
  }
}
