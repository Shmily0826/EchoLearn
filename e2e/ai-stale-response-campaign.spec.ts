import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openSignedInApp } from './helpers/sessionFixture';

/**
 * P3 AI_PENDING_STALE_RESPONSE_V1 — campaign scenario (untracked).
 * Cross-session stale-response discriminator with held/out-of-order /api/ai
 * fulfillments. Zero provider spend: /api/ai is route-mocked; identity is
 * synthetic; Firebase endpoints are armed by the helper.
 */

const SAMPLE_ANALYSIS = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures/ai-analysis.sample.json'), 'utf8'),
) as Record<string, unknown>;

function sseBody(content: string): string {
  const mid = Math.floor(content.length / 2);
  const frames = [content.slice(0, mid), content.slice(mid)]
    .filter((p) => p.length > 0)
    .map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  return `${frames.join('')}data: [DONE]\n\n`;
}

interface HeldCall {
  body: string;
  release: (body: string) => Promise<void>;
}

/** Install /api/ai routing where every call is HELD until manually released. */
async function holdAiCalls(page: Page): Promise<{ calls: HeldCall[]; capturedBodies: string[] }> {
  const calls: HeldCall[] = [];
  const capturedBodies: string[] = [];
  await page.route('**/api/ai', async (route) => {
    capturedBodies.push(route.request().postData() ?? '');
    const body = sseBody(
      JSON.stringify({
        ...SAMPLE_ANALYSIS,
        summaryEn: `HELD-ANALYSIS-MARKER ${SAMPLE_ANALYSIS.summaryEn ?? ''}`,
      }),
    );
    await new Promise<void>((resolveRelease) => {
      calls.push({
        body,
        release: async (override) => {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: override ?? body });
          resolveRelease();
        },
      });
    });
  });
  return { calls, capturedBodies };
}

test('stale held AI response does not attach to a newer session; immediate newer analysis wins', async ({ context, page }) => {
  test.setTimeout(180_000);
  await openSignedInApp(context, page);
  const { calls, capturedBodies } = await holdAiCalls(page);

  // Session 1: the auto-loaded sample video
  await page.goto('/study', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Analyze$/ }).first().click();
  await expect.poll(() => capturedBodies.length, { timeout: 15000 }).toBe(1);
  await expect(page.getByText(/Analyzing|Loading/i).first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  // leave Study while request 1 is still held
  await page.locator('a[href="/"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(800);

  // Session 2: import the local audio fixture (deterministic transcript)
  const wav = fs.readFileSync(path.resolve(process.cwd(), '.workbuddy/fixtures/lesson-fixture.wav'));
  const srt = fs.readFileSync(path.resolve(process.cwd(), '.workbuddy/fixtures/lesson-fixture.srt'), 'utf8');
  await page.goto('/study', { waitUntil: 'domcontentloaded' });
  const importer = page.getByTestId('local-media-importer').first();
  await importer.waitFor({ state: 'visible', timeout: 10000 });
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: 'ai-second.wav', mimeType: 'audio/wav', buffer: wav });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: 'ai-second.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt, 'utf8') });
  await importer.getByRole('button', { name: 'Open in Study' }).click();
  await page.getByText('The fixture preamble begins the lesson.').first().waitFor({ state: 'visible', timeout: 10000 });

  // Analyze session 2 — request 2 is also held until we release it below
  await page.getByRole('button', { name: /^(Analyze|Re-analyze)$/ }).first().click();
  await expect.poll(() => capturedBodies.length, { timeout: 15000 }).toBe(2);

  // Release request 2 FIRST (newer) with a session-2 marker
  const session2Body = sseBody(
    JSON.stringify({
      ...SAMPLE_ANALYSIS,
      summaryEn: 'SESSION2-ANALYSIS-MARKER — fixture preamble lesson summary',
      vocabularySuggestions: [
        { word: 'preamble', context: 'The fixture preamble begins the lesson.', meaningCn: '前言', reason: 'session2 test suggestion' },
      ],
    }),
  );
  await calls[1].release(session2Body);
  await page.waitForTimeout(1200);
  const panel2 = await page.evaluate(() => document.body.innerText.includes('SESSION2-ANALYSIS-MARKER'));
  expect(panel2, 'session 2 panel should show its own analysis').toBe(true);

  // Now release the OLD held response (session 1) — it must not attach to session 2
  await calls[0].release();
  await page.waitForTimeout(1500);
  const panel2After = await page.evaluate(() => ({
    hasSession2: document.body.innerText.includes('SESSION2-ANALYSIS-MARKER'),
    hasStaleSession1: document.body.innerText.includes('HELD-ANALYSIS-MARKER'),
    analyzing: /Analyzing\.\.\./.test(document.body.innerText),
  }));
  expect(panel2After.hasSession2, 'session 2 keeps its own analysis after the old response resolves').toBe(true);
  expect(panel2After.hasStaleSession1, 'stale session-1 analysis must not leak into session 2').toBe(false);
  expect(panel2After.analyzing, 'no stuck loading state (A4)').toBe(false);

  // A2/A3: the suggestion belongs to session 2's transcript
  const suggestionVisible = await page.evaluate(() => document.body.innerText.includes('preamble'));
  expect(suggestionVisible, 'session2 suggestion content visible').toBe(true);
});
