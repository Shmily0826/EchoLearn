import { test, expect, type Locator, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * P6 — REVIEW BEHAVIORAL TEST: the spaced-repetition schedule must be honest
 * in the UI the learner actually sees, not just in helper return values.
 *
 * Defects pinned by this file:
 *  1. A manually added word used to be stored with `nextReviewAt: 0`, which the
 *     Vocabulary card rendered as "Mastered" (before `isUnscheduled` existed) and
 *     which never became due — the item was silently outside the schedule forever
 *     while looking finished. `handleDictAddWord` now stores `tomorrowMs()`.
 *  2. Review, Dashboard and the session-completion screen each carried their own
 *     "due" predicate, so three screens could show three different numbers for the
 *     same library. All of them now derive from `utils/reviewSchedule`
 *     (`isDue` / `selectDueCards` / `collectReviewCards`), so this file asserts
 *     count-vs-count parity AND count-vs-queue parity (the queue actually served
 *     by the flashcard UI, read off its own `x / N` progress affordance).
 *  3. The old "Review All Unmastered (N)" button counted unmastered items but its
 *     queue contained every card, mastered ones included. It is now
 *     "Review Every Saved Item (N)" and N must equal the served queue length.
 *  4. Legacy rows (`nextReviewAt: 0`, never reviewed) must read "Not scheduled"
 *     and must never be swept into a due queue — that is what the `> 0` guard in
 *     `isDue` is for. Falsification (ii) in the task brief removes that guard:
 *     because count and queue share one helper they stay mutually consistent, so
 *     the assertions that must go red are the concrete numbers (3 / 6) and the
 *     identity of the cards a session serves.
 *
 * The Vocabulary/Sentences header "N due" + "Review (N)" counts are asserted too:
 * they were the fourth predicate (computed locally as `!mastered && nextReviewAt
 * <= now`, which both dropped mastered refreshers and counted the legacy
 * `nextReviewAt: 0` row) and now share `utils/reviewSchedule` with every other due
 * number on the screen.
 *
 * Every external route is aborted except the loopback dev server; `/api/dictionary`
 * is mocked and `/api/ai`, `/api/translate`, the client-side Free Dictionary and
 * Datamuse fallbacks never reach a provider. No step is desktop-only: navigation
 * goes through the visible nav link, which exists in both the desktop header and
 * the mobile bottom bar, so all of this runs under desktop-chromium,
 * mobile-chromium and mobile-webkit unchanged.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKUP_WORD = 'umbrella';

// ─── App entry ────────────────────────────────────────────────

/**
 * Boot the app as a fresh guest. `seed` is written to localStorage *before* the
 * app first reads it, so the fixture is in place for the initial render.
 *
 * The init script re-runs on every navigation (Playwright guarantee), so a
 * sessionStorage sentinel keeps it from resurrecting the fixture after a session
 * has legitimately mutated it — later steps navigate with link clicks instead of
 * `page.goto`.
 */
async function enterApp(page: Page, seed?: { vocabulary: unknown[]; sentences: unknown[] }) {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('echolearn-e2e-review-campaign-seeded')) return;
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    if (data) {
      localStorage.setItem('echolearn_vocabulary', JSON.stringify(data.vocabulary));
      localStorage.setItem('echolearn_sentences', JSON.stringify(data.sentences));
    }
    sessionStorage.setItem('echolearn-e2e-review-campaign-seeded', '1');
  }, seed ?? null);
  await page.goto('/');
  await enterGuestMode(page);
}

/** Local-only network policy: mock the dictionary, abort anything that leaves the box. */
async function isolateNetwork(page: Page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return route.continue();
    return route.abort();
  });
  // Payload shape mirrors `mockDictionaryApi` in e2e/dictionary-semantics.spec.ts.
  await page.route('**/api/dictionary*', (route) => {
    const target = new URL(route.request().url()).searchParams.get('target') ?? '';
    const translated = target.toLowerCase().startsWith('en');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '/ʌmˈbɛlə/',
        ipa_us: '/ʌmˈbɛlə/',
        audio_url: '',
        base_form: LOOKUP_WORD,
        source: 'merriam-webster',
        lemma_provenance: 'provider-confirmed',
        entries: [{
          pos: 'noun',
          definitions: [{
            display_order: 0,
            definitions_json: {
              definition: translated ? 'E2E_SENSE a folding rain cover' : 'E2E_SENSE 雨伞',
              source_text: 'E2E_SENSE a folding rain cover',
            },
          }],
        }],
      }),
    });
  });
  await page.route('**/api/ai**', (route) => route.abort());
  await page.route('**/api/translate**', (route) => route.abort());
  await page.route('**/api/transcript**', (route) => route.abort());
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
  await page.route('https://api.datamuse.com/**', (route) => route.abort());
}

// ─── Locators / readers ───────────────────────────────────────

const NAV: Record<'/' | '/vocabulary' | '/review', string> = {
  '/': 'Dashboard',
  '/vocabulary': 'Vocabulary',
  '/review': 'Review',
};

/** Navigate the way a learner does: the visible nav link, by name. */
async function goTo(page: Page, route: keyof typeof NAV) {
  await page.getByRole('link', { name: NAV[route], exact: true })
    .filter({ visible: true }).first().click();
  await expect(page).toHaveURL(route === '/' ? /\/$/ : new RegExp(`\\${route}$`));
}

/** The number a Review landing stat card displays, read from its label's sibling. */
async function landingStat(page: Page, label: string): Promise<string> {
  const value = page.getByText(label, { exact: true }).filter({ visible: true }).first()
    .locator('xpath=preceding-sibling::p[1]');
  await expect(value).toBeVisible();
  return (await value.innerText()).trim();
}

/** The count a start/continue button renders next to its label (last number). */
async function buttonCount(button: Locator): Promise<number> {
  const text = (await button.innerText()).replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d+)(?!.*\d)/);
  expect(match, `button should render its count: "${text}"`).not.toBeNull();
  return Number(match?.[1]);
}

/** Dashboard exposes its Today's Review number in the card's accessible name. */
async function dashboardReviewCount(page: Page): Promise<number> {
  const card = page.getByRole('button', { name: /^Today's Review/ }).filter({ visible: true }).first();
  await expect(card).toBeVisible();
  const name = (await card.getAttribute('aria-label')) ?? '';
  const match = name.match(/(\d+)\s*$/);
  expect(match, `dashboard card should expose its count: "${name}"`).not.toBeNull();
  return Number(match?.[1]);
}

/** Which seeded card is on screen right now, by its visible headline text. */
async function visibleCardLabel(page: Page, labels: string[]): Promise<string | null> {
  for (const label of labels) {
    if (await page.getByText(label, { exact: true }).filter({ visible: true }).count()) return label;
  }
  return null;
}

/**
 * Walk a running session card by card through the flashcard UI (reveal → judge
 * for a word card, Next for a sentence card) and return the labels of the cards
 * that were actually served, in order. `expectedTotal` is the number the UI
 * advertised; every step pins the session's own `x / N` progress affordance, so a
 * queue whose length disagrees with that number cannot pass.
 */
async function playSession(page: Page, expectedTotal: number, labels: string[]): Promise<string[]> {
  const served: string[] = [];
  const progress = page.getByText(/^\d+ \/ \d+$/).filter({ visible: true }).first();
  for (let step = 0; step < expectedTotal; step += 1) {
    await expect(progress, `card ${step + 1} of ${expectedTotal} should be on screen`)
      .toHaveText(new RegExp(`^${step + 1} / ${expectedTotal}$`), { timeout: 10_000 });

    const label = await visibleCardLabel(page, labels);
    expect(label, `served card ${step + 1} should be one of the seeded items`).not.toBeNull();
    served.push(label as string);

    const reveal = page.getByRole('button', { name: /Show Answer/ }).filter({ visible: true });
    const isWordCard = (await reveal.count()) > 0;
    if (isWordCard) await reveal.first().click();
    await page.getByRole('button', { name: isWordCard ? /^Remember/ : /^Next/ })
      .filter({ visible: true }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Session Complete!' })).toBeVisible({ timeout: 10_000 });
  return served;
}

/** One Vocabulary card, by the word it shows. */
function vocabCard(page: Page, word: string): Locator {
  return page.locator('div.grid > div').filter({ visible: true }).filter({ hasText: word }).first();
}

// ─── Tests ────────────────────────────────────────────────────

test.describe('review schedule campaign', () => {
  test('manually added word is scheduled, counted honestly, and advanced by a session', async ({ page }) => {
    test.setTimeout(180_000);
    await isolateNetwork(page);
    await enterApp(page);

    // Vocabulary: add a word through the visible search → lookup → save UI.
    await goTo(page, '/vocabulary');
    await page.getByPlaceholder('Search word / meaning...').fill(LOOKUP_WORD);
    await expect(page.getByText(`No saved word matches "${LOOKUP_WORD}"`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Look up', exact: true }).click();

    const popup = page.locator('[data-dictionary-popup]').filter({ visible: true }).first();
    await expect(popup.getByText('E2E_SENSE a folding rain cover').first())
      .toBeVisible({ timeout: 20_000 }); // the mocked dictionary really loaded
    await page.getByRole('button', { name: 'Add to vocabulary' }).click();

    // The saved card must read as scheduled, never as finished work. This is the
    // assertion that goes red if `handleDictAddWord` stores `nextReviewAt: 0`
    // again (the label then reads "Not scheduled" instead of "Due tomorrow").
    const card = vocabCard(page, LOOKUP_WORD);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('Due tomorrow', { exact: true })).toHaveCount(1);
    await expect(card.getByText(/^mastered$/i)).toHaveCount(0);
    await expect(card.getByText('0/5', { exact: true })).toBeVisible();
    await expect(page.getByText(/1 words.*0 mastered/).first()).toBeVisible();

    // Dashboard: a word due tomorrow is not due today.
    await goTo(page, '/');
    expect(await dashboardReviewCount(page)).toBe(0);

    // Review landing: the same zero, and the due session is offered as disabled.
    await goTo(page, '/review');
    const dueButton = page.getByRole('button', { name: /Review Due Today/ }).filter({ visible: true }).first();
    const allButton = page.getByRole('button', { name: /Review Every Saved Item/ }).filter({ visible: true }).first();
    expect(await landingStat(page, 'Due Today')).toBe('0');
    expect(await buttonCount(dueButton)).toBe(0);
    await expect(dueButton).toBeDisabled();
    const advertisedAll = await buttonCount(allButton);
    expect(advertisedAll).toBe(1);

    // Play the queue the landing button advertises.
    await allButton.click();
    const served = await playSession(page, advertisedAll, [LOOKUP_WORD]);
    expect(new Set(served).size).toBe(advertisedAll);

    // Completion actions must describe the post-session library, not a stale one:
    // nothing is due, one item is saved, so there is no "continue due" offer.
    expect(await landingStat(page, 'Reviewed')).toBe('1');
    expect(await landingStat(page, 'Accuracy')).toBe('100%');
    expect(await landingStat(page, 'To Review Again')).toBe('0');
    await expect(page.getByText(/No items due right now.*1 saved items in total/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue Review/ }).filter({ visible: true })).toHaveCount(0);
    const continueAll = page.getByRole('button', { name: /Review every saved item \(1\)/ })
      .filter({ visible: true });
    await expect(continueAll).toHaveCount(1);

    // Back to Vocabulary through the completion screen's own action.
    await page.getByRole('button', { name: 'Vocabulary', exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/vocabulary$/);
    const reviewed = vocabCard(page, LOOKUP_WORD);
    await expect(reviewed.getByText('Due in 3d', { exact: true })).toHaveCount(1);
    await expect(reviewed.getByText(/^mastered$/i)).toHaveCount(0);
    await expect(reviewed.getByText('1/5', { exact: true })).toBeVisible();
  });

  test('displayed due counts match the queues the UI builds for a controlled library', async ({ page }) => {
    test.setTimeout(180_000);

    // Timestamps derived from one real `Date.now()`. The fixture is midnight-safe
    // by construction: "due" rows sit a day in the PAST (always <= the current
    // day's window end) and "future" rows are 3+ days out (always > it). The one
    // caveat that can only bite within microseconds of local midnight belongs to
    // the first test, where `tomorrowMs()` = now + 24h vs the window end
    // todayStart + 24h: they tie only if the app reads the item exactly at
    // midnight, and a tie means "due today", which is the honest reading anyway.
    const now = Date.now();
    const word = (
      id: string,
      label: string,
      mastered: boolean,
      reviewCount: number,
      nextReviewAt: number,
    ) => ({
      id,
      word: label,
      meaningCn: `seed meaning for ${label}`,
      context: `Seed context sentence for ${label}.`,
      definitionEn: `Seed definition of ${label}.`,
      sourceVideoId: 'seed-video',
      addedAt: now - 7 * DAY_MS,
      mastered,
      reviewCount,
      lastReviewedAt: mastered ? now - 20 * DAY_MS : 0,
      nextReviewAt,
    });
    const vocabulary = [
      word('v_due_unmastered', 'alpha_due', false, 0, now - DAY_MS),
      word('v_future_unmastered', 'bravo_later', false, 1, now + 3 * DAY_MS),
      word('v_due_mastered', 'charlie_refresher', true, 5, now - DAY_MS),
      word('v_future_mastered', 'delta_refresherlater', true, 5, now + 90 * DAY_MS),
      word('v_legacy_unscheduled', 'echo_legacy', false, 0, 0),
    ];
    const sentences = [{
      id: 's_due',
      text: 'Foxtrot is scheduled for today',
      meaningCn: 'seed sentence meaning',
      sourceVideoId: 'seed-video',
      startTime: 0,
      addedAt: now - 7 * DAY_MS,
      myOwnSentence: '',
      mastered: false,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: now - DAY_MS,
    }];
    const DUE = ['alpha_due', 'charlie_refresher', 'Foxtrot is scheduled for today'];
    const ALL = [...DUE, 'bravo_later', 'delta_refresherlater', 'echo_legacy'];

    await isolateNetwork(page);
    await enterApp(page, { vocabulary, sentences });

    // Vocabulary renders the schedule as words: due now, future, mastered,
    // mastered, and exactly one "Not scheduled" legacy row.
    await goTo(page, '/vocabulary');
    await expect(vocabCard(page, 'alpha_due').getByText('Due now', { exact: true })).toHaveCount(1);
    await expect(vocabCard(page, 'bravo_later').getByText('Due in 3d', { exact: true })).toHaveCount(1);
    await expect(vocabCard(page, 'charlie_refresher').getByText('Mastered', { exact: true })).toHaveCount(1);
    await expect(vocabCard(page, 'delta_refresherlater').getByText('Mastered', { exact: true })).toHaveCount(1);
    const legacyCard = vocabCard(page, 'echo_legacy');
    await expect(legacyCard.getByText('Not scheduled', { exact: true })).toHaveCount(1);
    await expect(legacyCard.getByText(/^mastered$/i)).toHaveCount(0);
    await expect(page.getByText('Not scheduled', { exact: true }).filter({ visible: true })).toHaveCount(1);

    // The header's own due count is the number the shared predicate produces.
    // Scope of this assertion, stated honestly: this fixture makes the OLD local
    // predicate (`!mastered && nextReviewAt <= now`) come out at 2 as well — it
    // drops charlie_refresher and adds echo_legacy, so the two errors cancel. The
    // set difference is pinned instead by the due-session identities below (which
    // must be exactly the two scheduled-due cards plus the sentence, never the
    // legacy row). What this number DOES catch is a one-sided regression: any
    // single change to the shared predicate — dropping the `> 0` guard (3), or
    // excluding mastered refreshers (1) — reddens it here as well as in the queue.
    const reviewShortcut = page.getByRole('button', { name: /review \(\d+\)/i }).filter({ visible: true }).first();
    await expect(reviewShortcut).toBeVisible();
    expect((await reviewShortcut.innerText()).match(/\d+/)?.[0]).toBe('2');
    await expect(page.getByText(/2 due/i).first()).toBeVisible();

    // Dashboard and Review agree, because they share one predicate.
    await goTo(page, '/');
    const dashboardDue = await dashboardReviewCount(page);
    expect(dashboardDue).toBe(3); // 2 past-dated words + 1 past-dated sentence

    await goTo(page, '/review');
    const reviewDue = await landingStat(page, 'Due Today');
    expect(reviewDue).toBe('3');
    expect(reviewDue).toBe(String(dashboardDue));
    // The breakdown is the proof that the mastered refresher counts and the
    // legacy row does not: without the `> 0` guard in `isDue` this becomes 3W.
    await expect(page.getByText('2W / 1S', { exact: true })).toBeVisible();
    // 3 unmastered words + 1 unmastered sentence; 2 mastered items.
    const unmasteredStat = Number(await landingStat(page, 'Unmastered'));
    expect(unmasteredStat).toBe(4);
    expect(await landingStat(page, 'Mastered')).toBe('2');

    const dueButton = page.getByRole('button', { name: /Review Due Today/ }).filter({ visible: true }).first();
    const allButton = page.getByRole('button', { name: /Review Every Saved Item/ }).filter({ visible: true }).first();
    const advertisedDue = await buttonCount(dueButton);
    const advertisedAll = await buttonCount(allButton);
    expect(advertisedDue).toBe(3);
    expect(advertisedAll).toBe(6);
    // Guard for defect 3: the all-queue count is the whole library (6), not the
    // unmastered subset (4) that the old "Review All Unmastered (N)" label showed
    // while its queue still served every card, mastered ones included.
    expect(advertisedAll).toBeGreaterThan(unmasteredStat);

    // Due session: the number of cards served == the number displayed.
    await dueButton.click();
    const dueServed = await playSession(page, advertisedDue, ALL);
    expect(dueServed).toHaveLength(advertisedDue);
    expect([...dueServed].sort()).toEqual([...DUE].sort());

    // Completion screen restates the post-session library from the same helper.
    expect(await landingStat(page, 'Reviewed')).toBe('3');
    expect(await landingStat(page, 'To Review Again')).toBe('0');
    await expect(page.getByText(/No items due right now.*6 saved items in total/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue Review/ }).filter({ visible: true })).toHaveCount(0);

    // All-items session: same proof on the bigger queue, and the legacy row is
    // reached only here — never through the due queue above.
    const continueAll = page.getByRole('button', { name: /Review every saved item \(6\)/ })
      .filter({ visible: true });
    await expect(continueAll).toHaveCount(1);
    const advertisedAllAgain = await buttonCount(continueAll.first());
    expect(advertisedAllAgain).toBe(advertisedAll);
    await continueAll.first().click();
    const allServed = await playSession(page, advertisedAllAgain, ALL);
    expect(allServed).toHaveLength(advertisedAllAgain);
    expect([...allServed].sort()).toEqual([...ALL].sort());
    expect(await landingStat(page, 'Reviewed')).toBe('6');

    // Reviewing the unscheduled legacy item schedules it instead of leaving it
    // outside the system, and a mastered refresher stays mastered.
    await goTo(page, '/vocabulary');
    const reviewedLegacy = vocabCard(page, 'echo_legacy');
    await expect(reviewedLegacy.getByText('Due in 3d', { exact: true })).toHaveCount(1);
    await expect(reviewedLegacy.getByText('Not scheduled', { exact: true })).toHaveCount(0);
    await expect(vocabCard(page, 'charlie_refresher').getByText('Mastered', { exact: true })).toHaveCount(1);
  });
});
