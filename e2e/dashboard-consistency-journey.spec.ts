import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * ECHO-20260928-BATCH2-T2 — Dashboard number consistency.
 *
 * This repo shipped a real bug class: six places each computed "due" their own
 * way, so the displayed number and the queue the button built disagreed.
 * `src/utils/reviewSchedule.ts` is now the single source; these tests pin it
 * across four parametrised library states. For every state:
 *   Dashboard due stat == Review landing due count == the queue the button
 *   actually builds, and Vocabulary/Sentences page totals match storage.
 */

const DAY_MS = 86_400_000;

type SeedWord = {
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

function seedWord(word: string, over: Partial<SeedWord> = {}): SeedWord {
  return {
    id: `e2e-${word}-${Math.floor(Math.random() * 1e9)}`,
    word,
    meaningCn: `seeded: ${word}`,
    context: `The seed sentence contains ${word}.`,
    sourceVideoId: 'seed-video',
    addedAt: Date.now(),
    mastered: false,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 0,
    ...over,
  };
}

async function seedLibrary(page: Page, words: SeedWord[]) {
  await page.evaluate((list) => {
    localStorage.setItem('echolearn_vocabulary', JSON.stringify(list));
    localStorage.setItem('echolearn_sentences', JSON.stringify([]));
  }, words);
  await page.reload();
}

async function dashboardDueCount(page: Page): Promise<number> {
  await page.goto('/');
  const card = page.locator('#tour-review-card');
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  return Number(await card.locator('p').first().textContent());
}

/** The queue the Review button actually builds, walked to completion. */
async function reviewQueueLength(page: Page, expectedWords: string[]): Promise<number> {
  await page.goto('/review');
  const dueButton = page.getByRole('button', { name: /Review Due Today/ });
  await dueButton.waitFor({ state: 'visible', timeout: 15_000 });
  const shown = Number(await dueButton.locator('span').last().textContent());
  await dueButton.click();
  for (let i = 0; i < shown; i++) {
    const frontWord = await page.evaluate((words) => {
      const paragraphs = [...document.querySelectorAll('main p')].map((el) => el.textContent?.trim());
      return words.find((w) => paragraphs.includes(w));
    }, expectedWords);
    expect(frontWord, `card ${i + 1} must show a queued word`).toBeTruthy();
    await page.getByRole('button', { name: /Show Answer/ }).click();
    await page.getByRole('button', { name: /Remember/ }).click();
  }
  await expect(page.getByText('Session Complete!')).toBeVisible({ timeout: 10_000 });
  const reviewed = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('p')];
    const label = labels.find((el) => el.textContent === 'Reviewed');
    return Number(label?.previousElementSibling?.textContent);
  });
  expect(reviewed, 'Reviewed count must equal the queue length').toBe(shown);
  return shown;
}

test.describe('Dashboard number consistency (single due source)', () => {
  test('all mastered inside the long refresher window → due 0', async ({ page }) => {
    await page.goto('/');
    await enterGuestMode(page);
    await seedLibrary(page, [
      seedWord('masteredA', { reviewCount: 5, mastered: true, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 90 * DAY_MS }),
      seedWord('masteredB', { reviewCount: 6, mastered: true, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 180 * DAY_MS }),
      seedWord('masteredC', { reviewCount: 5, mastered: true, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 365 * DAY_MS }),
    ]);
    expect(await dashboardDueCount(page)).toBe(0);
    await page.goto('/review');
    const dueButton = page.getByRole('button', { name: /Review Due Today/ });
    await dueButton.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(dueButton).toBeDisabled();
    await page.goto('/vocabulary');
    await expect(page.getByText(/3 words/)).toBeVisible();
    await expect(page.getByText(/3 mastered/)).toBeVisible();
  });

  test('all legacy unscheduled → due 0 and never batch-rewritten', async ({ page }) => {
    await page.goto('/');
    await enterGuestMode(page);
    const legacy = [
      seedWord('legacyA'),
      seedWord('legacyB'),
      seedWord('legacyC'),
    ];
    await seedLibrary(page, legacy);
    expect(await dashboardDueCount(page)).toBe(0);
    // Visiting Review (the page that could "fix up" rows at read time) and
    // Dashboard must not rewrite the legacy rows.
    await page.goto('/review');
    await expect(page.getByRole('button', { name: /Review Due Today/ })).toBeDisabled();
    await page.goto('/');
    const stored = (await page.evaluate(() =>
      JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]'),
    )) as SeedWord[];
    for (const item of stored) {
      expect(item.nextReviewAt, `${item.word} stays unscheduled`).toBe(0);
      expect(item.reviewCount).toBe(0);
      expect(item.mastered).toBe(false);
    }
  });

  test('mixed library → dashboard, landing and queue agree exactly', async ({ page }) => {
    await page.goto('/');
    await enterGuestMode(page);
    await seedLibrary(page, [
      seedWord('dueOne', { reviewCount: 1, lastReviewedAt: Date.now() - 4 * DAY_MS, nextReviewAt: Date.now() - 60_000 }),
      seedWord('dueTwo', { reviewCount: 2, lastReviewedAt: Date.now() - 8 * DAY_MS, nextReviewAt: Date.now() - 60_000 }),
      // Mastered but its long-term refresher slot has arrived: due again.
      seedWord('refresher', { reviewCount: 5, mastered: true, lastReviewedAt: Date.now(), nextReviewAt: Date.now() - 60_000 }),
      // Scheduled for the future: not due, and must not inflate any count.
      seedWord('future', { reviewCount: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 7 * DAY_MS }),
    ]);
    const dashboard = await dashboardDueCount(page);
    expect(dashboard).toBe(3);
    const queue = await reviewQueueLength(page, ['dueOne', 'dueTwo', 'refresher', 'future']);
    expect(queue, 'dashboard display must equal the built queue').toBe(dashboard);
    await page.goto('/vocabulary');
    await expect(page.getByText(/4 words/)).toBeVisible();
    await expect(page.getByText(/1 mastered/)).toBeVisible();
  });

  test('empty library → honest empty states, no crash', async ({ page }) => {
    await page.goto('/');
    await enterGuestMode(page);
    await seedLibrary(page, []);
    expect(await dashboardDueCount(page)).toBe(0);
    await page.goto('/review');
    // An empty library shows the empty state instead of the start buttons.
    await expect(page.getByText('No items to review yet.')).toBeVisible();
    await page.goto('/vocabulary');
    await expect(page.getByText('No words saved yet. Click any word in a transcript to add it.')).toBeVisible();
    await page.goto('/');
    const savedWords = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('p')];
      const label = labels.find((el) => el.textContent === 'Saved Words');
      return label?.previousElementSibling?.textContent;
    });
    expect(savedWords, 'the Saved Words stat must read 0').toBe('0');
  });
});
