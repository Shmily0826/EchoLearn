import { test, expect, type Page } from '@playwright/test';
import { openSignedInApp } from './helpers/sessionFixture';

type AiCall = { authorization?: string; prompt: string };

async function stubBatchReplies(page: Page, replies: string[]): Promise<AiCall[]> {
  const calls: AiCall[] = [];
  await page.route('**/api/ai', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { messages?: Array<{ content?: string }> };
    calls.push({ authorization: (await request.allHeaders()).authorization, prompt: body.messages?.[1]?.content ?? '' });
    const content = replies.shift();
    if (!content) throw new Error('Unexpected extra AI request in batch-translation spec');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });
  return calls;
}

async function seed(page: Page, key: string, items: unknown[]) {
  await page.evaluate(({ key, items }) => localStorage.setItem(key, JSON.stringify(items)), { key, items });
}

const vocab = [
  { id: 'word-1', word: 'meticulous', meaningCn: '', definitionEn: 'careful', context: 'She is meticulous.', sourceVideoId: 'e2e', addedAt: 1, mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0 },
  { id: 'word-2', word: 'resilient', meaningCn: '', definitionEn: 'able to recover', context: 'They remained resilient.', sourceVideoId: 'e2e', addedAt: 2, mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0 },
];

const sentences = [
  { id: 'sentence-1', text: 'The careful team checked every result.', meaningCn: '', sourceVideoId: 'e2e', startTime: 1, addedAt: 1, myOwnSentence: '', mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0 },
  { id: 'sentence-2', text: 'They recovered quickly after the setback.', meaningCn: '', sourceVideoId: 'e2e', startTime: 2, addedAt: 2, myOwnSentence: '', mastered: false, reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0 },
];

async function expectStoredMeanings(page: Page, key: string, texts: string[]) {
  await expect.poll(() => page.evaluate(({ key }) => {
    const rows = JSON.parse(localStorage.getItem(key) || '[]') as Array<{ word?: string; text?: string; meaningCn: string }>;
    return rows.map((row) => `${row.word ?? row.text}:${row.meaningCn}`);
  }, { key })).toEqual(texts);
}

test('authenticated word batch keeps partial success and retries only the missing word', async ({ context, page }) => {
  await openSignedInApp(context, page);
  const calls = await stubBatchReplies(page, ['["细致的"]', '["坚韧的"]']);
  await seed(page, 'echolearn_vocabulary', vocab);
  await page.goto('/vocabulary');

  const translate = page.getByRole('button', { name: /auto.?translate/i });
  await expect(translate).toBeVisible();
  await translate.click();
  await expectStoredMeanings(page, 'echolearn_vocabulary', ['meticulous:细致的', 'resilient:']);
  await expect(translate).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(translate).toBeVisible();
  await translate.click();
  await expectStoredMeanings(page, 'echolearn_vocabulary', ['meticulous:细致的', 'resilient:坚韧的']);
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.authorization?.startsWith('Bearer '))).toBe(true);
  expect(calls[0].prompt).toContain('meticulous');
  expect(calls[0].prompt).toContain('resilient');
  expect(calls[1].prompt).toContain('resilient');
  expect(calls[1].prompt).not.toContain('meticulous');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectStoredMeanings(page, 'echolearn_vocabulary', ['meticulous:细致的', 'resilient:坚韧的']);
});

test('authenticated sentence batch keeps partial success and retries only the missing sentence', async ({ context, page }) => {
  await openSignedInApp(context, page);
  const calls = await stubBatchReplies(page, ['["团队仔细检查了每个结果。"]', '["他们在挫折后很快恢复。"]']);
  await seed(page, 'echolearn_sentences', sentences);
  await page.goto('/sentences');

  const translate = page.getByRole('button', { name: /auto.?translate/i });
  await expect(translate).toBeVisible();
  await translate.click();
  await expectStoredMeanings(page, 'echolearn_sentences', [
    'The careful team checked every result.:团队仔细检查了每个结果。',
    'They recovered quickly after the setback.:',
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(translate).toBeVisible();
  await translate.click();
  await expectStoredMeanings(page, 'echolearn_sentences', [
    'The careful team checked every result.:团队仔细检查了每个结果。',
    'They recovered quickly after the setback.:他们在挫折后很快恢复。',
  ]);
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.authorization?.startsWith('Bearer '))).toBe(true);
  expect(calls[0].prompt).toContain(sentences[0].text);
  expect(calls[0].prompt).toContain(sentences[1].text);
  expect(calls[1].prompt).toContain(sentences[1].text);
  expect(calls[1].prompt).not.toContain(sentences[0].text);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectStoredMeanings(page, 'echolearn_sentences', [
    'The careful team checked every result.:团队仔细检查了每个结果。',
    'They recovered quickly after the setback.:他们在挫折后很快恢复。',
  ]);
});
