// REAL_FIREBASE_AUTH_E2E_REGRESSION_V1 — three real-login regressions against the
// real Firebase project (auth + Firestore rules + cloud sync), running against the
// local dev server.
//
// Credentials come from Windows Credential Manager (scripts/credman.ps1, targets
// EchoLearn-QA-Account-A/B — see docs/QA_ACCOUNTS.md). They are NEVER committed and
// NEVER printed. When the credential store is unavailable (e.g. CI), the whole spec
// skips — the synthetic-session suites (sessionFixture) remain the CI layer.
//
// Cost note: saving a word as an authenticated user triggers translateWord
// (/api/ai) when the dictionary yields no Chinese meaning — one real provider call
// per new word saved in E1. Recovery/isolation scenarios (E2/E3) save nothing.
// Fixtures are idempotent: each run merges a word that is not yet in the account.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const credman = path.resolve(here, '../scripts/credman.ps1');
const credUser = path.resolve(here, '../scripts/credman_user.ps1');

function readAccount(letter: 'A' | 'B'): { user: string; password: string } {
  const user = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', credUser, '-Target', `EchoLearn-QA-Account-${letter}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const password = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', credman, 'read', `EchoLearn-QA-Account-${letter}`, user],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (password.length < 20) throw new Error(`implausible credential length for ${letter}`);
  return { user, password };
}

const credsAvailable = (() => {
  try {
    readAccount('A');
    readAccount('B');
    return true;
  } catch {
    return false;
  }
})();

const A = credsAvailable ? readAccount('A') : null;
const B = credsAvailable ? readAccount('B') : null;

// Candidate words from the bundled sample transcript (Ken Robinson), ordered;
// each run merges the first one that is not already in Account A's cloud set.
const CANDIDATE_WORDS = ['leaving', 'conference', 'variety', 'presentations', 'human', 'morning', 'second', 'place'];

test.describe.configure({ mode: 'serial' });
test.skip(!credsAvailable, 'REAL_AUTH_REGRESSION: Windows Credential Manager QA credentials unavailable (CI runs the synthetic-session suites instead)');

async function appInit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.removeItem('echolearn_guest_mode');
  });
}

async function signIn(page: Page, account: { user: string; password: string }): Promise<void> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const emailInput = page.locator('input[type="email"]').first();
  if (!(await emailInput.isVisible().catch(() => false))) {
    const signInNav = page.getByRole('button', { name: /sign in \/ sign up/i }).first();
    if (await signInNav.count() && await signInNav.isVisible().catch(() => false)) {
      await signInNav.click();
      await page.waitForTimeout(2500);
    }
  }
  await emailInput.fill(account.user);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  // real Firebase auth + post-login cloud sync
  await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
}

async function signOut(page: Page): Promise<void> {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /sign out/i }).first().click();
  await expect(page.getByRole('button', { name: /try without login/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
}

const vocab = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]').map(w => w.word));

let mergedWord = '';
let fixtureWord = '';

test('E1: guest-saved word reaches the verified account through the real cloud merge', async ({ page }) => {
  test.setTimeout(180_000);
  await appInit(page);

  // read Account A's current cloud set to pick a genuinely new word
  await signIn(page, A!);
  await page.goto('/vocabulary', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const existing = await vocab(page);
  mergedWord = CANDIDATE_WORDS.find((w) => !existing.includes(w)) ?? '';
  expect(mergedWord, 'candidate word list exhausted — extend CANDIDATE_WORDS').toBeTruthy();
  await signOut(page);

  // guest saves the candidate on the sample transcript
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /try without login/i }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('link', { name: /study/i }).first().click();
  await page.waitForSelector('[data-transcript-line]:visible', { timeout: 45_000 });
  await page.waitForTimeout(3000);
  const row = page.locator('[data-transcript-line]:visible', { hasText: mergedWord }).first();
  await row.getByRole('button', { name: `Look up ${mergedWord}`, exact: true }).first().click();
  await page.waitForTimeout(4000);
  const saveBtn = page.getByRole('button', { name: /add to vocab/i }).first();
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  await page.waitForTimeout(2000);
  // the app stores the lemmatized base form ("leaving" -> "leave"); capture the
  // actual stored word and use it for the cross-scenario assertions
  const savedNow = await vocab(page);
  expect(savedNow.length).toBeGreaterThan(0);
  fixtureWord = savedNow.includes(mergedWord) ? mergedWord : savedNow.find((w) => mergedWord.startsWith(w.slice(0, 4))) ?? savedNow[0];

  // sign in: the guest item must reach the verified account via the real merge
  await signIn(page, A!);
  await page.goto('/vocabulary', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  expect(await vocab(page)).toContain(fixtureWord);
});

test('E2: a fresh browser context recovers the merged word from the real cloud', async ({ page }) => {
  test.setTimeout(180_000);
  await appInit(page);
  await signIn(page, A!);
  await page.goto('/vocabulary', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // fresh context storage starts empty, so this word can only come from Firestore
  expect(await vocab(page)).toContain(fixtureWord);
});

test('E3: real logout boundary — A clears, B never sees A-only items', async ({ page }) => {
  test.setTimeout(180_000);
  await appInit(page);

  // A logs out: real sign-out clears device-scoped data
  await signIn(page, A!);
  await signOut(page);
  expect(await page.evaluate(() => localStorage.getItem('echolearn_vocabulary'))).toBeNull();

  // B signs in on the same device: A-only items must not appear
  await signIn(page, B!);
  await page.goto('/vocabulary', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  expect(await vocab(page)).not.toContain(fixtureWord);
  await signOut(page);
});
