import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadAsmrExperience } from './helpers/asmr-discovery';

test('one explorer opens all families by default and ASMR browse resets stale filters', async ({ page }) => {
  await page.goto('/');
  await page.locator('#explore-presets').click();
  await expect(page.locator('.explore-card')).toHaveCount(91);
  await page.locator('#preset-category').selectOption('ASMR');
  await expect(page.locator('.explore-card')).toHaveCount(61);
  await expect(page.locator('#preset-results')).not.toContainText('Hz');
  await page.locator('#preset-search').fill('temple');
  await page.locator('#preset-with-visuals').check();
  await page.locator('#preset-favorites').check();
  await page.locator('#close-explorer').click();
  await page.locator('#explore-presets').click();
  await expect(page.locator('#preset-category')).toHaveValue('all');
  await expect(page.locator('#preset-search')).toHaveValue('');
  await expect(page.locator('#preset-with-visuals')).not.toBeChecked();
  await expect(page.locator('#preset-favorites')).not.toBeChecked();
  await expect(page.locator('.explore-card')).toHaveCount(91);
  await page.locator('#preset-search').fill('missing');
  await page.locator('#close-explorer').click();
  await page.locator('#asmr-browse').click();
  await expect(page.locator('#preset-category')).toHaveValue('ASMR');
  await expect(page.locator('#preset-search')).toHaveValue('');
  await expect(page.locator('.explore-card')).toHaveCount(61);
  await expect(page.locator('#preset-explorer')).toHaveCount(1);
  await expect(page.locator('#asmr-preset, #asmr-search, #asmr-library-list')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('shared discovery searches source descriptions and loads complete ASMR with optional soft lights silently', async ({ page }) => {
  await page.goto('/'); await page.locator('#asmr-browse').click();
  await page.locator('#preset-search').fill('blankets');
  await expect(page.locator('.explore-card')).toHaveCount(7);
  await expect(page.locator('.explore-card h3').filter({ hasText: 'Soft cloth cocoon' })).toHaveCount(1);
  await page.locator('#preset-search').fill('  LEFT  attention ');
  await expect(page.locator('.explore-card h3')).toHaveText(['Left ear attention', 'Left soft attention', 'Temple brushing']);
  await page.locator('#preset-search').fill('200');
  await expect(page.locator('.explore-card')).toHaveCount(0);
  await page.locator('#preset-search').fill('cloth cocoon');
  await page.locator('#preset-with-visuals').check();
  await expect(page.locator('.explore-card')).toHaveCount(1);
  await page.locator('[data-load-preset="asmr-cloth-cocoon"]').click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.locator('#preset-explorer')).not.toBeVisible();
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-cloth');
  await expect(page.locator('#trigger-preset')).toHaveValue('custom');
  await expect(page.locator('#trigger-seed')).toHaveValue('73');
  await expect(page.locator('#trigger-brightness')).toHaveValue('0.3');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ambient')).toHaveValue('none');
});

test('legacy ASMR favorites migrate without losing unknown IDs and global favorites synchronize tabs', async ({ page, context }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('favorites-fixture')) {
      localStorage.setItem('binaural:asmr-favorites:v1', '["left-ear-focus","future-mix"]');
      localStorage.setItem('favorites-fixture', 'true');
    }
  });
  await page.goto('/'); await page.locator('#explore-presets').click();
  await page.locator('#preset-favorites').check();
  await expect(page.locator('.explore-card h3')).toHaveText('Left ear attention');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('binaural:explore-favorites:v1')!))).toEqual(['asmr-left-ear-focus', 'asmr-future-mix']);
  const other = await context.newPage(); await other.goto('/');
  await page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true }).focus();
  await other.evaluate(() => localStorage.setItem('binaural:explore-favorites:v1', '["asmr-left-ear-focus","asmr-cloth-cocoon","future-preset"]'));
  await expect(page.locator('.explore-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Favorite: Left ear attention', exact: true }).click();
  await expect(page.locator('.explore-card h3')).toHaveText('Soft cloth cocoon');
  await expect(page.locator('#preset-favorites')).toBeFocused();
  await page.getByRole('button', { name: 'Favorite: Soft cloth cocoon', exact: true }).click();
  await expect(page.locator('.explore-card')).toHaveCount(0);
  await page.reload(); await page.locator('#explore-presets').click(); await page.locator('#preset-favorites').check();
  await expect(page.locator('.explore-card')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('binaural:asmr-favorites:v1')!))).toEqual(['left-ear-focus', 'future-mix']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('binaural:explore-favorites:v1')!))).toEqual(['future-preset']);
});

test('global favorites remain usable for this tab when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.goto('/'); await page.locator('#asmr-browse').click();
  await page.getByRole('button', { name: 'Favorite: Warm ear cups', exact: true }).click();
  await expect(page.locator('#preset-favorite-status')).toContainText('kept for this tab');
  await page.locator('#preset-favorites').check();
  await expect(page.locator('.explore-card h3')).toHaveText('Warm ear cups');
  await page.locator('#close-explorer').click(); await page.locator('#explore-presets').click();
  await page.locator('#preset-favorites').check();
  await expect(page.locator('.explore-card h3')).toHaveText('Warm ear cups');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('shared ASMR discovery fits small screens and remains accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.locator('#asmr-browse').click();
    await expect(page.locator('#preset-search')).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#preset-explorer').analyze()).violations).toEqual([]);
    await page.locator('#close-explorer').click();
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});

test('main explorer retains complete ASMR duration and settings through save and share without restoring consent', async ({ page }) => {
  await page.goto('/');
  await loadAsmrExperience(page, 'temple-brushing');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.locator('#playing-title')).toHaveText('Temple brushing');
  await expect(page.locator('.asmr-layer')).toHaveCount(2);
  await page.locator('#save-preset').click(); await page.reload(); await page.locator('.saved-preset').click();
  await page.locator('.asmr-advanced').first().locator('summary').click();
  await expect(page.getByLabel('Sound 1 direction', { exact: true })).toHaveValue('-65');
  await expect(page.getByLabel('Sound 1 height', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('Sound 1 distance', { exact: true })).toHaveValue('0.4');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await loadAsmrExperience(page, 'hairbrush-unhurried');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  const actual = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    return readSharedSession(new URL(link).hash);
  }, link);
  expect(actual.minutes).toBe(45);
  expect(actual.asmr.layers[0].sound).toBe('recorded-hair');
  expect(actual.asmr.variation.mode).toBe('natural');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('close attention and object experiences load complete mixes from the shared explorer', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-experiences.ts', { asmrExperiences } = await import(path);
    return asmrExperiences.map((preset: { id: string; name: string; make: () => unknown }) => ({ id: preset.id, name: preset.name, settings: preset.make() }));
  });
  expect(recipes).toHaveLength(12);
  for (const recipe of recipes) {
    await loadAsmrExperience(page, recipe.id);
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const link = await page.getByLabel('Session link', { exact: true }).inputValue();
    const actual = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, link);
    const canonical = (value: unknown) => (value as { layers: { id: string }[] }).layers.map(({ id: _id, ...layer }) => layer);
    expect(actual.mode).toBe('asmr'); expect(canonical(actual.asmr)).toEqual(canonical(recipe.settings));
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
  }
});

test('every ASMR recipe adapts to a complete validated shared experience with its paired visual', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const adapterPath = '/src/asmr-explorer.ts', presetPath = '/src/asmr-presets.ts', modelPath = '/src/model.ts';
    const { asmrExplorerPresets } = await import(adapterPath), { asmrPresets } = await import(presetPath), { parseSession } = await import(modelPath);
    return asmrExplorerPresets().map((entry: { id: string; visualLabel?: string; session: { minutes: number; asmr: { layers: { id: string }[] }; visual: { triggers: { brightness: number; speed: number; drift: number; lightSpeed: number; reaction: number } } } }, index: number) => {
      const source = asmrPresets[index], validated = parseSession(entry.session);
      const canonical = (value: { layers: { id: string }[] }) => value.layers.map(({ id: _id, ...layer }) => layer);
      return { id: entry.id, duration: entry.session.minutes === (source.minutes ?? 20),
        mix: JSON.stringify(canonical(validated.asmr)) === JSON.stringify(canonical(source.make())),
        hasVisual: !!entry.visualLabel && validated.visual?.scene === 'triggers',
        soft: entry.session.visual.triggers.brightness === .3 && entry.session.visual.triggers.speed <= .015 && entry.session.visual.triggers.drift <= .06 && entry.session.visual.triggers.lightSpeed <= .05 && entry.session.visual.triggers.reaction <= .2 };
    });
  });
  expect(result).toHaveLength(61);
  expect(new Set(result.map((entry: { id: string }) => entry.id)).size).toBe(61);
  expect(result.every((entry: { duration: boolean; mix: boolean; hasVisual: boolean; soft: boolean }) => entry.duration && entry.mix && entry.hasVisual && entry.soft)).toBe(true);
});

test('ASMR Load and play starts audio only after that explicit action and motion consent can be declined', async ({ page }) => {
  await page.goto('/'); await page.locator('#asmr-browse').click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('.asmr-layer')).toHaveCount(0);
  await page.locator('[data-play-preset="asmr-brush-in-front"]').click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('all eight spatial paired experiences load silently and preserve complete saved and shared settings', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-spatial-experiences.ts', { asmrSpatialExperiences } = await import(path);
    return asmrSpatialExperiences.map((recipe: { id: string; name: string; minutes: number; make: () => unknown }) =>
      ({ id: recipe.id, name: recipe.name, minutes: recipe.minutes, settings: recipe.make() }));
  });
  expect(recipes).toHaveLength(8);
  expect(recipes.map((recipe: { minutes: number }) => recipe.minutes)).toEqual([30, 20, 30, 45, 30, 20, 45, 30]);
  expect(recipes.map((recipe: { settings: { layers: { spatial?: { motion: string } }[] } }) => recipe.settings.layers[0].spatial?.motion))
    .toEqual(['sweep', 'approach', 'rise', 'figure-eight', 'orbit', 'sweep', undefined, undefined]);
  for (const recipe of recipes) {
    await page.locator('#asmr-browse').click();
    const favorite = page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true });
    await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
    await page.locator('#preset-name').fill(recipe.name);
    await page.locator('#save-preset').click(); await page.reload();
    await page.locator('.saved-preset').filter({ hasText: recipe.name }).click();
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const link = await page.getByLabel('Session link', { exact: true }).inputValue();
    const shared = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, link);
    const canonical = (value: { layers: { id: string }[] }) => value.layers.map(({ id: _id, ...layer }) => layer);
    expect(shared.mode, recipe.id).toBe('asmr'); expect(shared.minutes, recipe.id).toBe(recipe.minutes);
    expect(canonical(shared.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(shared.asmr.variation, recipe.id).toEqual(recipe.settings.variation);
    expect(shared.visual.triggers.brightness, recipe.id).toBe(.3);
    expect(shared.visual.triggers, recipe.id).not.toHaveProperty('enabled');
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
  }
});
