import { test, expect } from '@playwright/test';

test('development never installs or caches the Vite app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Find your own');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).some(name => name.startsWith('binaural-offline:')))).toBe(false);
  await expect(page.locator('.offline-tools')).toHaveCount(0);
});
