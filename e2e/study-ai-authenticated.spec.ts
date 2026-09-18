import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openSignedInApp } from './helpers/sessionFixture';

/**
 * Authenticated AI Analyze coverage.
 *
 * Analyze is gated behind `if (!user)` in StudyPage and /api/ai rejects
 * unauthenticated callers with 401, so the guest suites cannot reach it. These
 * tests use the fabricated signed-in session (see helpers/sessionFixture.ts) and
 * route-mock /api/ai, so they need no credentials, contact no provider and
 * spend nothing.
 *
 * Fixture provenance: e2e/fixtures/ai-analysis.sample.json is a real response
 * recorded on 2026-09-16 through the production /api/ai for the bundled sample
 * video. See TEST_REPORT.md.
 *
 * Transport note: StudyPage passes an `onChunk` callback, and aiAnalysis only
 * sets `stream: true` when it gets one, so the real request is SSE. The mocks
 * below therefore emit `data:` frames, not a single JSON envelope.
 */

const SAMPLE_ANALYSIS = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures/ai-analysis.sample.json'), 'utf8'),
) as {
  summaryEn: string;
  summaryCn: string;
  keyTakeaways: string[];
  vocabularySuggestions: Array<{ word: string; context: string; meaningCn: string; reason: string }>;
  sentenceSuggestions: Array<{ text: string; meaningCn: string; reason: string; grammarNotes?: string }>;
};

/** The fallback path is taken when the live call fails; these are its tells. */
const LOCAL_FALLBACK_BANNER = /AI service unavailable — showing local transcript-based analysis/;
const LOCAL_SUMMARY_MARKER = /AI API unavailable/;

/**
 * Wrap a result in the SSE frame sequence the client's streaming reader
 * expects, split across two frames so the reader's line-buffering is exercised.
 */
function sseBody(content: string): string {
  const mid = Math.floor(content.length / 2);
  const frames = [content.slice(0, mid), content.slice(mid)]
    .filter((part) => part.length > 0)
    .map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  return `${frames.join('')}data: [DONE]\n\n`;
}

interface AiResponse {
  status: number;
  /** Raw HTTP body. Use `sseBody()` for the happy path. */
  body: string;
  contentType?: string;
  /** Abort the request instead of fulfilling it (network failure). */
  abort?: boolean;
}

interface CapturedRequest {
  authorization: string | null;
  body: {
    model?: string;
    stream?: boolean;
    response_format?: { type?: string };
    messages?: Array<{ role?: string; content?: string }>;
  } & Record<string, unknown>;
}

/**
 * Install product-API routing. Registered after the Firebase routes so it wins
 * for /api/**, and it never lets a real caption acquisition or provider call out.
 */
async function installApiRoutes(
  page: Page,
  options: { ai: AiResponse[]; captured?: CapturedRequest[] },
): Promise<void> {
  let aiIndex = 0;
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();

    if (/\/api\/ai(\/|$|\?)/.test(url)) {
      const response = options.ai[Math.min(aiIndex, options.ai.length - 1)];
      aiIndex += 1;
      options.captured?.push({
        authorization: route.request().headers()['authorization'] ?? null,
        body: JSON.parse(route.request().postData() ?? '{}'),
      });
      if (response.abort) return route.abort('timedout');
      return route.fulfill({
        status: response.status,
        contentType: response.contentType ?? 'text/event-stream',
        body: response.body,
      });
    }

    if (/\/api\/dictionary/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ipa_uk: '/ɡʊd/', ipa_us: '/ɡʊd/', audio_url: '', base_form: 'good', source: 'free-dictionary',
          entries: [{ pos: 'adjective', definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }] }],
        }),
      });
    }

    // No caption acquisition, no ASR, no provider traffic.
    return route.abort();
  });
}

/** Reach Study with the bundled sample transcript loaded. */
async function reachStudy(page: Page) {
  await page.locator('a[href="/study"]').filter({ visible: true }).first().click();
  await page.waitForURL(/\/study$/, { timeout: 20_000 });
  await expect(
    page.locator('[data-transcript-line]').filter({ visible: true }).first(),
    'the bundled sample transcript never rendered',
  ).toBeVisible({ timeout: 25_000 });
}

const analyzeButton = (page: Page) =>
  page.locator('[data-tour="study-ai"]').filter({ visible: true }).first();

/** The panel is rendered once per layout, so scope to the visible one. */
const aiPanel = (page: Page) =>
  page.locator('[data-testid="ai-analysis-panel"]').filter({ visible: true }).first();

const vocabCard = (page: Page, word: string) =>
  aiPanel(page).locator(`[data-testid="ai-vocab-card"][data-word="${word.toLowerCase()}"]`);

const transcriptLine = (page: Page) =>
  page.locator('[data-transcript-line]').filter({ visible: true }).first();

/**
 * The scroll offset of the transcript pane the learner is actually looking at.
 *
 * The transcript is rendered twice (a `lg:hidden` mobile copy and a desktop
 * copy), so an unscoped query can read the wrong one. Walk up from a *visible*
 * row to its scroller, exactly as TranscriptViewer does.
 */
const visibleTranscriptScrollTop = (page: Page) =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-transcript-line]')].find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const container = row?.closest('.overflow-y-auto') as HTMLElement | null;
    return container ? Math.round(container.scrollTop) : -1;
  });

/** Open the AI panel and wait until an analysis has rendered. */
async function analyze(page: Page) {
  await analyzeButton(page).click();
  await expect(aiPanel(page)).toBeVisible({ timeout: 25_000 });
}

/** Boot the signed-in app with an empty on-device library and fixed CEFR range. */
async function bootSignedIn(page: Page, context: Parameters<typeof openSignedInApp>[0]) {
  await page.addInitScript(() => {
    // Seed once per test, not once per document. An init script re-runs on
    // every navigation, so an unguarded wipe would erase anything the test had
    // already saved if the page reloaded mid-test (observed once as a flake:
    // the card read "Saved" while storage was empty).
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.removeItem('echolearn_session');
    localStorage.removeItem('echolearn_current_session');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
    // Read by StudyPage on mount, then echoed into the AI prompt.
    localStorage.setItem('echolearn_cefr_min', 'B2');
    localStorage.setItem('echolearn_cefr_max', 'C1');
  });
  await openSignedInApp(context, page);
}

test.describe('AI Analyze (authenticated)', () => {
  test('renders every analysis section from a recorded response', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }] });
    await reachStudy(page);
    await analyze(page);

    await expect(aiPanel(page).getByText('English Summary')).toBeVisible();
    await expect(aiPanel(page).getByText('Key Takeaways')).toBeVisible();
    await expect(aiPanel(page).getByText('Vocabulary Suggestions')).toBeVisible();
    await expect(aiPanel(page).getByText('Useful Sentences')).toBeVisible();

    // Real content, not just headers: one takeaway, one word, one sentence.
    await expect(aiPanel(page).locator('[data-testid="ai-takeaway"]').first())
      .toContainText(SAMPLE_ANALYSIS.keyTakeaways[0].slice(0, 40));
    await expect(vocabCard(page, SAMPLE_ANALYSIS.vocabularySuggestions[0].word)).toBeVisible();
    await expect(aiPanel(page).locator('[data-testid="ai-sentence-card"]').first())
      .toContainText(SAMPLE_ANALYSIS.sentenceSuggestions[0].text.slice(0, 40));
  });

  test('sends one authenticated streaming request that carries the transcript and the CEFR range', async ({ context, page }) => {
    const captured: CapturedRequest[] = [];
    await bootSignedIn(page, context);
    await installApiRoutes(page, {
      ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }],
      captured,
    });
    await reachStudy(page);
    await analyze(page);

    expect(captured.length, 'exactly one /api/ai call should have been made').toBe(1);

    // The bearer token is what makes this the authenticated path rather than a
    // bypass. The value is synthetic and is never asserted on or printed.
    expect(captured[0].authorization, 'the request was not authenticated').toMatch(/^Bearer .+/);

    expect(captured[0].body.response_format, 'the request is not asking for JSON').toEqual({ type: 'json_object' });
    expect(captured[0].body.stream, 'StudyPage streams, so the request must ask for SSE').toBe(true);

    // The prompt must carry the transcript and the levels the controls selected.
    const prompt = (captured[0].body.messages ?? []).map((m) => m.content ?? '').join('\n');
    expect(prompt, 'the transcript did not reach the prompt').toContain('Good morning');
    expect(prompt, 'the selected CEFR minimum did not reach the prompt').toContain('B2');
    expect(prompt, 'the selected CEFR maximum did not reach the prompt').toContain('C1');
  });

  test('each suggested sentence carries the moment it came from', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }] });
    await reachStudy(page);
    await analyze(page);

    // Every suggestion in this recorded fixture is a verbatim transcript
    // sentence, so alignment must resolve a timestamp for all of them. A
    // suggestion the aligner cannot place stays timestamp-less by design, so
    // "no seek control" is only correct for text that is not in the transcript.
    const controls = aiPanel(page).locator('[data-testid="ai-sentence-seek"]');
    await expect(controls).toHaveCount(SAMPLE_ANALYSIS.sentenceSuggestions.length);
    await expect(controls.first()).toHaveText(/^@\d{1,2}:\d{2}$/);

    // All four labels are the sentence's real start, taken from the raw caption
    // blocks: 43.096s, 577.044s, 1093.128s, 1139.044s → 0:43, 9:37, 18:13, 18:59.
    //
    // 0:43 is the regression this pins. Aligning against the *rendered* sentence
    // rows reported 0:37 for this one, because `normalizeTranscriptToSentences()`
    // merges the standalone "(Laughter)" block into the sentence, so that row
    // starts at the laugh's 37.269s and 43.096s is not any row's start at all —
    // no ranking rule can reach it. StudyPage therefore aligns the timestamp
    // against `rawBlocks`. The scroll target is unaffected: rows resolve by
    // [start, end) and the merged row [37.269s, 48.973s] still contains 43.096s.
    await expect(controls).toHaveText(['@0:43', '@9:37', '@18:13', '@18:59']);
  });

  test('a suggested sentence scrolls the visible transcript to its row', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }] });
    await reachStudy(page);
    await analyze(page);

    // The last suggestion sits near the end of a 427-line transcript, so
    // reaching it must move the transcript pane — the first one starts at 0:43
    // and may already be on screen without any scrolling.
    const seek = aiPanel(page).locator('[data-testid="ai-sentence-seek"]').last();
    await expect(seek).toHaveText('@18:59');
    const before = await visibleTranscriptScrollTop(page);

    await seek.click();

    // The pane scroll does not depend on the player: this suite stubs the
    // third-party hosts, so there is no real media to seek, and the jump is
    // asserted on Production separately. What must hold here is that the copy
    // the learner can actually see brought the matched row into view — a hidden
    // twin would take the scroll silently and leave this pane where it was.
    await expect
      .poll(() => visibleTranscriptScrollTop(page), {
        message: 'the visible transcript pane did not scroll to the suggested sentence',
        timeout: 10_000,
      })
      .toBeGreaterThan(before);

    // Polled rather than read once: `scrollIntoView` animates, so the row can
    // still be a few pixels outside the pane on the first frame after the
    // offset settles.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rows = [...document.querySelectorAll('[data-transcript-line]')].filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            const target = rows.find((el) => /the only way we'll do it/.test(el.innerText));
            if (!target) return null;
            const container = target.closest('.overflow-y-auto') as HTMLElement | null;
            if (!container) return null;
            const rowRect = target.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            return rowRect.top >= containerRect.top - 4 && rowRect.bottom <= containerRect.bottom + 4;
          }),
        { message: 'the matched row is not inside the visible transcript pane', timeout: 10_000 },
      )
      .toBe(true);
  });

  test('saves a suggested word into the vocabulary list', async ({ context, page }) => {
    // Kept for diagnosis only: a main-frame reload during the test would
    // explain a save that reaches the UI but not storage.
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }] });
    await reachStudy(page);
    await analyze(page);

    const suggestedWord = SAMPLE_ANALYSIS.vocabularySuggestions[0].word;
    const card = vocabCard(page, suggestedWord);
    await card.getByRole('button', { name: '+ Add', exact: true }).click();

    // The card flips to its saved state and the word lands in on-device storage.
    await expect(card.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    try {
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('echolearn_vocabulary') ?? ''), {
          message: 'the suggested word was not persisted to the vocabulary list',
        })
        .toContain(suggestedWord);
    } catch (error) {
      throw new Error(
        `the suggested word was not persisted to the vocabulary list `
        + `(main-frame navigations: ${navigations.join(' -> ') || 'none'})`,
        { cause: error },
      );
    }
  });

  test('a 500 from the AI proxy falls back to local analysis and says so', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 500, contentType: 'text/plain', body: 'upstream exploded' }] });
    await reachStudy(page);
    await analyze(page);

    await expect(aiPanel(page).getByText(LOCAL_FALLBACK_BANNER)).toBeVisible({ timeout: 10_000 });
    await expect(aiPanel(page).getByText(LOCAL_SUMMARY_MARKER)).toBeVisible();

    // Provider diagnostics stay out of the learner UI.
    await expect(page.getByText(/upstream exploded/)).toHaveCount(0);
    await expect(page.getByText(/DeepSeek API error/)).toHaveCount(0);
  });

  test('a network failure falls back instead of leaving the button stuck', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: '', abort: true }] });
    await reachStudy(page);
    await analyze(page);

    await expect(aiPanel(page).getByText(LOCAL_FALLBACK_BANNER)).toBeVisible({ timeout: 10_000 });
    await expect(analyzeButton(page)).toBeEnabled();
    await expect(transcriptLine(page)).toBeVisible();
  });

  test('an unparseable response falls back and leaks no response body', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, {
      ai: [{ status: 200, body: sseBody('Sorry, I cannot help with that request.') }],
    });
    await reachStudy(page);
    await analyze(page);

    await expect(aiPanel(page).getByText(LOCAL_FALLBACK_BANNER)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cannot help with that request/)).toHaveCount(0);
    await expect(page.getByText(/Could not parse/)).toHaveCount(0);
  });

  test('re-analyzing after a settings change replaces the panel content', async ({ context, page }) => {
    const twice = JSON.parse(JSON.stringify(SAMPLE_ANALYSIS)) as typeof SAMPLE_ANALYSIS;
    twice.keyTakeaways = ['Second run takeaway.'];
    twice.vocabularySuggestions = [SAMPLE_ANALYSIS.vocabularySuggestions[1]];
    twice.sentenceSuggestions = [];

    const captured: CapturedRequest[] = [];
    await bootSignedIn(page, context);
    await installApiRoutes(page, {
      ai: [
        { status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) },
        { status: 200, body: sseBody(JSON.stringify(twice)) },
      ],
      captured,
    });
    await reachStudy(page);
    await analyze(page);
    await expect(aiPanel(page).locator('[data-testid="ai-takeaway"]')).toHaveCount(3);

    // Results are cached per (transcript + settings), so a repeat run only
    // becomes a new analysis once the level range changes. Without this the
    // second click is served by the cache and the panel legitimately stays.
    await page.getByRole('button', { name: 'Study settings' }).click();
    await page.getByLabel('Minimum CEFR level').selectOption('A2');

    await analyzeButton(page).click();
    await expect(aiPanel(page).locator('[data-testid="ai-takeaway"]')).toHaveCount(1, { timeout: 25_000 });
    await expect(aiPanel(page).locator('[data-testid="ai-takeaway"]').first())
      .toContainText('Second run takeaway');
    // The first run's vocabulary is gone, not stacked underneath.
    await expect(aiPanel(page).locator('[data-testid="ai-vocab-card"]')).toHaveCount(1);
    expect(captured.length, 'the second run should have sent its own request').toBe(2);
    const secondPrompt = (captured[1].body.messages ?? []).map((m) => m.content ?? '').join('\n');
    expect(secondPrompt, 'the new level range should reach the prompt').toContain('A2');
  });

  test('closing the panel keeps the transcript', async ({ context, page }) => {
    await bootSignedIn(page, context);
    await installApiRoutes(page, { ai: [{ status: 200, body: sseBody(JSON.stringify(SAMPLE_ANALYSIS)) }] });
    await reachStudy(page);
    await analyze(page);

    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await expect(aiPanel(page)).toBeHidden({ timeout: 10_000 });
    await expect(transcriptLine(page)).toBeVisible();
  });
});
