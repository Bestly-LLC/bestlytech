import { test, expect } from '@playwright/test';

test('cloud landing page loads', async ({ page }) => {
  await page.goto('/cloud');
  await expect(page.locator('body')).toBeVisible();
  // Cloud page should have pricing/CTA content
  const content = await page.textContent('body');
  expect(content).toBeTruthy();
});
