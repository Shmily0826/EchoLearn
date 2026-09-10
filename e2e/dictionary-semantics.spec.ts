import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * Dictionary semantics E2E — the language-truth guarantees of the
 * P0/P1A/P1B contract, exercised through the real popup → save → persistence
 * path rather than at function level.
 *
 * Everything external is mocked (dictionary API, quick translation, AI, and
 * the client fallback providers), so no YouTube / Vercel / AI provider is
 * touched. The Study page's bundled sample video supplies the transcript.
 *
 * Note: the backend `/api/dictionary` handler (`api/dictionary.ts`) does not
 * run under plain `vite dev`, so server-side `normalizeSourceDefinition` is
 * NOT exercised here. These specs cover the client-side contract: language
 * truth, fallback labelling, and save-time data integrity.
 *
 * The app is entered in English (the shared guest-mode helper matches English
 * labels) and then switched to zh-CN before the assertions, because the popup's
 * Chinese path is exactly what needs coverage.
 */

const WORD = 'good';

const EN_PAYLOAD = {
  ipa_uk: '',
  ipa_us: '/ɡʊd/',
  audio_url: '',
  base_form: 'good',
  source: 'merriam-webster',
  lemma_provenance: 'provider-confirmed',
  entries: [{
    pos: 'adjective',
    definitions: [{
      display_order: 0,
      definitions_json: {
        definition: 'EN_SENSE of high quality',
        source_text: 'EN_SENSE of high quality',
      },
    }],
  }],
};

function zhPayload(
  definition: string,
  sourceText: string,
  translationStatus?: 'translated' | 'fallback-en',
) {
  return {
    ipa_uk: '',
    ipa_us: '/ɡʊd/',
    audio_url: '',
    base_form: 'good',
    source: 'merriam-webster',
    lemma_provenance: 'provider-confirmed',
    entries: [{
      pos: 'adjective',
      definitions: [{
        display_order: 0,
        definitions_json: {
          definition,
          source_text: sourceText,
          ...(translationStatus ? { translation_status: translationStatus } : {}),
        },
      }],
    }],
  };
}

/** Route `/api/dictionary` by requested target language. */
async function mockDictionaryApi(
  page: Page,
  handler: (target: string) => Record<string, unknown> | null,
) {
  await page.route('**/api/dictionary*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('target') ?? '';
    const body = handler(target);
    if (!body) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * Enter the app in English, then switch the UI language and reload so the
 * popup renders in the requested language.
 */
async function enterAppInLanguage(page: Page, lang: 'zh' | 'en') {
  // addInitScript re-runs on every navigation, so guard it with a sentinel.
  // Without this, the later `goto('/study')` would reset the language back to
  // English and the zh-CN specs would silently run in English mode.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('echolearn-e2e-lang-seeded')) return;
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    sessionStorage.setItem('echolearn-e2e-lang-seeded', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  if (lang !== 'en') {
    await page.evaluate((value) => localStorage.setItem('echolearn_lang', value), lang);
  }
  await page.goto('/study');
  await expect(page.locator('a[href="/study"]').first()).toBeVisible({ timeout: 15_000 });
  // Precondition: the popup's Chinese path is what these specs cover. Fail
  // loudly here rather than silently asserting against English-mode markup.
  expect(await page.evaluate(() => localStorage.getItem('echolearn_lang'))).toBe(lang);
}

/** Click the sample transcript word and wait for the popup save button. */
async function openPopupForSampleWord(page: Page) {
  const word = page.getByText(WORD, { exact: true }).filter({ visible: true }).first();
  await expect(word).toBeVisible({ timeout: 20_000 });
  await word.click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await expect(saveButton).toBeVisible({ timeout: 20_000 });
  return saveButton;
}

async function openVocabulary(page: Page) {
  await page.locator('a[href="/vocabulary"]').first().click();
  await expect(page.getByText(/^good\b/).filter({ visible: true }).first())
    .toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  // AI enrichment is out of scope; fail it fast so the specs stay deterministic.
  await page.route('**/api/ai**', (route) => route.abort());
});

test('translated zh-CN sense drives the learner meaning and the saved meaningCn', async ({ page }) => {
  await mockDictionaryApi(page, (target) =>
    (target.startsWith('en') ? EN_PAYLOAD : zhPayload('高质量的', 'of high quality', 'translated')));
  await page.route('**/api/translate**', (route) => route.abort());
  await enterAppInLanguage(page, 'zh');

  const saveButton = await openPopupForSampleWord(page);

  // LearnerMeaning resolves from the translated dictionary reference.
  await expect(page.getByText('高质量的')).toBeVisible();

  await saveButton.click();
  await expect(saveButton).toBeHidden({ timeout: 45_000 });

  await openVocabulary(page);
  await expect(page.getByText('高质量的').first()).toBeVisible();
});

test('fallback-en never masquerades as a Chinese learner meaning or meaningCn', async ({ page }) => {
  const fallbackText = 'FALLBACK_EN_MARKER quality';
  await mockDictionaryApi(page, (target) =>
    (target.startsWith('en')
      ? EN_PAYLOAD
      : zhPayload(fallbackText, fallbackText, 'fallback-en')));
  await page.route('**/api/translate**', (route) => route.abort());
  await enterAppInLanguage(page, 'zh');

  const saveButton = await openPopupForSampleWord(page);

  // The English fallback must not be presented as the Chinese gloss.
  await expect(page.getByText(fallbackText)).toHaveCount(0);

  // It is still reachable as explicitly labelled dictionary reference material.
  await page.getByRole('button', { name: '查看词典参考释义' }).click();
  await expect(page.getByText(fallbackText).first()).toBeVisible();
  await expect(page.getByText('（英文原文，翻译失败）')).toBeVisible();

  await saveButton.click();
  await expect(saveButton).toBeHidden({ timeout: 45_000 });

  await openVocabulary(page);
  // P0 guarantee: the English fallback must not be persisted as meaningCn.
  await expect(page.getByText(fallbackText)).toHaveCount(0);
});

test('client fallback keeps the popup usable when the dictionary backend is down', async ({ page }) => {
  const clientText = 'CLIENT_FALLBACK_MARKER of high quality';
  await mockDictionaryApi(page, () => null);
  await page.route('https://api.dictionaryapi.dev/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        word: WORD,
        phonetic: '',
        phonetics: [],
        meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: clientText }] }],
      }]),
    }));
  await page.route('https://api.datamuse.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/translate**', (route) => route.abort());
  await enterAppInLanguage(page, 'zh');

  const saveButton = await openPopupForSampleWord(page);

  await page.getByRole('button', { name: '查看词典参考释义' }).click();
  await expect(page.getByText(clientText).first()).toBeVisible();
  await expect(page.getByText('（英文原文，翻译失败）')).toBeVisible();

  // Saving still works — the word persists even with no backend.
  await saveButton.click();
  await expect(saveButton).toBeHidden({ timeout: 45_000 });
  await openVocabulary(page);
});

test('English study mode shows the source sense without a translation-failure badge', async ({ page }) => {
  await mockDictionaryApi(page, () => EN_PAYLOAD);
  await page.route('**/api/translate**', (route) => route.abort());
  await enterAppInLanguage(page, 'en');

  await openPopupForSampleWord(page);

  await expect(page.getByText('EN_SENSE').first()).toBeVisible();
  // English is the intended display language here, not a translation failure.
  await expect(page.getByText('（英文原文，翻译失败）')).toHaveCount(0);
});
