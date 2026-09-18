/**
 * Production smoke for the AI key-sentence seek timestamp (manual, opt-in).
 *
 * WHY THIS EXISTS
 * Two questions about a deployed build cannot be answered from CI or from the
 * repository, and one of them cannot be answered by comparing bundles:
 *
 *   1. Is the deployed build the one that contains a given change?
 *   2. Does it behave as that change intends?
 *
 * Bundle comparison is worthless here: the local build has no VITE_SENTRY_DSN,
 * so Sentry is tree-shaken out and the entry chunk is ~85 KB smaller than the
 * deployed one. So this script answers both by BEHAVIOUR: it reads the labels
 * the live page actually rendered and compares them with an offline
 * re-alignment computed by the app's own matcher.
 *
 * The comparison is only meaningful on "discriminating" suggestions — those
 * where aligning against the raw caption blocks and against the rendered
 * sentence lines give different labels. A run with none of those is reported
 * INCONCLUSIVE, never PASS.
 *
 * Usage:
 *   node scripts/ai-seek-smoke.mjs --email you@example.invalid --password-stdin
 *
 * Convenience (credentials from the environment, never echoed):
 *   ECHOLEARN_SMOKE_EMAIL=... ECHOLEARN_SMOKE_PASSWORD=... \
 *   node scripts/ai-seek-smoke.mjs
 *
 * PAID-PROVIDER POLICY — the default cannot spend anything. The `paid-provider`
 * policy from scripts/paid-provider-guard.mjs gates the page's `/api/ai`
 * request at the network layer:
 *   - unset (default)  → the request is ABORTED. A run only completes if the
 *                        analysis is already cached (0 provider calls), which
 *                        is the common case and costs nothing.
 *   - opt-in + cap     → the request is allowed, counted, and a second one is
 *                        aborted. Use ECHOLEARN_ALLOW_PAID_PROVIDER=1 with
 *                        ECHOLEARN_PAID_MAX_INVOCATIONS=1 for one real call.
 * The guard is used here purely as the authorisation checkpoint and counter;
 * an allowed request is passed through with `route.continue()`, so streaming,
 * headers and the request body are untouched.
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = blocked/config error, 3 = INCONCLUSIVE.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createPaidProviderGuard,
  invokePaidProvider,
  resolvePaidProviderPolicy,
} from './paid-provider-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const DEFAULT_BASE = 'https://echo-learn.uk';
const DEFAULT_TRANSCRIPT = path.join(REPO, 'src/data/sample-transcript.json');

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    transcript: DEFAULT_TRANSCRIPT,
    out: path.join(REPO, '.workbuddy', 'evidence', 'ai-seek-smoke.json'),
    shot: null,
    headed: false,
    envFile: null,
    email: process.env.ECHOLEARN_SMOKE_EMAIL ?? null,
    password: process.env.ECHOLEARN_SMOKE_PASSWORD ?? null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--base') { args.base = next; i += 1; }
    else if (key === '--transcript') { args.transcript = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--out') { args.out = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--shot') { args.shot = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--headed') { args.headed = true; }
    else if (key === '--env-file') { args.envFile = path.resolve(process.cwd(), next); i += 1; }
    else if (key === '--email') { args.email = next; i += 1; }
    else if (key === '--password') { args.password = next; i += 1; }
    else if (key === '--help' || key === '-h') { args.help = true; }
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

/**
 * Read ONLY the two smoke credentials out of an explicitly named dotenv-style
 * file. Nothing else is exported and no value is ever logged. `.env.local` is
 * deliberately NOT read implicitly — pulling secrets from a file must be an
 * explicit choice, and this repository's `.env.local` also holds provider keys.
 */
export function readSmokeEnvFile(file) {
  const out = { email: null, password: null };
  if (!file) return out;
  if (!fs.existsSync(file)) throw new Error(`--env-file not found: ${file}`);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (m[1] === 'ECHOLEARN_SMOKE_EMAIL') out.email = value;
    if (m[1] === 'ECHOLEARN_SMOKE_PASSWORD') out.password = value;
  }
  return out;
}

const HELP = `Usage: node scripts/ai-seek-smoke.mjs [options]

  --base <url>        host to smoke (default ${DEFAULT_BASE})
  --transcript <f>    transcript the page is expected to show
                      (default src/data/sample-transcript.json)
  --email / --password  credentials (or ECHOLEARN_SMOKE_EMAIL / _PASSWORD)
  --env-file <f>      read ONLY ECHOLEARN_SMOKE_EMAIL / _PASSWORD from a file
  --out <f>           write the machine-readable evidence here
  --shot <f>          also write a screenshot
  --headed            run a visible browser

Paid-provider policy (scripts/paid-provider-guard.mjs) gates the page's
/api/ai call. Unset = the call is aborted, and the run can only succeed from a
cache HIT. To allow one real call:
  ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=1

Exit codes: 0 PASS, 1 FAIL, 2 blocked/config error, 3 INCONCLUSIVE.
`;

/** Load the app's real matcher/normalizer/formatter, bundled once by Vite.
 *  These are TypeScript with extensionless imports that plain Node cannot
 *  resolve; reimplementing them here would let the verdict drift from the
 *  product. Returns null when bundling is unavailable. */
export async function loadAppModules() {
  try {
    const { build } = await import('vite');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echolearn-seek-smoke-'));
    const adapter = path.join(tmp, 'adapter.ts');
    fs.writeFileSync(
      adapter,
      [
        `export { matchSuggestionToLineStart } from ${JSON.stringify(path.join(REPO, 'src/utils/matchTranscriptLine.ts'))};`,
        `export { normalizeTranscriptToSentences } from ${JSON.stringify(path.join(REPO, 'src/utils/transcriptNormalizer.ts'))};`,
        `export { formatTime } from ${JSON.stringify(path.join(REPO, 'src/components/study/formatTime.ts'))};`,
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      publicDir: false,
      build: {
        ssr: adapter,
        outDir: path.join(tmp, 'out'),
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: 'esm', entryFileNames: 'adapter.mjs' } },
      },
    });
    const mod = await import(pathToFileURL(path.join(tmp, 'out', 'adapter.mjs')).href);
    return mod.matchSuggestionToLineStart && mod.normalizeTranscriptToSentences && mod.formatTime ? mod : null;
  } catch {
    return null;
  }
}

/** Every full-viewport fixed layer that swallows pointer events. A fresh
 *  profile meets a z-[10000] "Choose your language" modal that makes the Study
 *  nav unclickable until it is dismissed. */
const OVERLAY_FINDER = `(() => {
  const els = [...document.querySelectorAll('div')];
  return els.find((d) => {
    const s = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return s.position === 'fixed' && Number(s.zIndex) >= 1000 &&
      r.width >= innerWidth * 0.85 && r.height >= innerHeight * 0.85;
  }) || null;
})()`;

/** Pure classification, kept exported so it can be unit-tested without a browser. */
export function decideVerdict({ cards, rawLines, sentenceLines, match, format }) {
  const rows = cards.map((card) => {
    const fromRaw = card.text ? match(card.text, rawLines) : null;
    const fromSentences = card.text ? match(card.text, sentenceLines) : null;
    const rawLabel = typeof fromRaw === 'number' ? `@${format(fromRaw)}` : null;
    const sentenceLabel = typeof fromSentences === 'number' ? `@${format(fromSentences)}` : null;
    const discriminating = rawLabel !== sentenceLabel;
    return {
      text: card.text,
      live: card.seek ?? null,
      rawLabel,
      sentenceLabel,
      discriminating,
      agreesRaw: discriminating && card.seek === rawLabel,
      agreesSentences: discriminating && card.seek === sentenceLabel,
    };
  });

  const discriminating = rows.filter((r) => r.discriminating);
  const agreesRaw = discriminating.filter((r) => r.agreesRaw).length;
  const agreesSentences = discriminating.filter((r) => r.agreesSentences).length;

  let verdict;
  if (rows.length === 0) verdict = 'FAIL';
  else if (discriminating.length === 0) verdict = 'INCONCLUSIVE';
  else if (agreesSentences > 0 || agreesRaw < discriminating.length) verdict = 'FAIL';
  else verdict = 'PASS';

  return {
    verdict,
    rows,
    discriminating: discriminating.length,
    agreesRaw,
    agreesSentences,
    reason:
      verdict === 'PASS'
        ? 'every discriminating suggestion matches the raw-block alignment'
        : verdict === 'INCONCLUSIVE'
          ? 'no suggestion can tell the two alignments apart in this run'
          : rows.length === 0
            ? 'the page rendered no suggestion cards'
            : `${agreesSentences} discriminating suggestion(s) match the sentence-line alignment and ${discriminating.length - agreesRaw - agreesSentences} match neither`,
  };
}

async function describeAndDismissOverlay(page, label, log) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const info = await page.evaluate(`(() => {
      const el = ${OVERLAY_FINDER};
      if (!el) return null;
      return {
        cls: (el.className || '').toString().slice(0, 90),
        text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
        buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).slice(0, 12),
      };
    })()`);
    if (!info) return;
    log(`[${label}] blocking overlay:`, JSON.stringify(info));
    const clicked = await page.evaluate(`(() => {
      const el = ${OVERLAY_FINDER};
      if (!el) return null;
      const b = [...el.querySelectorAll('button, [role="button"], a[role="button"]')]
        .find((x) => /got it|skip|close|dismiss|later|no thanks|开始|跳过|知道了|确定|完成|稍后|关闭|好的/i.test(x.textContent || ''));
      if (b) { b.click(); return (b.textContent || '').trim(); }
      const tour = document.querySelector('.driver-close-btn, .driver-popover-close-btn');
      if (tour) { tour.click(); return 'driver-close-btn'; }
      return null;
    })()`);
    if (clicked) log(`[${label}] dismissed via:`, clicked);
    else {
      await page.keyboard.press('Escape');
      log(`[${label}] pressed Escape`);
    }
    await page.waitForTimeout(1200);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const log = (...a) => console.log(...a);

  let policy;
  try {
    policy = resolvePaidProviderPolicy();
  } catch (error) {
    log(`CONFIG BLOCKED  ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const guard = createPaidProviderGuard(policy);

  const fromFile = readSmokeEnvFile(args.envFile);
  const email = args.email ?? fromFile.email;
  const password = args.password ?? fromFile.password;
  if (!email || !password) {
    log('MISSING CREDENTIALS  pass --email/--password, set ECHOLEARN_SMOKE_EMAIL/_PASSWORD, or use --env-file (values are never printed)');
    return 2;
  }
  if (!fs.existsSync(args.transcript)) {
    log(`MISSING TRANSCRIPT  ${args.transcript}`);
    return 2;
  }
  const rawTranscript = JSON.parse(fs.readFileSync(args.transcript, 'utf8'));
  const rawLines = (Array.isArray(rawTranscript) ? rawTranscript : rawTranscript.lines ?? []).map((l) => ({
    start: l.start ?? 0,
    text: String(l.text ?? ''),
  }));
  if (rawLines.length === 0) {
    log('MISSING TRANSCRIPT LINES  the transcript file has no usable lines');
    return 2;
  }

  const appModules = await loadAppModules();
  if (!appModules) log('NOTE  could not bundle the app matcher; the verdict will be unavailable');
  const sentenceLines = appModules ? appModules.normalizeTranscriptToSentences(rawTranscript) : [];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'echolearn-seek-smoke-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !args.headed,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const aiRequests = [];
  const aiResponses = [];
  const blocked = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ai')) aiRequests.push(`${r.method()} ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/ai')) aiResponses.push(`${r.status()} ${r.url()}`);
  });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  await page.route('**/api/ai**', async (route) => {
    try {
      // Authorisation checkpoint and counter. The request itself is passed
      // through untouched below, so the guard's injected fetch is a no-op.
      await invokePaidProvider(guard, async () => null);
      await route.continue();
    } catch (error) {
      blocked.push(error instanceof Error ? error.message : String(error));
      await route.abort();
    }
  });

  let cards = [];
  let exitCode = 3;
  let verdictResult = null;
  try {
    await page.goto(`${args.base}/?dogfood=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await page.locator('a[href="/study"]').filter({ visible: true }).first().waitFor({ timeout: 45000 });
    log('signed in at', args.base);

    await describeAndDismissOverlay(page, 'post-signin', log);
    await page.locator('a[href="/study"]').filter({ visible: true }).first().click({ timeout: 30000 });
    await page.waitForURL(/\/study$/, { timeout: 30000 });
    await page.locator('[data-transcript-line]').filter({ visible: true }).first().waitFor({ timeout: 45000 });
    await describeAndDismissOverlay(page, 'pre-analyze', log);

    await page.locator('[data-tour="study-ai"]').filter({ visible: true }).first().click({ timeout: 30000 });
    const panel = page.locator('[data-testid="ai-analysis-panel"]').filter({ visible: true }).first();
    await panel.waitFor({ timeout: 90000 });
    await page.waitForTimeout(4000);

    cards = await panel.evaluate((el) =>
      [...el.querySelectorAll('[data-testid="ai-sentence-card"]')].map((c) => ({
        text: (c.querySelector('p')?.textContent || '').replace(/\s+/g, ' ').trim(),
        seek: c.querySelector('[data-testid="ai-sentence-seek"]')?.textContent?.trim() ?? null,
      })),
    );

    if (args.shot) await page.screenshot({ path: args.shot });

    log(`\n/api/ai requests: ${aiRequests.length}  blocked: ${blocked.length}`);
    for (const b of blocked) log(`   blocked: ${b}`);
    for (const r of aiResponses) log(`   response: ${r}`);

    if (cards.length === 0 && aiRequests.length > 0) {
      log('\nVERDICT: BLOCKED — the page needed a provider call and the paid-provider policy refused it');
      log('   set ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=1 to allow exactly one call');
      exitCode = 2;
    } else if (!appModules) {
      log('\nVERDICT: UNKNOWN — the app matcher could not be bundled, so labels were captured but not judged');
      exitCode = 3;
    } else {
      verdictResult = decideVerdict({
        cards,
        rawLines,
        sentenceLines,
        match: appModules.matchSuggestionToLineStart,
        format: appModules.formatTime,
      });
      log('\n=== suggestions on the live build ===');
      for (const [i, r] of verdictResult.rows.entries()) {
        log(`  [${i}] live=${r.live ?? '(none)'}  raw=${r.rawLabel ?? 'null'}  sentences=${r.sentenceLabel ?? 'null'}  discriminating=${r.discriminating}`);
        log(`       ${(r.text || '').slice(0, 110)}`);
      }
      log(
        `\nVERDICT: ${verdictResult.verdict} — ${verdictResult.reason}` +
          `\n  discriminating=${verdictResult.discriminating} agreesRaw=${verdictResult.agreesRaw} agreesSentences=${verdictResult.agreesSentences}`,
      );
      exitCode = verdictResult.verdict === 'PASS' ? 0 : verdictResult.verdict === 'FAIL' ? 1 : 3;
    }
  } catch (error) {
    log('\nSMOKE ERROR', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    exitCode = 2;
  } finally {
    try {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(
        args.out,
        JSON.stringify(
          {
            base: args.base,
            transcript: args.transcript,
            paidProvider: { enabled: policy.enabled, maxInvocations: policy.maxInvocations, invocations: guard.invocations },
            aiRequests,
            aiResponses,
            blocked,
            consoleErrors,
            cards,
            verdict: verdictResult ? { verdict: verdictResult.verdict, reason: verdictResult.reason, rows: verdictResult.rows } : null,
          },
          null,
          2,
        ),
      );
      log(`\nevidence written: ${args.out}`);
    } catch (error) {
      log('could not write evidence:', error instanceof Error ? error.message : String(error));
    }
    await ctx.close();
  }
  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
