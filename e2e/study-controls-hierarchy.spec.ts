import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * STUDY_CONTROLS_HIERARCHY_V1 — deterministic browser validation.
 *
 * Runs against the bundled sample transcript (no YouTube/Bilibili/AI/ASR/Worker
 * traffic). It pins the two things the milestone must not break:
 *
 *   1. the high-frequency playback-speed control stays one interaction away;
 *   2. timer / CEFR level / reload-transcript move out of the transcript's
 *      visual field into the secondary menu while keeping their behaviour.
 *
 * The guest `/api/ai` boundary is asserted explicitly: no AI call is made.
 */

const DICTIONARY_FIXTURE = {
  ipa_uk: '/ɡʊd/',
  ipa_us: '/ɡʊd/',
  audio_url: '',
  base_form: 'good',
  source: 'free-dictionary',
  entries: [{
    pos: 'adjective',
    definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
  }],
};

async function openStudyWithSampleTranscript(page: Page) {
  let aiCalls = 0;
  await page.route('**/api/dictionary*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DICTIONARY_FIXTURE) });
  });
  await page.route('**/api/ai**', async (route) => {
    aiCalls += 1;
    await route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study$/);
  await expect(
    page.getByText('good', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  return { aiCalls: () => aiCalls };
}

test.describe('Study control hierarchy — desktop 1280x720', () => {
  test('speed stays one click away; timer/level/reload move to secondary menu', async ({ page }) => {
    const { aiCalls } = await openStudyWithSampleTranscript(page);

    // ── AC2: playback speed is reachable in a single interaction ──
    const speedSlider = page.locator('input[type="range"]').first();
    await expect(speedSlider).toBeVisible();
    await page.getByRole('button', { name: '1.25x', exact: true }).click();
    await expect(speedSlider).toHaveValue('1.25');

    // ── AC1/3/4/5: session-level + recovery controls are no longer first-level ──
    await expect(page.getByLabel('Custom minutes (1-180)')).toHaveCount(0);
    await expect(page.getByLabel('Minimum CEFR level')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload transcript' })).toHaveCount(0);

    // ── Open the secondary menu and use every control that moved ──
    const toggle = page.getByTestId('study-settings-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = page.getByTestId('study-settings-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Study settings' })).toBeVisible();

    await page.getByRole('button', { name: '30 min' }).click();
    await expect(page.getByRole('button', { name: '30 min' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Minimum CEFR level').selectOption('A2');
    await expect(page.getByLabel('Minimum CEFR level')).toHaveValue('A2');

    // ── AC9: Escape closes and returns focus to the trigger ──
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'study-settings-toggle',
    );

    // ── AC3: the running timer stays visible on the first screen even though
    // its configuration moved into the menu, and it still cancels ──
    const timerCancel = page.getByRole('button', { name: 'Cancel' });
    await expect(timerCancel).toBeVisible();
    await timerCancel.click();
    await expect(timerCancel).toHaveCount(0);

    // ── AC6: the learning flow still works after using the menu ──
    await page.getByText('good', { exact: true }).filter({ visible: true }).first().click();
    const saveButton = page.locator('#tour-transcript-save-word');
    await expect(saveButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('study-replay-context')).toBeVisible();
    await saveButton.click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' })).toBeVisible();
    await expect(saveButton).toBeHidden({ timeout: 45_000 });

    // ── AC8: guest AI boundary unchanged — no provider traffic ──
    expect(aiCalls()).toBe(0);
  });
});

test.describe('Study control hierarchy — mobile 390x844', () => {
  test('no horizontal overflow and the learning flow stays reachable', async ({ page }) => {
    // Resize at runtime rather than through a per-describe context option: the
    // phone-width smoke only needs the CSS breakpoints, not touch emulation.
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudyWithSampleTranscript(page);

    const overflow = async () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

    // ── AC7: no horizontal overflow on the first screen ──
    const initial = await overflow();
    expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 1);

    // ── AC7: the secondary menu opens inside the viewport ──
    await page.getByTestId('study-settings-toggle').click();
    const panel = page.getByTestId('study-settings-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
    const withPanel = await overflow();
    expect(withPanel.scrollWidth).toBeLessThanOrEqual(withPanel.clientWidth + 1);

    // ── AC7: closing restores the learning surface, speed still reachable ──
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByText('good', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '0.75x', exact: true }).click();
    await expect(page.locator('input[type="range"]').first()).toHaveValue('0.75');
  });
});
