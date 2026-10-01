import { test, expect } from '@playwright/test';

test('fresh guest can skip language choice without an automatic tour', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without login', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();

  await expect(page.getByRole('link', { name: 'Study', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start studying', exact: true })).toBeVisible();
  await expect(page.locator('.driver-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start studying', exact: true }).click();
  await expect(page).toHaveURL(/\/study$/);
});

test('fresh guest language choice does not reopen after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Try without login', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  // The tour auto-starts after the choice (FTUE restored).
  await expect(page.locator('.driver-popover-title')).toBeVisible({ timeout: 10_000 });
  // Reload mid-tour: the chooser must not reopen, and the incomplete tour
  // legitimately starts again — dismiss it and verify it stays gone.
  await page.reload();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveCount(0);
  await expect(page.locator('.driver-popover-title')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.driver-popover')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Study', exact: true }).first()).toBeVisible();
});
