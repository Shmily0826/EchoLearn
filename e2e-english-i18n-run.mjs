// Standalone Playwright Library runner for the English-i18n regression (Bug 2).
// Uses the browser library directly (no test-runner reporter/output-dir cleanup,
// which crashes on this sandbox's safe-delete shim). Real browser + real DOM,
// network mocked.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const SAMPLE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function transcriptPayload(lines) {
  return JSON.stringify({ lines, language: 'en', source: 'youtube' });
}

async function dismissOnboarding(page) {
  await page.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) {
    const en = page.getByRole('button', { name: 'English', exact: true });
    if (await en.isVisible().catch(() => false)) { await en.click(); await page.waitForTimeout(400); continue; }
    const close = page.getByRole('button', { name: 'Close', exact: true });
    if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); continue; }
    break;
  }
}

async function seedCleanVisitor(page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_current_session');
    localStorage.setItem('echolearn_lang', 'en');
  });
}

async function routeTranscript(page) {
  await page.route('**/proxy.echo-learn.uk/**', (route) => route.abort());
  await page.route('**/api/transcript**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: transcriptPayload([
        { start: 0, end: 2, text: 'Good morning everyone' },
        { start: 2, end: 4, text: 'Welcome to this lesson' },
      ]),
    }),
  );
}

async function gotoStudy(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without login' }).click();
  await page.waitForTimeout(600);
  await dismissOnboarding(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await page.waitForURL(/\/study$/);
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true });
let failed = false;
const page = await browser.newPage({ baseURL: BASE, viewport: { width: 1280, height: 720 } });
try {
  await seedCleanVisitor(page);
  await routeTranscript(page);
  await gotoStudy(page);

  const urlInput = page.locator('#tour-study-url');
  await urlInput.fill(SAMPLE_URL);
  await page.locator('#tour-study-load').click();

  // Wait for the transcript to appear (proves the caption load succeeded).
  // Match a single word token with a case-insensitive regex to avoid the
  // strict-mode ambiguity between the transcript line and the word popup.
  await page.getByText(/good/i).filter({ visible: true }).first().waitFor({ timeout: 15000 });

  // The source label must be English.
  await page.getByText('YouTube official subtitles').waitFor({ timeout: 5000 });

  const bodyText = await page.locator('body').innerText();
  const forbidden = ['来源：', 'YouTube 官方字幕', '加载中', '视频仍在准备中', '前往平台观看'];
  for (const s of forbidden) {
    if (bodyText.includes(s)) {
      throw new Error(`Leaked Chinese literal: "${s}"`);
    }
  }
  console.log('PASS  English UI contains no hardcoded Chinese after successful load');
} catch (err) {
  failed = true;
  console.log('FAIL  English i18n check:', err.message);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
  console.log('      [page text]', bodyText.replace(/\n/g, ' ').slice(0, 300));
} finally {
  await page.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
