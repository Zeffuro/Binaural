import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('ASMR library searches sources, filters all recipes and loads silently with optional lights', async ({ page }) => {
  await page.goto('/'); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.getByText('Explore ASMR mixes', { exact: true }).click();
  await expect(page.locator('.asmr-library-card')).toHaveCount(28);
  for (const [group, count] of [['Ear focus', 5], ['Recorded textures', 5], ['Layered mixes', 6], ['Sensory textures', 12]] as const) {
    await page.locator('#asmr-filter').selectOption(group);
    await expect(page.locator('.asmr-library-card')).toHaveCount(count);
  }
  await page.locator('#asmr-filter').selectOption('all');
  await page.locator('#asmr-search').fill('blankets');
  await expect(page.locator('.asmr-library-card')).toHaveCount(4);
  await expect(page.locator('[data-asmrlibrary="cloth-cocoon"] h3')).toHaveText('Soft cloth cocoon');
  await page.getByRole('button', { name: 'Load sounds: Soft cloth cocoon', exact: true }).click();
  await expect(page.locator('#asmr-preset')).toHaveValue('cloth-cocoon');
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-cloth');
  await page.getByRole('button', { name: 'Load sounds + lights: Soft cloth cocoon', exact: true }).click();
  await expect(page.locator('#trigger-preset')).toHaveValue('rose-glass');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#asmr-search').fill('  LEFT  attention ');
  await expect(page.locator('.asmr-library-card h3')).toHaveText(['Left ear attention', 'Left soft attention']);
  await page.locator('#asmr-search').fill('nothing matches this');
  await expect(page.locator('#asmr-results')).toContainText('No mixes found');
});

test('ASMR favorites persist separately, synchronize tabs and tolerate blocked storage', async ({ page, context }) => {
  await page.goto('/'); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.getByText('Explore ASMR mixes', { exact: true }).click();
  await page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true }).click();
  await page.reload(); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.getByText('Explore ASMR mixes', { exact: true }).click();
  await page.locator('#asmr-filter').selectOption('favorites');
  await expect(page.locator('.asmr-library-card h3')).toHaveText('Left ear attention');
  const other = await context.newPage(); await other.goto('/');
  await page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true }).focus();
  await other.evaluate(() => localStorage.setItem('binaural:asmr-favorites:v1', '["left-ear-focus","cloth-cocoon","unknown"]'));
  await expect(page.locator('.asmr-library-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true })).toBeFocused();
  await other.evaluate(() => localStorage.setItem('binaural:asmr-favorites:v1', '["cloth-cocoon","unknown"]'));
  await expect(page.locator('.asmr-library-card h3')).toHaveText('Soft cloth cocoon');
  await expect(page.locator('#asmr-filter')).toBeFocused();
  await page.getByRole('button', { name: 'Favorite: Soft cloth cocoon', exact: true }).click();
  await expect(page.locator('.asmr-library-card')).toHaveCount(0);
  await expect(page.locator('#asmr-filter')).toBeFocused();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.reload(); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.getByText('Explore ASMR mixes', { exact: true }).click();
  await page.getByRole('button', { name: 'Favorite: Warm ear cups', exact: true }).click();
  await expect(page.locator('#asmr-status')).toContainText('kept for this tab');
  await page.locator('#asmr-filter').selectOption('favorites');
  await expect(page.locator('.asmr-library-card h3')).toHaveText('Warm ear cups');
});

test('expanded ASMR library fits small screens and remains accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/'); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.getByText('Explore ASMR mixes', { exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
