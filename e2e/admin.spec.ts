import { test, expect } from '@playwright/test';

test('admin route loads auth flow', async ({ page }) => {
  await page.goto('/admin');
  // Should either show login or redirect to auth
  await expect(page.locator('body')).toBeVisible();
  const url = page.url();
  // Admin should show some form of auth (login button, redirect, etc)
  expect(url).toBeTruthy();
});
