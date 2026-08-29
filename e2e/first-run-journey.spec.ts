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
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without login', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Study', exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Study', exact: true }).first()).toBeVisible();
  await expect(page.locator('.driver-overlay')).toHaveCount(0);
});
