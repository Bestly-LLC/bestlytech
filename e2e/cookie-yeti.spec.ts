import { test, expect } from '@playwright/test';

test('cookie-yeti page loads', async ({ page }) => {
  await page.goto('/cookie-yeti');
  await expect(page.locator('body')).toBeVisible();
});
