import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * P6 REVIEW_RETURN_TO_STUDY_V1 — campaign scenario (untracked).
 * Connected learner journey: save items in Study → complete a Review session →
 * verify progress continuity back in Vocabulary and Study. Guest mode, local only.
 */

/**
 * This campaign saves words out of the word-lookup popup, which needs a
 * dictionary result. Under `vite dev` there is no `/api/dictionary` handler, so
 * the client falls through to the public Free Dictionary / Datamuse APIs — live
 * third-party latency that only bites when the whole suite is running. Stub the
 * backend route (same approach as e2e/dictionary-semantics.spec.ts) and refuse
 * the external fallbacks, so the save path is deterministic and provider-free.
 */
async function mockDictionary(page: Page) {
  await page.route('**/api/dictionary*', (route) => {
    const word = new URL(route.request().url()).searchParams.get('word') ?? '';
    const sense = `${word} (E2E stub sense)`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '', ipa_us: '', audio_url: '', base_form: word,
        source: 'e2e-stub', lemma_provenance: 'provider-confirmed',
        entries: [{ pos: 'verb', definitions: [{ display_order: 0, definitions_json: { definition: sense, source_text: sense } }] }],
      }),
    });
  });
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
  await page.route('https://api.datamuse.com/**', (route) => route.abort());
}

async function enterGuest(page: Page) {
  await mockDictionary(page);
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
}

async function saveWord(page: Page, word: string) {
  // dismiss any open popup so it cannot swallow the next word click
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  await page.locator(`[role=button][aria-label="Look up ${word}"]:visible`).first().click();
  const add = page.getByRole('button', { name: /\+ Add to Vocab/i });
  await add.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
    // popup may not have opened; retry the word click once
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    await page.locator(`[role=button][aria-label="Look up ${word}"]:visible`).first().click();
    await add.waitFor({ state: 'visible', timeout: 5000 });
  });
  await add.click();
  await page.waitForTimeout(800);
}

async function vocabList(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]').map((w: { word: string; reviewCount: number; mastered: boolean }) => ({ word: w.word, reviewCount: w.reviewCount, mastered: w.mastered })));
}

test('review session reflects saved items and returns into a continuous study context', async ({ page }) => {
  test.setTimeout(180_000);
  await enterGuest(page);

  // Study: save two words and one sentence from the sample transcript
  await page.goto('/study', { waitUntil: 'domcontentloaded' });
  await page.locator('[role=button][aria-label="Look up leaving"]:visible').first().waitFor({ state: 'visible', timeout: 15000 });
  await saveWord(page, 'leaving');
  await saveWord(page, 'conference');
  const savedVocab = await vocabList(page);
  // dictionary enrichment may or may not have landed the lemma before the save;
  // accept either the raw or lemmatized form (flake guard, not a product claim).
  const words = savedVocab.map((w: { word: string }) => w.word).sort();
  expect(words).toHaveLength(2);
  expect(words.find(w => /^conference$/i.test(w))).toBeTruthy();
  expect(words.find(w => /^(leave|leaving)$/i.test(w))).toBeTruthy();

  // Vocabulary shows them
  await page.locator('a[href="/vocabulary"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  await expect(page.getByText(/2 words/).first()).toBeVisible({ timeout: 8000 });

  // Review: start a full-queue session and complete it
  await page.locator('a[href="/review"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1200);
  const allBtn = page.getByRole('button', { name: /review every saved item/i }).first();
  const dueBtn = page.getByRole('button', { name: /Continue|review/i }).first();
  if (await allBtn.isVisible().catch(() => false)) await allBtn.click();
  else await dueBtn.click();
  await page.waitForTimeout(800);

  // answer 2 cards: Show Answer → Remember
  for (let i = 0; i < 2; i++) {
    const show = page.getByRole('button', { name: /Show Answer/ }).first();
    if (await show.isVisible().catch(() => false)) {
      await show.click();
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: /^Remember/i }).first().click();
    await page.waitForTimeout(600);
  }

  // R1/R2: progress persisted in the records
  const afterReview = await vocabList(page);
  expect(afterReview.every((w: { reviewCount: number }) => w.reviewCount >= 1)).toBe(true);
  expect(afterReview.every((w: { mastered: boolean }) => typeof w.mastered === 'boolean')).toBe(true);

  // back to Vocabulary: honest state
  await page.locator('a[href="/vocabulary"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  await expect(page.getByText(/2 words/).first()).toBeVisible({ timeout: 8000 });

  // R4/R5: reopen Study → intended session restored → Replay targets the saved context
  await page.locator('a[href="/study"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  const studyState = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return {
      isSampleSession: /YouTube: iG9CE55wbtY/.test(t),
      hasTranscript: /Good morning/.test(t),
    };
  });
  expect(studyState.isSampleSession).toBe(true);
  expect(studyState.hasTranscript).toBe(true);

  // select the saved sentence's line, then Replay
  await page.locator('div.group:visible', { hasText: "It's been great, hasn't it?" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /replay sentence/i }).click();
  await page.waitForTimeout(400);
  const cur = await page.evaluate(() => (document.querySelector('main')?.innerText?.match(/Current sentence\n([^\n]+)/) || [])[1]);
  expect(cur).toBe("It's been great, hasn't it?");

  // navigate away and back, then refresh — records and progress survive (R2)
  await page.locator('a[href="/"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('a[href="/vocabulary"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1200);
  const afterReload = await vocabList(page);
  expect(afterReload.length).toBe(2);
  expect(afterReload.every((w: { reviewCount: number }) => w.reviewCount >= 1)).toBe(true);
});
