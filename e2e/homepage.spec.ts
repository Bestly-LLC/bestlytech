import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/bestly/i);
  await expect(page.locator('body')).toBeVisible();
});

test('homepage has navigation', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav, header');
  await expect(nav.first()).toBeVisible();
});
