import { expect, test, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

const youtubeId = 'M7lc1UVf-VE';
const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
const youtubeTitle = 'Saved YouTube lesson';
const bvid = 'BV1xx411c7mD';
const biliUrl = `https://www.bilibili.com/video/${bvid}`;
const youtubeLines = [{ id: 'yt-1', start: 0, end: 4, text: 'The saved YouTube transcript.' }];
const biliLines = [{ id: 'bili-1', start: 0, end: 4, text: 'The Bilibili transcript.' }];

async function seedHistory(page: Page, corrupted = false) {
  await page.addInitScript(({ id, url, title, lines }) => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_guest_mode', 'true');
    localStorage.setItem('echolearn_sessions_list', JSON.stringify([{
      id: 'youtube-history', youtubeId: id, youtubeUrl: url, platform: 'youtube', title,
      transcriptLines: lines, transcriptData: { rawBlocks: lines, sentenceLines: lines },
      createdAt: 1, updatedAt: 1, status: 'studying',
    }]));
  }, { id: youtubeId, url: corrupted ? biliUrl : youtubeUrl, title: corrupted ? biliUrl : youtubeTitle, lines: youtubeLines });
}

async function mockNetwork(page: Page, biliTitle: Promise<void> = Promise.resolve()) {
  await page.route(/^https:\/\//, route => route.abort());
  await page.route('**/oembed?**', route => route.fulfill({ json: { title: youtubeTitle } }));
  await page.route('**/api/bilibili?**', async route => {
    if (new URL(route.request().url()).searchParams.get('info') === '1') {
      await biliTitle;
      await route.fulfill({ json: { bvid, title: 'Late Bilibili title' } });
    } else {
      await route.fulfill({ json: { lines: biliLines, language: 'en', source: 'bilibili' } });
    }
  });
}

async function openHistory(page: Page, title: string) {
  await page.getByText(title, { exact: true }).filter({ visible: true }).last().click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByText(youtubeLines[0].text, { exact: true }).filter({ visible: true }).first()).toBeVisible();
}

test('pasting a Bilibili URL preserves the YouTube history URL and ignores the late Bilibili title', async ({ page }) => {
  let releaseBiliTitle!: () => void;
  const delayedBiliTitle = new Promise<void>(resolve => { releaseBiliTitle = resolve; });
  await mockNetwork(page, delayedBiliTitle);
  await seedHistory(page);
  await page.goto('/');
  await enterGuestMode(page);
  await openHistory(page, youtubeTitle);

  const url = page.getByPlaceholder(/Paste YouTube \/ Bilibili URL/);
  const title = page.getByPlaceholder('Session title...');
  await url.fill(biliUrl);
  await page.getByRole('button', { name: 'Load Video', exact: true }).click();
  await expect(page.getByText(biliLines[0].text, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const savedUrl = await page.evaluate(() => {
    const sessions: Array<{ id: string; youtubeUrl: string }> = JSON.parse(localStorage.getItem('echolearn_sessions_list') ?? '[]');
    return sessions.find(session => session.id === 'youtube-history')?.youtubeUrl;
  });
  expect(savedUrl).toBe(youtubeUrl);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await openHistory(page, youtubeTitle);
  const oldTitleResponse = page.waitForResponse(response => {
    const request = new URL(response.url());
    return request.pathname === '/api/bilibili' && request.searchParams.get('info') === '1';
  });
  releaseBiliTitle();
  await (await oldTitleResponse).finished();

  await expect(url).toHaveValue(youtubeUrl);
  await expect(title).toHaveValue(youtubeTitle);
});

test('opening history repairs a previously overwritten YouTube URL', async ({ page }) => {
  await mockNetwork(page);
  await seedHistory(page, true);
  await page.goto('/');
  await enterGuestMode(page);
  await openHistory(page, biliUrl);

  await expect(page.getByPlaceholder(/Paste YouTube \/ Bilibili URL/)).toHaveValue(youtubeUrl);
  await expect(page.getByPlaceholder('Session title...')).toHaveValue(youtubeTitle);
  const current = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_session') ?? 'null'));
  expect(current.youtubeUrl).toBe(youtubeUrl);
});
