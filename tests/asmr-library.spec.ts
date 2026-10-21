import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setSources } from './helpers/listening-sources';

test('ASMR library searches sources, filters all recipes and loads silently with optional lights', async ({ page }) => {
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
  await expect(page.locator('.asmr-library-card')).toHaveCount(40);
  for (const [group, count] of [['Ear focus', 5], ['Recorded textures', 5], ['Layered mixes', 6], ['Sensory textures', 12], ['Personal attention', 6], ['Object study', 6]] as const) {
    await page.locator('#asmr-filter').selectOption(group);
    await expect(page.locator('.asmr-library-card')).toHaveCount(count);
  }
  await page.locator('#asmr-filter').selectOption('all');
  await page.locator('#asmr-search').fill('blankets');
  await expect(page.locator('.asmr-library-card')).toHaveCount(5);
  await expect(page.locator('[data-asmrlibrary="cloth-cocoon"] h3')).toHaveText('Soft cloth cocoon');
  await page.getByRole('button', { name: 'Load sounds: Soft cloth cocoon', exact: true }).click();
  await expect(page.locator('#asmr-preset')).toHaveValue('cloth-cocoon');
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-cloth');
  await page.getByRole('button', { name: 'Load sounds + lights: Soft cloth cocoon', exact: true }).click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.locator('#trigger-preset')).toHaveValue('custom');
  await expect(page.locator('#trigger-seed')).toHaveValue('73');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#asmr-search').fill('  LEFT  attention ');
  await expect(page.locator('.asmr-library-card h3')).toHaveText(['Left ear attention', 'Left soft attention', 'Temple brushing']);
  await page.locator('#asmr-search').fill('nothing matches this');
  await expect(page.locator('#asmr-results')).toContainText('No mixes found');
});

test('ASMR favorites persist separately, synchronize tabs and tolerate blocked storage', async ({ page, context }) => {
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
  await page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true }).click();
  await page.reload(); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
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
  await page.reload(); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
  await page.getByRole('button', { name: 'Favorite: Warm ear cups', exact: true }).click();
  await expect(page.locator('#asmr-status')).toContainText('kept for this tab');
  await page.locator('#asmr-filter').selectOption('favorites');
  await expect(page.locator('.asmr-library-card h3')).toHaveText('Warm ear cups');
});

test('expanded ASMR library fits small screens and remains accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});

test('main explorer finds all ASMR experiences without showing dormant tone settings', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Explore all presets', exact: true }).click();
  await page.locator('#preset-category').selectOption('ASMR');
  await expect(page.locator('.explore-card')).toHaveCount(40);
  await expect(page.locator('#preset-results')).not.toContainText('Hz');
  await page.locator('#preset-search').fill('temple');
  await expect(page.locator('.explore-card h3')).toHaveText('Temple brushing');
  await page.locator('#preset-search').fill('200');
  await expect(page.locator('.explore-card')).toHaveCount(0);
  await page.locator('#preset-search').fill('');
  await page.locator('#preset-with-visuals').check();
  await expect(page.locator('.explore-card')).toHaveCount(0);
  await page.locator('#preset-with-visuals').uncheck();
  await page.locator('[data-load-preset="asmr-temple-brushing"]').click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#playing-title')).toHaveText('Temple brushing');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ambient')).toHaveValue('none');
  await expect(page.locator('.asmr-layer')).toHaveCount(2);
  await page.locator('#save-preset').click(); await page.reload(); await page.locator('.saved-preset').click();
  await page.locator('.asmr-advanced').first().locator('summary').click();
  await expect(page.getByLabel('Sound 1 direction', { exact: true })).toHaveValue('-65');
  await expect(page.getByLabel('Sound 1 height', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('Sound 1 distance', { exact: true })).toHaveValue('0.4');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('new close attention and object experiences load complete mixes from the main explorer', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-experiences.ts', { asmrExperiences } = await import(path);
    return asmrExperiences.map((preset: { id: string; name: string; make: () => unknown }) => ({ id: preset.id, name: preset.name, settings: preset.make() }));
  });
  expect(recipes).toHaveLength(12);
  for (const recipe of recipes) {
    await page.getByRole('button', { name: 'Explore all presets', exact: true }).click();
    await page.locator('#preset-category').selectOption('ASMR');
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const link = await page.getByLabel('Session link', { exact: true }).inputValue();
    const actual = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, link);
    const canonical = (value: unknown) => (value as { layers: { id: string }[] }).layers.map(({ id: _id, ...layer }) => layer);
    expect(actual.mode).toBe('asmr');
    expect(canonical(actual.asmr)).toEqual(canonical(recipe.settings));
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
  }
});
