import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * ECHO-20260928-REVIEW-MULTI-DAY-JOURNEY — the SRS ladder driven like a real
 * returning learner.
 *
 * Everything a reviewer needs to trust this spec:
 *
 * Words enter through the real Study UI (popup save) or as storage seeds shaped
 * exactly like the app writes them; both origins must behave identically.
 *
 * Time travel: `computeNextReviewAt` is `Date.now() + days*86400000` and
 * `isDue` compares against `todayStartMs() + 24h`, so "the calendar moved
 * forward N days" and "every stored nextReviewAt moved back N days" are the
 * same statement up to seconds of test-run drift. Shifting stored timestamps
 * via page.evaluate is therefore an equivalence, not a mock, and unlike
 * page.clock it cannot fight the media clock or the Firebase SDK. Controls
 * (the mastered refresher and the legacy unscheduled row) are never shifted,
 * so their invariants stay observable.
 *
 * Network: the bundled sample transcript renders with zero network. Dictionary
 * lookups are route-mocked, /api/ai is aborted (the guest cost boundary), and
 * the YouTube player iframe is aborted too because this journey never needs
 * media playback.
 */

const SAMPLE_VIDEO_ID = 'iG9CE55wbtY';
const DAY_MS = 86_400_000;

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

type VocabItem = {
  id: string;
  word: string;
  meaningCn: string;
  context: string;
  sourceVideoId: string;
  addedAt: number;
  mastered: boolean;
  reviewCount: number;
  lastReviewedAt: number;
  nextReviewAt: number;
};

/** Seed rows exactly in the shape the app's own save path writes. */
function seededWord(word: string, over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: `e2e-${word}-${Math.floor(Math.random() * 1e9)}`,
    word,
    meaningCn: `seeded: ${word}`,
    context: `The seed sentence contains ${word}.`,
    sourceVideoId: SAMPLE_VIDEO_ID,
    sourceVideoTitle: 'Multi-day review fixture',
    addedAt: Date.now(),
    mastered: false,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 0,
    ...over,
  };
}

async function readVocabulary(page: Page): Promise<VocabItem[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]'));
}

async function writeVocabulary(page: Page, items: VocabItem[]) {
  await page.evaluate((list) => {
    localStorage.setItem('echolearn_vocabulary', JSON.stringify(list));
  }, items);
}

async function openGuestStudySample(page: Page) {
  await page.route('**/api/dictionary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) }));
  await page.route('**/api/ai**', (route) => route.abort());
  // This journey never plays media; the embedded player must not dial out.
  await page.route(/youtube\.com|youtubei\.com|googlevideo\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByRole('button', { name: 'Look up good', exact: true }).filter({ visible: true }).first())
    .toBeVisible({ timeout: 20_000 });
}

/** Save one word through the real popup flow and wait for the local toast. */
async function saveWordViaUi(page: Page, word: string) {
  await page.getByRole('button', { name: `Look up ${word}`, exact: true }).filter({ visible: true }).first().click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await saveButton.waitFor({ state: 'visible', timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' }).first())
    .toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
}

/** Dashboard's due stat — the number a returning learner plans their day by. */
async function dashboardDueCount(page: Page): Promise<number> {
  await page.goto('/');
  const card = page.locator('#tour-review-card');
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  const text = await card.locator('p').first().textContent();
  return Number(text);
}

/**
 * One review session over the due queue. The app shuffles the queue
 * (ReviewPage.startSession sorts with Math.random), so grading is keyed by the
 * word actually shown on the card front, read from the rendered paragraph —
 * never by position. A front that matches none of the expected words fails.
 */
async function reviewRound(page: Page, gradeByWord: Record<string, 'R' | 'F'>) {
  const expectedWords = Object.keys(gradeByWord);
  await page.goto('/review');
  const dueButton = page.getByRole('button', { name: /Review Due Today/ });
  await dueButton.waitFor({ state: 'visible', timeout: 15_000 });
  const shownCount = Number(await dueButton.locator('span').last().textContent());
  expect(shownCount, 'Review button must build exactly the queue it displays').toBe(expectedWords.length);

  await dueButton.click();
  for (let i = 0; i < expectedWords.length; i++) {
    const frontWord = await page.evaluate((words) => {
      const paragraphs = [...document.querySelectorAll('main p')].map((el) => el.textContent?.trim());
      return words.find((w) => paragraphs.includes(w));
    }, expectedWords);
    expect(frontWord, `card ${i + 1} must show one of the queued words`).toBeTruthy();
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: gradeByWord[frontWord!] === 'R' ? /Remember/ : /Forgot/ }).click();
  }
  await expect(page.getByText('Session Complete!')).toBeVisible({ timeout: 10_000 });
  // The complete screen's Reviewed count is the queue length actually walked.
  const reviewed = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('p')];
    const label = labels.find((el) => el.textContent === 'Reviewed');
    return label?.previousElementSibling?.textContent;
  });
  expect(Number(reviewed), 'Reviewed count must equal the displayed queue length').toBe(expectedWords.length);
}

/** Shift every journey word's schedule back N days — the calendar equivalence. */
async function shiftJourneyWords(page: Page, words: string[], days: number) {
  await readVocabulary(page).then((list) => {
    const next = list.map((item) =>
      words.includes(item.word) && item.nextReviewAt > 0
        ? { ...item, nextReviewAt: item.nextReviewAt - days * DAY_MS }
        : item,
    );
    return writeVocabulary(page, next);
  });
  await page.reload();
}

test.describe('Multi-day review journey (SRS ladder)', () => {
  test('a returning learner climbs 3→7→14→30→90 days to mastery', async ({ page }) => {
    await openGuestStudySample(page);

    // ── Day 0 setup: two words through the real UI ────────────────
    await saveWordViaUi(page, 'good');
    await saveWordViaUi(page, 'great');
    let vocab = await readVocabulary(page);
    const uiWords = vocab.map((v) => v.word).sort();
    expect(uiWords).toEqual(['good', 'great']);
    for (const item of vocab) {
      expect(item.sourceVideoId, 'UI-saved words must carry the sample video id').toBe(SAMPLE_VIDEO_ID);
      expect(item.nextReviewAt, 'newly saved items are scheduled for tomorrow, not today')
        .toBeGreaterThan(Date.now());
      expect(item.reviewCount).toBe(0);
    }

    // ── Seed to journey scale, keeping the UI words as due items ──
    // The UI words shift back one day (their own saved schedule), which is the
    // same equivalence as every later calendar step.
    const now = Date.now();
    await writeVocabulary(page, [
      { ...vocab.find((v) => v.word === 'good')!, nextReviewAt: now - 60_000 },
      seededWord('seedone', { nextReviewAt: now - 60_000 }),
      { ...vocab.find((v) => v.word === 'great')!, nextReviewAt: now - 60_000 },
      seededWord('seedtwo', { nextReviewAt: now - 60_000 }),
      seededWord('seedthree', { nextReviewAt: now - 60_000 }),
      // Control 1: a mastered item deep inside its 90-day refresher window.
      seededWord('seedmastered', { reviewCount: 5, mastered: true, lastReviewedAt: now, nextReviewAt: now + 90 * DAY_MS }),
      // Control 2: a legacy row that was never scheduled. It must never be
      // re-scheduled as a side effect of being read.
      seededWord('seedlegacy', { reviewCount: 0, nextReviewAt: 0 }),
    ]);
    const journeyWords = ['good', 'seedone', 'great', 'seedtwo', 'seedthree'];
    await page.reload();

    // ── Day 0: display == queue, mixed grading ────────────────────
    expect(await dashboardDueCount(page)).toBe(5);
    // The app shuffles the queue (ReviewPage.startSession sorts with
    // Math.random), which is why reviewRound grades by the word shown on the
    // card front instead of by position.
    // 3 × Remember, 2 × Forget, mixing both origins in both branches.
    await reviewRound(page, {
      good: 'R', seedone: 'R', great: 'F', seedtwo: 'R', seedthree: 'F',
    });

    vocab = await readVocabulary(page);
    const byWord = Object.fromEntries(vocab.map((v) => [v.word, v]));
    // Remember branch: reviewCount 0 → 1, scheduled +3 days.
    for (const w of ['good', 'seedone', 'seedtwo']) {
      expect(byWord[w].reviewCount, `${w} climbed one rung`).toBe(1);
      expect(Math.abs(byWord[w].nextReviewAt - (Date.now() + 3 * DAY_MS))).toBeLessThan(2 * 60_000);
      expect(byWord[w].mastered).toBe(false);
    }
    // Forget branch: reviewCount stays 0, back again tomorrow, unmastered.
    for (const w of ['great', 'seedthree']) {
      expect(byWord[w].reviewCount, `${w} forgot does not go negative`).toBe(0);
      expect(Math.abs(byWord[w].nextReviewAt - (Date.now() + 1 * DAY_MS))).toBeLessThan(2 * 60_000);
      expect(byWord[w].mastered).toBe(false);
    }
    // Invariant: the legacy unscheduled row was not touched by a whole session.
    expect(byWord.seedlegacy.nextReviewAt, 'legacy row stays unscheduled').toBe(0);
    expect(byWord.seedlegacy.reviewCount).toBe(0);
    expect(byWord.seedlegacy.mastered).toBe(false);
    // Invariant: the mastered refresher is not due inside its long window.
    expect(byWord.seedmastered.reviewCount).toBe(5);
    expect(byWord.seedmastered.nextReviewAt).toBeGreaterThan(Date.now() + 60 * DAY_MS);

    // ── +3 days: the 3-day rung is due; climb everything ──────────
    await shiftJourneyWords(page, journeyWords, 3);
    expect(await dashboardDueCount(page)).toBe(5);
    await reviewRound(page, {
      good: 'R', seedone: 'R', great: 'R', seedtwo: 'R', seedthree: 'R',
    });
    vocab = await readVocabulary(page);
    const round2 = Object.fromEntries(vocab.map((v) => [v.word, v]));
    for (const w of ['good', 'seedone', 'seedtwo']) {
      expect(round2[w].reviewCount).toBe(2);
      expect(Math.abs(round2[w].nextReviewAt - (Date.now() + 7 * DAY_MS))).toBeLessThan(2 * 60_000);
    }
    for (const w of ['great', 'seedthree']) {
      expect(round2[w].reviewCount).toBe(1);
      expect(Math.abs(round2[w].nextReviewAt - (Date.now() + 3 * DAY_MS))).toBeLessThan(2 * 60_000);
    }

    // ── +7 days → the 7-day rung feeds the 14-day rung ────────────
    await shiftJourneyWords(page, journeyWords, 7);
    expect(await dashboardDueCount(page)).toBe(5);
    await reviewRound(page, {
      good: 'R', seedone: 'R', great: 'R', seedtwo: 'R', seedthree: 'R',
    });
    vocab = await readVocabulary(page);
    const round3 = Object.fromEntries(vocab.map((v) => [v.word, v]));
    expect(round3.good.reviewCount).toBe(3);
    expect(Math.abs(round3.good.nextReviewAt - (Date.now() + 14 * DAY_MS))).toBeLessThan(2 * 60_000);
    expect(round3.seedone.reviewCount).toBe(3);
    expect(round3.great.reviewCount).toBe(2);

    // ── +14 days → the 14-day rung feeds the 30-day rung ──────────
    await shiftJourneyWords(page, journeyWords, 14);
    expect(await dashboardDueCount(page)).toBe(5);
    await reviewRound(page, {
      good: 'R', seedone: 'R', great: 'R', seedtwo: 'R', seedthree: 'R',
    });
    vocab = await readVocabulary(page);
    const round4 = Object.fromEntries(vocab.map((v) => [v.word, v]));
    expect(round4.good.reviewCount).toBe(4);
    expect(Math.abs(round4.good.nextReviewAt - (Date.now() + 30 * DAY_MS))).toBeLessThan(2 * 60_000);
    expect(round4.great.reviewCount).toBe(3);

    // ── +30 days: the 5th Remember masters and goes onto the ladder ─
    await shiftJourneyWords(page, journeyWords, 30);
    expect(await dashboardDueCount(page)).toBe(5);
    await reviewRound(page, {
      good: 'R', seedone: 'R', great: 'R', seedtwo: 'R', seedthree: 'R',
    });
    vocab = await readVocabulary(page);
    const final = Object.fromEntries(vocab.map((v) => [v.word, v]));
    // UI-saved and seeded words that climbed together ended identically —
    // the app must not be able to tell them apart.
    for (const w of ['good', 'seedone', 'seedtwo']) {
      expect(final[w].reviewCount, `${w} reached mastery on the 5th remember`).toBe(5);
      expect(final[w].mastered, `${w} mastered flag set`).toBe(true);
      expect(Math.abs(final[w].nextReviewAt - (Date.now() + 90 * DAY_MS))).toBeLessThan(2 * 60_000);
    }
    for (const w of ['great', 'seedthree']) {
      expect(final[w].reviewCount).toBe(4);
      expect(final[w].mastered).toBe(false);
      expect(Math.abs(final[w].nextReviewAt - (Date.now() + 30 * DAY_MS))).toBeLessThan(2 * 60_000);
    }
    expect(final.seedlegacy.nextReviewAt).toBe(0);
    expect(final.seedlegacy.reviewCount).toBe(0);
    expect(final.seedmastered.reviewCount).toBe(5);

    // ── Cross-page consistency after the whole ladder ─────────────
    // Nothing is due: mastered items sit 90 days out, the rest 30.
    expect(await dashboardDueCount(page)).toBe(0);
    await page.goto('/vocabulary');
    await expect(page.getByText(/7 words/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/4 mastered/)).toBeVisible();
    await page.goto('/review');
    await expect(page.getByText('No items to review yet.').or(page.getByRole('button', { name: /Review Due Today/ }).locator('span'))).toBeVisible();
    const dueButton = page.getByRole('button', { name: /Review Due Today/ });
    if (await dueButton.isVisible().catch(() => false)) {
      const n = Number(await dueButton.locator('span').last().textContent());
      expect(n, 'Review queue must be empty when the dashboard says 0').toBe(0);
    }
  });
});
