import { expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Signed-in session fixture for specs that need `useAuth().user` to be non-null.
 *
 * AI Analyze and both bulk-translation actions are authenticated-only: the UI
 * gates them behind `if (!user)` and `/api/ai` rejects unauthenticated callers
 * with 401 before it touches a provider. The guest suites therefore cannot
 * reach those flows at all.
 *
 * This helper makes the real Firebase SDK commit a signed-in state without any
 * call to Firebase, so those flows stay testable in CI with no credentials, no
 * Production writes and no provider spend.
 *
 * Mechanism (verified 2026-09-16; evidence in TEST_REPORT.md):
 *   1. Write the SDK's own persistence record into IndexedDB, then boot the page
 *      under test in the same BrowserContext so the SDK reads it while
 *      initialising. IndexedDB is per-context, so the two pages must share one.
 *   2. Intercept every Firebase endpoint the SDK attempts, so nothing real is
 *      reachable even if the SDK decides to revalidate or refresh.
 *
 * Two traps this helper exists to hide:
 *   - Route rules must match the URL's hostname, never the whole URL. A rule
 *     like /firestore/ also matches the dev server's module request for
 *     /src/services/firestoreSync.ts, which aborts it and renders a blank app.
 *   - The fabricated identity is deliberately synthetic. Nothing here should
 *     depend on a real credential, so CI needs no secret and cannot write to
 *     Production. The client never verifies token signatures; only the server
 *     does, and /api/ai is route-mocked in these specs.
 */

const APP_BASE = 'http://localhost:5173';

export interface SyntheticIdentity {
  uid: string;
  email: string;
  /** Defaults to true; set false to fabricate an unverified signed-in user. */
  emailVerified?: boolean;
}

/** A fabricated identity that corresponds to no real account. */
export const SYNTHETIC_IDENTITY: SyntheticIdentity = {
  uid: 'e2e-synthetic-user',
  email: 'e2e-synthetic@example.invalid',
};

/** A fabricated signed-in user whose email is NOT verified (sync impossible). */
export const SYNTHETIC_IDENTITY_UNVERIFIED: SyntheticIdentity = {
  uid: 'e2e-synthetic-unverified',
  email: 'e2e-synthetic-unverified@example.invalid',
  emailVerified: false,
};

export interface FirebaseRouteLog {
  /** Firebase endpoints the SDK attempted; all were answered or aborted. */
  intercepted: string[];
  /** Requests to Firebase data/telemetry hosts that were aborted outright. */
  aborted: string[];
}

/**
 * Read the public Firebase web config from source. These are public identifiers
 * (they ship in the client bundle), so this is not a secret lookup.
 */
function readFirebaseWebConfig(): { apiKey: string; projectId: string } {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/firebase.ts'), 'utf8');
  const apiKey = source.match(/apiKey:\s*'([^']+)'/)?.[1];
  const projectId = source.match(/projectId:\s*'([^']+)'/)?.[1];
  if (!apiKey || !projectId) {
    throw new Error('sessionFixture: could not read apiKey/projectId from src/lib/firebase.ts');
  }
  return { apiKey, projectId };
}

/**
 * Intercept the Firebase endpoints the SDK uses, answering auth calls with
 * synthetic responses and blocking the data plane. Returns a log so a spec can
 * assert the SDK really did go down this path.
 */
export async function armFirebaseRoutes(
  page: Page,
  identity: SyntheticIdentity = SYNTHETIC_IDENTITY,
): Promise<FirebaseRouteLog> {
  const { projectId } = readFirebaseWebConfig();
  const log: FirebaseRouteLog = { intercepted: [], aborted: [] };

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // Non-hierarchical URL (data:, blob:, ...); fall through to continue().
    }

    if (host === 'identitytoolkit.googleapis.com') {
      log.intercepted.push(`identitytoolkit:${url.replace(/\?.*$/, '')}`);
      if (/accounts:lookup/.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            kind: 'identitytoolkit#GetAccountInfoResponse',
            users: [{
              localId: identity.uid,
              email: identity.email,
              emailVerified: identity.emailVerified ?? true,
              providerUserInfo: [{
                providerId: 'password',
                federatedId: identity.email,
                email: identity.email,
                rawId: identity.email,
              }],
            }],
          }),
        });
      }
      return route.abort();
    }

    if (host === 'securetoken.googleapis.com') {
      log.intercepted.push(`securetoken:${url.replace(/\?.*$/, '')}`);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'synthetic-access-token',
          expires_in: '3600',
          token_type: 'Bearer',
          refresh_token: 'synthetic-refresh-token',
          id_token: 'synthetic-id-token',
          user_id: identity.uid,
          project_id: projectId,
        }),
      });
    }

    // Data plane and Google telemetry: unreachable on purpose.
    if (
      host === 'firestore.googleapis.com' ||
      host === 'firebaseio.com' ||
      host.endsWith('.firebaseio.com') ||
      host === 'jnn-pa.googleapis.com'
    ) {
      log.aborted.push(url.replace(/\?.*$/, ''));
      return route.abort();
    }

    await route.continue();
  });

  return log;
}

/** App storage defaults so specs do not fight the language picker or the tour. */
async function installAppStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_guest_mode');
  });
}

/**
 * Write the Firebase SDK's own signed-in persistence record.
 *
 * Uses a throwaway page in the same context and closes it afterwards, so the
 * page under test reads the record during its own initialisation.
 */
export async function seedSignedInSession(
  context: BrowserContext,
  identity: SyntheticIdentity = SYNTHETIC_IDENTITY,
): Promise<void> {
  const { apiKey } = readFirebaseWebConfig();
  const seedPage = await context.newPage();
  try {
    await armFirebaseRoutes(seedPage, identity);
    await installAppStorage(seedPage);
    await seedPage.goto(APP_BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const writtenUid = await seedPage.evaluate(async ({ apiKey, identity }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('firebaseLocalStorageDb', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const store = database
        .transaction('firebaseLocalStorage', 'readwrite')
        .objectStore('firebaseLocalStorage');
      const key = `firebase:authUser:${apiKey}:[DEFAULT]`;
      const value = {
        uid: identity.uid,
        email: identity.email,
        emailVerified: identity.emailVerified ?? true,
        displayName: 'E2E Synthetic',
        isAnonymous: false,
        photoURL: null,
        phoneNumber: null,
        tenantId: null,
        providerData: [{
          providerId: 'password',
          uid: identity.email,
          displayName: null,
          email: identity.email,
          phoneNumber: null,
          photoURL: null,
        }],
        stsTokenManager: {
          refreshToken: 'synthetic-refresh-token',
          accessToken: 'synthetic-access-token',
          // In the future, so the SDK uses the stored token instead of refreshing.
          expirationTime: Date.now() + 3_600_000,
        },
        createdAt: '1',
        lastLoginAt: '1',
        apiKey,
        appName: '[DEFAULT]',
      };

      await new Promise<void>((resolve, reject) => {
        const request = store.put({ fbase_key: key, value });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      const readBack = await new Promise<{ value?: { uid?: string } } | undefined>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return readBack?.value?.uid ?? null;
    }, { apiKey, identity });

    expect(
      writtenUid,
      'seedSignedInSession: the SDK persistence record did not read back, so the session cannot be faked',
    ).toBe(identity.uid);
  } finally {
    await seedPage.close();
  }
}

/**
 * Arm the Firebase routes, seed a signed-in session, boot the app and wait until
 * the authenticated shell is up. This is the entry point most specs want.
 *
 * Contract guard: if the fabricated session stops working (for example a future
 * Firebase SDK changes its persistence shape), this fails here with a clear
 * message rather than as an unexplained UI assertion far downstream.
 */
export async function openSignedInApp(
  context: BrowserContext,
  page: Page,
  identity: SyntheticIdentity = SYNTHETIC_IDENTITY,
): Promise<FirebaseRouteLog> {
  const log = await armFirebaseRoutes(page, identity);
  await installAppStorage(page);
  await seedSignedInSession(context, identity);

  await page.goto(APP_BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await expect(
    page.getByRole('button', { name: /^(Try without login|先体验一下)$/ }),
    'the login page is still showing, so the fabricated session was not accepted',
  ).toBeHidden({ timeout: 20_000 });

  await expect(
    page.locator('a[href="/study"]').filter({ visible: true }).first(),
    'the authenticated shell never rendered; useAuth().user is probably still null',
  ).toBeVisible({ timeout: 20_000 });

  return log;
}
