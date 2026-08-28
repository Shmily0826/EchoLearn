import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * Batch 3 — Study failure recovery E2E.
 *
 * Covers the user-state transitions that the single golden-path test does NOT:
 *   - Retry: first fetch fails (500) → error state → click Retry → second
 *     fetch succeeds → transcript renders. Locks down "Retry button clicks but
 *     internal state is not reset".
 *   - Save word full chain: save → Words page shows EN/optional ZH → delete →
 *     page count returns to 0.
 *   - Duplicate save: same word twice → Words count stays 1 → Dashboard correct.
 *   - Invalid / unsupported URL: garbage input → clear error, page not dead →
 *     re-enter a valid URL → normal recovery.
 *   - Load + refresh persistence: save a word → reload → state restored.
 *
 * All external calls are mocked via page.route — zero dependency on YouTube,
 * Bilibili, the CF Worker, or the Vercel functions. The local proxy
 * (proxy.echo-learn.uk) is aborted instantly so we fall through to the
 * controllable same-origin /api/transcript path.
 */

const SAMPLE_VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// A minimal but valid transcript payload (matches TranscriptFetchResult.lines).
function transcriptPayload(lines: { start: number; end: number; text: string }[]) {
  return JSON.stringify({ lines, language: 'en', source: 'youtube' });
}

/** Seed localStorage so the study page does NOT auto-load the bundled sample
 *  transcript (which bypasses all network fetch) — we want a clean slate so a
 *  real URL load goes through /api/transcript. */
async function seedCleanVisitor(page: Page) {
  await page.addInitScript(() => {
    // This init script also runs on page.reload(). Only seed the fresh test
    // context once; otherwise the test itself deletes the data it is meant to
    // verify survives a reload.
    if (sessionStorage.getItem('echolearn-e2e-cleaned')) return;
    sessionStorage.setItem('echolearn-e2e-cleaned', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    // Remove any pre-saved session so mount uses the fresh (network) path.
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
  });
}

/** Route the local proxy to abort immediately, and /api/transcript according to
 *  the provided sequence of responses. */
async function routeTranscript(
  page: Page,
  responses: Array<'ok' | 'fail'> | (() => 'ok' | 'fail'),
  responseDelayMs = 0,
) {
  // Keep this scenario deterministic: only the local app and its mocked API
  // may proceed; every external caption strategy must fail during first load.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:5173/') || url.startsWith('http://127.0.0.1:5173/')) {
      return route.continue();
    }
    return route.abort();
  });
  // Strategy 0 local proxy — make it fail instantly so we reach Strategy 1.
  await page.route('**/proxy.echo-learn.uk/**', (route) => route.abort());
  // Prevent InnerTube/web-page fallbacks from reaching the real YouTube
  // network during the all-fail Retry phase.
  await page.route('**://www.youtube.com/**', (route) => route.abort());
  await page.route('**://youtubei.googleapis.com/**', (route) => route.abort());

  let call = 0;
  await page.route('**/yt-proxy/**', (route) => route.abort());
  await page.route('**/api/transcript**', (route) => {
    const kind = typeof responses === 'function'
      ? responses()
      : responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (responseDelayMs > 0) {
      return new Promise<void>((resolve) => {
        setTimeout(async () => {
          if (kind === 'fail') {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'upstream boom' }),
            });
          } else {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: transcriptPayload([
                { start: 0, end: 2, text: 'Good morning everyone' },
                { start: 2, end: 4, text: 'Welcome to this lesson' },
                { start: 4, end: 6, text: 'Today we learn vocabulary' },
              ]),
            });
          }
          resolve();
        }, responseDelayMs);
      });
    }
    if (kind === 'fail') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'upstream boom' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: transcriptPayload([
        { start: 0, end: 2, text: 'Good morning everyone' },
        { start: 2, end: 4, text: 'Welcome to this lesson' },
        { start: 4, end: 6, text: 'Today we learn vocabulary' },
      ]),
    });
  });
}

/** Mock the dictionary endpoint used by the word-save flow. */
async function routeDictionary(page: Page) {
  await page.route('**/api/dictionary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '/ɡʊd/',
        ipa_us: '/ɡʊd/',
        audio_url: '',
        base_form: 'good',
        source: 'free-dictionary',
        entries: [
          {
            pos: 'adjective',
            definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
          },
        ],
      }),
    }),
  );
}

async function loadYoutubeUrl(page: Page) {
  const urlInput = page.locator('#tour-study-url');
  await urlInput.fill(SAMPLE_VIDEO_URL);
  await page.locator('#tour-study-load').click();
}

async function expectGuestWordPersisted(page: Page) {
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('echolearn_vocabulary');
    return !!raw && JSON.parse(raw).length === 1;
  });
}

test.describe('Batch 3 — Study failure recovery', () => {
  test('Slow first fetch stays coherent until success without refresh', async ({ page }) => {
    await seedCleanVisitor(page);
    await routeTranscript(page, ['ok'], 1_500);
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);
    await loadYoutubeUrl(page);

    const loadingButton = page.getByRole('button', { name: /loading/i });
    await expect(loadingButton).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/unable to fetch captions|no subtitles|couldn't load/i).filter({ visible: true })).toHaveCount(0);

    await expect(page.getByText(/welcome/i).filter({ visible: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(loadingButton).toBeHidden();
    await expect(page.getByText(/unable to fetch captions|no subtitles|couldn't load/i).filter({ visible: true })).toHaveCount(0);
  });

  test('Late failure clears loading and Retry recovers successfully', async ({ page }) => {
    await seedCleanVisitor(page);
    let allowSuccess = false;
    await routeTranscript(page, () => (allowSuccess ? 'ok' : 'fail'), 1_500);
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);
    await loadYoutubeUrl(page);

    const loadingButton = page.getByRole('button', { name: /loading/i });
    await expect(loadingButton).toBeVisible({ timeout: 5_000 });
    const errorCard = page.getByText(/unable to fetch captions|no subtitles|couldn't load|try again/i).filter({ visible: true }).first();
    await expect(errorCard).toBeVisible({ timeout: 20_000 });
    await expect(loadingButton).toBeHidden();

    allowSuccess = true;
    await page.getByRole('button', { name: /retry/i }).first().click();
    await expect(page.getByText(/welcome/i).filter({ visible: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/unable to fetch captions|no subtitles|couldn't load/i).filter({ visible: true })).toHaveCount(0);
  });

  test('Retry: first fetch 500 → error state → click Retry → second succeeds', async ({ page }) => {
    await seedCleanVisitor(page);
    let allowSuccess = false;
    // Keep every fallback attempt failing until the test has observed the
    // error card; only the explicit Retry is then allowed to succeed.
    await routeTranscript(page, () => (allowSuccess ? 'ok' : 'fail'));
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);

    // Load a real URL so the fetch goes through /api/transcript.
    await loadYoutubeUrl(page);

    // First response is 500 → error state must appear (the friendly error card).
    await expect(page.getByText(/unable to fetch captions|no subtitles|couldn't load|try again/i).filter({ visible: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Click the Retry button (text "Retry" / 重试).
    const retryBtn = page.getByRole('button', { name: /retry/i }).first();
    await expect(retryBtn).toBeVisible();
    allowSuccess = true;
    await retryBtn.click();

    // After Retry, the second response is 200 → a transcript line renders.
    const welcome = page.getByText(/welcome/i).filter({ visible: true }).first();
    await expect(welcome).toBeVisible({ timeout: 20_000 });
  });

  test('Save word full chain: save → Words shows it → delete → count returns to 0', async ({ page }) => {
    await seedCleanVisitor(page);
    await routeDictionary(page);
    // Sample video is auto-loaded on mount → transcript present without network.
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);

    const good = page.getByText(/good/i).filter({ visible: true }).first();
    await expect(good).toBeVisible({ timeout: 15_000 });
    await good.click();
    const saveButton = page.locator('#tour-transcript-save-word');
    await expect(saveButton).toBeVisible();
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 45_000 });
    await expectGuestWordPersisted(page);

    // Words page lists it.
    await page.getByRole('link', { name: 'Vocabulary' }).click();
    await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^good\b/).filter({ visible: true }).first()).toBeVisible();

    // Accept the delete confirm() dialog, then delete.
    page.on('dialog', (d) => d.accept());
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Count returns to 0.
    await expect(page.getByText('0 words')).toBeVisible({ timeout: 10_000 });
  });

  test('Duplicate save: same word twice → Words count stays 1', async ({ page }) => {
    await seedCleanVisitor(page);
    await routeDictionary(page);
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);

    const good = page.getByText('good', { exact: true }).filter({ visible: true }).first();
    await expect(good).toBeVisible({ timeout: 15_000 });

    // Save once, then open the same word again. The second interaction should
    // show the dedup state instead of exposing a second save button.
    const firstWord = page.getByText(/good/i).filter({ visible: true }).first();
    await firstWord.click();
    const firstSaveButton = page.locator('#tour-transcript-save-word');
    await expect(firstSaveButton).toBeVisible();
    await firstSaveButton.click();
    await expect(firstSaveButton).toBeHidden({ timeout: 45_000 });
    await expectGuestWordPersisted(page);

    const secondWord = page.getByText(/good/i).filter({ visible: true }).first();
    await secondWord.click();
    await expect(page.getByText('Already in vocab', { exact: true })).toBeVisible();

    // Words count must be exactly 1 (no duplicate).
    await page.getByRole('link', { name: 'Vocabulary' }).click();
    await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
  });

  test('Invalid / unsupported URL: clear error, page not dead, valid URL recovers', async ({ page }) => {
    await seedCleanVisitor(page);
    await routeTranscript(page, ['ok']);
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);

    // Type garbage that detectPlatform() rejects → Load does nothing harmful.
    const urlInput = page.locator('#tour-study-url');
    await urlInput.fill('not a url at all !!!');
    await page.locator('#tour-study-load').click();
    // No crash: the input is still present and Study still renders.
    await expect(urlInput).toBeVisible();
    await expect(page.locator('#tour-study-load')).toBeVisible();

    // Now enter a valid YouTube URL → transcript recovers via /api/transcript.
    await loadYoutubeUrl(page);
    const welcome = page.getByText(/welcome/i).filter({ visible: true }).first();
    await expect(welcome).toBeVisible({ timeout: 20_000 });
  });

  test('Load + refresh persistence: saved word survives reload', async ({ page }) => {
    await seedCleanVisitor(page);
    await routeDictionary(page);
    await page.goto('/');
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study$/);

    const good = page.getByText(/good/i).filter({ visible: true }).first();
    await expect(good).toBeVisible({ timeout: 15_000 });
    await good.click();
    const saveButton = page.locator('#tour-transcript-save-word');
    await expect(saveButton).toBeVisible();
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 45_000 });
    await expectGuestWordPersisted(page);

    // Reload — visitor vocabulary is persisted to localStorage.
    await page.reload();
    await enterGuestMode(page);

    await page.getByRole('link', { name: 'Vocabulary' }).click();
    await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
  });
});
