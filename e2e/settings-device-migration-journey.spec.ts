import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { enterGuestMode } from './helpers/guestMode';

/**
 * ECHO-20260928-BATCH2-T1 — the device-migration journey: a learner exports
 * their library, moves to a new device (library empty), and restores from
 * their cloud backup; plus the safety contract that a failed restore must
 * never damage the data already on the device.
 *
 * The GitHub Gist API is fully route-mocked (real PATs and real Gists are
 * forbidden): `POST /gists` records the backup the app actually serialised,
 * and `GET /gists/:id` serves it back (or a doctored body for falsification).
 *
 * Known shape of the "new device": the app binds the gist id to the device
 * (no UI exists to enter an existing gist id), so a truly empty device could
 * not restore by id. This journey clears the learner's data keys while
 * keeping PAT/gist-id — the honest equivalent within what the product allows,
 * recorded here rather than silently widened.
 */

const SAMPLE_VIDEO_ID = 'iG9CE55wbtY';
const GIST_ID = 'e2e-gist-1';
const GIST_FILENAME = 'echolearn-backup.json';

const DICTIONARY_FIXTURE = {
  ipa_uk: '/ɡʊd/',
  ipa_us: '/ɡʊd/',
  audio_url: '',
  base_form: 'good',
  source: 'free-dictionary',
  entries: [{
    pos: 'adjective',
    definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
  }],
};

type VocabItem = Record<string, unknown> & { id: string; word: string };

async function readStorage(page: Page, key: string): Promise<unknown> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

async function openGuestStudy(page: Page) {
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByRole('button', { name: 'Look up Good', exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 20_000 });
}

async function saveWordViaUi(page: Page, word: string) {
  await page.getByRole('button', { name: `Look up ${word}`, exact: true }).filter({ visible: true }).first().click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await saveButton.waitFor({ state: 'visible', timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' }).first())
    .toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
}

async function savePatViaUi(page: Page) {
  const patInput = page.getByPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx');
  await patInput.fill('ghp_e2e-fake-token');
  // The PAT save button sits next to the input; scoped because a second
  // "Save" exists in the Developer Mode proxy section.
  await patInput.locator('xpath=ancestor::div[2]').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Connected as e2e-user/i)).toBeVisible({ timeout: 15_000 });
}

async function saveSentenceViaUi(page: Page, lineText: RegExp) {
  const row = page.locator('[data-transcript-line]').filter({ hasText: lineText, visible: true }).first();
  await row.getByRole('button', { name: 'Save sentence' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Sentences' }).first())
    .toBeVisible({ timeout: 10_000 });
}

test.describe('Device migration journey (export → clear → restore)', () => {
  test('a learner moves devices without losing or corrupting data', async ({ page }) => {
    let backupContent: string | null = null;
    let gistGetBody = 'not-requested';

    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());
    await page.route(/api\.github\.com\//, async (route) => {
      const request = route.request();
      if (request.url().includes('/user')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ login: 'e2e-user' }) });
        return;
      }
      if (request.method() === 'POST') {
        backupContent = JSON.parse(request.postData()!).files[GIST_FILENAME].content;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: GIST_ID }),
        });
        return;
      }
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: GIST_ID,
            files: { [GIST_FILENAME]: { content: gistGetBody } },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // ── Build a verifiable library through the real UI ────────────
    await openGuestStudy(page);
    await saveWordViaUi(page, 'Good');
    await saveWordViaUi(page, 'morning');
    await saveSentenceViaUi(page, /Good morning/);

    const vocabBefore = (await readStorage(page, 'echolearn_vocabulary')) as VocabItem[];
    const sentencesBefore = (await readStorage(page, 'echolearn_sentences')) as Array<Record<string, unknown>>;
    expect(vocabBefore).toHaveLength(2);
    expect(sentencesBefore).toHaveLength(1);
    for (const item of vocabBefore) {
      expect(item.sourceVideoId).toBe(SAMPLE_VIDEO_ID);
    }

    // ── Export: three actions, downloads captured and inspected ───
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // The Gist backup section exists only behind the Developer Mode toggle.
    const devSection = page.locator('section').filter({ hasText: 'Developer Mode' });
    await devSection.getByRole('button').click();

    const vocabDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Vocabulary CSV/ }).click();
    const vocabDownload = await (await vocabDownloadPromise).path();
    expect(vocabDownload, 'vocabulary CSV download must exist').toBeTruthy();

    await expect(page.getByText('Exported 2 vocabulary items to CSV.')).toBeVisible();

    const sentDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Sentences CSV/ }).click();
    await expect(page.getByText('Exported 1 sentences to CSV.')).toBeVisible();
    const sentDownload = await (await sentDownloadPromise).path();
    expect(sentDownload, 'sentences CSV download must exist').toBeTruthy();

    const allDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /All Data \(JSON\)/ }).click();
    const allDownload = await (await allDownloadPromise).path();
    const allJson = JSON.parse(readFileSync(allDownload!, 'utf-8').replace(/^\uFEFF/, ''));
    expect(allJson.version).toBe(1);
    expect(allJson.data.echolearn_vocabulary).toHaveLength(2);
    expect(allJson.data.echolearn_sentences).toHaveLength(1);
    await expect(page.getByText('All data exported as JSON.')).toBeVisible();

    // ── Backup to the (mocked) Gist with a PAT entered via the UI ─
    await savePatViaUi(page);
    await page.getByRole('button', { name: /Save to Cloud/ }).click();
    await expect(page.getByText('Data saved to cloud!')).toBeVisible({ timeout: 15_000 });
    expect(backupContent, 'the app must serialise a backup body').toBeTruthy();
    const backup = JSON.parse(backupContent!) as { data: Record<string, string | null> };
    expect(JSON.parse(backup.data.echolearn_vocabulary as string)).toHaveLength(2);
    expect(JSON.parse(backup.data.echolearn_sentences as string)).toHaveLength(1);

    // ── Move to the "new device": wipe the learner's data keys ────
    // The app binds the gist id to the device (no UI to enter an existing
    // id), so a fully empty device could not restore at all; the journey
    // clears the data keys and records that product shape as-is.
    await page.evaluate(() => {
      // Guest/language keys stay: the journey migrates the learner's data,
      // not the app shell state.
      const keep = new Set([
        'echolearn_github_pat', 'echolearn_gist_id', 'echolearn_last_sync',
        'echolearn_guest_mode', 'echolearn_lang', 'echolearn-lang-chosen',
        'echolearn-tour-completed-v1', 'echolearn_dev_mode',
      ]);
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('echolearn_') && !keep.has(k));
      keys.forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
    await page.goto('/vocabulary');
    await expect(page.getByText('No words saved yet. Click any word in a transcript to add it.')).toBeVisible();

    // ── Restore from the mocked Gist: data must come back intact ──
    gistGetBody = backupContent!;
    await page.goto('/settings');
    await page.getByRole('button', { name: /Restore from Cloud/ }).click();
    await expect(page.getByText(/Data restored from cloud/)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    const vocabAfter = (await readStorage(page, 'echolearn_vocabulary')) as VocabItem[];
    const sentencesAfter = (await readStorage(page, 'echolearn_sentences')) as Array<Record<string, unknown>>;
    expect(vocabAfter).toHaveLength(2);
    for (const before of vocabBefore) {
      const after = vocabAfter.find((v) => v.id === before.id);
      expect(after, `word ${before.word} must survive the round trip`).toBeTruthy();
      expect(after!.word).toBe(before.word);
      expect(after!.context).toBe(before.context);
      expect(after!.sourceVideoId).toBe(before.sourceVideoId);
    }
    expect(sentencesAfter).toHaveLength(1);
    expect(sentencesAfter[0].id).toBe(sentencesBefore[0].id);
    await page.goto('/vocabulary');
    await expect(page.getByText(/2 words/)).toBeVisible();
  });

  test('a failed restore must leave the existing library untouched', async ({ page }) => {
    let gistGetStatus = 500;
    let gistGetBody = 'internal error';

    await page.route('**/api/dictionary*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
    await page.route('**/api/ai**', (route) => route.abort());
    await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());
    await page.route(/api\.github\.com\//, async (route) => {
      const request = route.request();
      if (request.url().includes('/user')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ login: 'e2e-user' }) });
        return;
      }
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: GIST_ID }),
        });
        return;
      }
      await route.fulfill({
        status: gistGetStatus,
        contentType: 'application/json',
        body: JSON.stringify({
          id: GIST_ID,
          files: { [GIST_FILENAME]: { content: gistGetBody } },
        }),
      });
    });

    // Library with real UI-saved data, backed up once (so a gist id exists).
    await openGuestStudy(page);
    await saveWordViaUi(page, 'Good');
    const vocabBefore = (await readStorage(page, 'echolearn_vocabulary')) as VocabItem[];
    expect(vocabBefore).toHaveLength(1);

    await page.goto('/settings');
    const devSection = page.locator('section').filter({ hasText: 'Developer Mode' });
    await devSection.getByRole('button').click();
    await savePatViaUi(page);
    await page.getByRole('button', { name: /Save to Cloud/ }).click();
    await expect(page.getByText('Data saved to cloud!')).toBeVisible({ timeout: 15_000 });

    // Failure mode 1: HTTP 500 from the Gist API.
    await page.getByRole('button', { name: /Restore from Cloud/ }).click();
    await expect(page.getByText(/读取 Gist 失败 \(500\)/)).toBeVisible({ timeout: 15_000 });
    expect(await readStorage(page, 'echolearn_vocabulary')).toEqual(vocabBefore);

    // Failure mode 2: a corrupt backup body.
    gistGetStatus = 200;
    gistGetBody = '{ this is not json';
    await page.getByRole('button', { name: /Restore from Cloud/ }).click();
    await expect(page.getByText(/网络错误|Unexpected token|失败|兼容/i).first()).toBeVisible({ timeout: 15_000 });
    expect(await readStorage(page, 'echolearn_vocabulary')).toEqual(vocabBefore);
  });
});
