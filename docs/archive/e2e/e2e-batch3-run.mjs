// Standalone Playwright Library runner for Batch 3 E2E scenarios.
// Used because the test-runner's output-dir cleanup crashes on this sandbox's
// "safe-delete" shim. This script uses the browser library directly and does
// its own teardown (no trash call). Real browser + real DOM, network mocked.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const SAMPLE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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
  });
}

async function routeTranscript(page, { phase, responses }) {
  // The transcript fetch chain tries several hosts (local proxy
  // proxy.echo-learn.uk, CF Worker yt-transcript-proxy, same-origin
  // /api/transcript). We mock ALL of them with a single **/api/transcript**
  // handler so the mock wins regardless of which host/strategy fires.
  // Aborting youtube.com/youtubei makes the InnerTube/web-scraping/npm
  // fallback strategies fail fast (so a 'fail' phase truly exhausts the chain).
  await page.route('**/*youtube.com/**', (r) => r.abort());
  await page.route('**/*youtubei/**', (r) => r.abort());

  // `phase` flips between 'fail' and 'ok' (set to a function if you need finer
  // control). In 'fail' phase EVERY strategy must fail so a real error surfaces
  // (the transcript chain only throws once all 5 strategies are exhausted).
  // In 'ok' phase the transcript API returns valid lines.
  let call = 0;
  await page.route('**/api/transcript**', (route) => {
    let kind;
    if (typeof phase === 'function') kind = phase(call);
    else if (phase === 'fail' || phase === 'ok') kind = phase;
    else kind = responses[Math.min(call, responses.length - 1)] || 'ok';
    call += 1;
    if (kind === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: transcriptPayload([
        { start: 0, end: 2, text: 'Good morning everyone' },
        { start: 2, end: 4, text: 'Welcome to this lesson' },
        { start: 4, end: 6, text: 'Today we learn zebraxyz' },
      ]),
    });
  });
}

async function routeDictionary(page) {
  await page.route('**/api/dictionary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '/ɡʊd/', ipa_us: '/ɡʊd/', audio_url: '', base_form: 'good', source: 'free-dictionary',
        entries: [{ pos: 'adjective', definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }] }],
      }),
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
  // The Study page auto-loads a SAMPLE video on mount (no network). Let that
  // mount effect fully settle before we load our own URL, otherwise the sample
  // auto-load can race with / override our caption request.
  await page.waitForTimeout(2000);
}

async function loadYoutubeUrl(page) {
  const input = page.locator('#tour-study-url');
  await input.fill(SAMPLE_URL);
  await page.locator('#tour-study-load').click();
}

// Word tokens in the transcript are individual <span>s (one per word). The
// full line text is split across spans, so we assert on a single word token
// rather than the whole line. `zebraxyz` is a unique marker present ONLY in our
// mocked payload (the auto-loaded sample transcript does not contain it), so
// its visibility proves the mock — not the sample — is rendered.
async function transcriptLoaded(page) {
  await page.getByText('zebraxyz', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 20000 });
}

async function saveGoodWord(page) {
  // Load OUR mock transcript (overrides the auto-loaded sample) and wait until
  // it is rendered (the unique marker "zebraxyz" appears), so the word we save
  // comes from the deterministic mock, not the sample video.
  await loadYoutubeUrl(page);
  await transcriptLoaded(page);
  // Note: getByText with exact:true is CASE-SENSITIVE, so match the capitalized
  // token from the mock ("Good") via a case-insensitive regex.
  const good = page.getByText(/good/i).filter({ visible: true }).first();
  await good.click();
  const saveBtn = page.locator('#tour-transcript-save-word');
  await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveBtn.click();
  await saveBtn.waitFor({ state: 'hidden', timeout: 45000 });
  await page.waitForTimeout(300); // let popup fully close before next interaction
}

// ── Scenarios ────────────────────────────────────────────────
async function scenarioRetry(page) {
  await seedCleanVisitor(page);
  // First load: every strategy must fail so a real error card + Retry button
  // appears (the chain only throws once all 5 strategies are exhausted).
  // Retry: succeed. We flip `phase.kind` from 'fail' to 'ok' right after the
  // error is detected, so the next runCaptionRequest (handleReloadTranscript)
  // hits the working same-origin /api/transcript.
  const phase = { kind: 'fail' };
  await routeTranscript(page, { phase: () => phase.kind });
  await gotoStudy(page);
  await loadYoutubeUrl(page);
  // error state appears (mobile + desktop both render a Retry button)
  const retryBtn = page.getByRole('button', { name: /retry|重试/i }).first();
  await retryBtn.waitFor({ timeout: 30000 });
  phase.kind = 'ok';
  await retryBtn.click();
  await transcriptLoaded(page);
}

async function scenarioSaveDelete(page) {
  await seedCleanVisitor(page);
  await routeDictionary(page);
  await routeTranscript(page, { phase: 'ok' });
  await gotoStudy(page);
  await saveGoodWord(page);
  await page.getByRole('link', { name: 'Words' }).click();
  await page.getByText('1 words').waitFor({ timeout: 10000 });
  page.on('dialog', (d) => d.accept());
  const del = page.getByRole('button', { name: /delete/i }).first();
  await del.waitFor({ timeout: 5000 });
  await del.click();
  await page.getByText('0 words').waitFor({ timeout: 10000 });
}

async function scenarioDuplicate(page) {
  await seedCleanVisitor(page);
  await routeDictionary(page);
  await routeTranscript(page, { phase: 'ok' });
  await gotoStudy(page);
  await saveGoodWord(page);
  // The word is now saved. Re-open the SAME "good" token on the Study page
  // (no navigation — the mock transcript is still rendered). The popup must
  // NOT offer a second "add" button (dedup at the UI layer); it shows
  // "Already in vocabulary". This proves no duplicate is created.
  const goodToken = page.getByText(/good/i).filter({ visible: true }).first();
  await goodToken.waitFor({ state: 'visible', timeout: 10000 });
  await goodToken.click();
  // The transcript word popup uses transcript.wordSaved = "Already in vocab"
  // (en) once the word is already in the vocabulary — dedup at the UI layer.
  await page.getByText(/already in vocab|已在生词本中/i).first().waitFor({ timeout: 10000 });
  // Verify the global word count is exactly 1 (no duplicate created).
  await page.getByRole('link', { name: 'Words' }).click();
  await page.getByText('1 words').waitFor({ timeout: 10000 });
}

async function scenarioInvalidUrl(page) {
  await seedCleanVisitor(page);
  await routeTranscript(page, { phase: 'ok' });
  await gotoStudy(page);
  const input = page.locator('#tour-study-url');
  // Submitting a non-URL must NOT crash the page and must keep the input
  // usable (parseYouTubeId returns null → early return, no caption request).
  await input.fill('not a url at all !!!');
  await page.locator('#tour-study-load').click();
  await input.waitFor({ state: 'visible' });
  await page.locator('#tour-study-load').waitFor({ state: 'visible' });
  // Now load a valid YouTube URL → transcript should render.
  await loadYoutubeUrl(page);
  await transcriptLoaded(page);
}

async function scenarioRefreshPersistence(page) {
  await seedCleanVisitor(page);
  await routeDictionary(page);
  await routeTranscript(page, { phase: 'ok' });
  await gotoStudy(page);
  await saveGoodWord(page);
  // Reload simulates a browser restart. The saved word must persist in the
  // words store (localStorage) across reloads.
  await page.reload();
  await page.waitForTimeout(800);
  // After reload the landing page reappears (seedCleanVisitor clears the
  // session on every navigation). Re-enter Study without login.
  await page.getByRole('button', { name: 'Try without login' }).click();
  await page.waitForTimeout(600);
  await dismissOnboarding(page);
  await page.getByRole('link', { name: 'Words' }).click();
  await page.getByText('1 words').waitFor({ timeout: 10000 });
}

// ── Driver ───────────────────────────────────────────────────
const scenarios = [
  ['Retry: 500 → error → retry → success', scenarioRetry],
  ['Save word full chain + delete', scenarioSaveDelete],
  ['Duplicate save → count stays 1', scenarioDuplicate],
  ['Invalid URL → page alive → valid URL recovers', scenarioInvalidUrl],
  ['Load + refresh persistence', scenarioRefreshPersistence],
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, fn] of scenarios) {
    const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    try {
      await fn(page);
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      failures.push(`${name}: ${err.message}`);
      console.log(`FAIL  ${name}\n      ${err.message}`);
      const safe = name.replace(/[^a-z0-9]+/gi, '_');
      await page.screenshot({ path: `pw_fail_${safe}.png`, fullPage: true }).catch(() => {});
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
      console.log(`      [page text] ${bodyText.replace(/\n/g, ' ').slice(0, 300)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n=== Batch 3 E2E: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
