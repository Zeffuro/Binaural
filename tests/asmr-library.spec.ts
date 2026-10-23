import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadAsmrExperience } from './helpers/asmr-discovery';

test('one explorer opens all families by default and ASMR browse resets stale filters', async ({ page }) => {
  await page.goto('/');
  await page.locator('#explore-presets').click();
  await expect(page.locator('.explore-card')).toHaveCount(103);
  await page.locator('#preset-category').selectOption('ASMR');
  await expect(page.locator('.explore-card')).toHaveCount(73);
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
  await expect(page.locator('.explore-card')).toHaveCount(103);
  await page.locator('#preset-search').fill('missing');
  await page.locator('#close-explorer').click();
  await page.locator('#asmr-browse').click();
  await expect(page.locator('#preset-category')).toHaveValue('ASMR');
  await expect(page.locator('#preset-search')).toHaveValue('');
  await expect(page.locator('.explore-card')).toHaveCount(73);
  await expect(page.locator('#preset-explorer')).toHaveCount(1);
  await expect(page.locator('#asmr-preset, #asmr-search, #asmr-library-list')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('shared discovery searches source descriptions and loads complete ASMR with optional soft lights silently', async ({ page }) => {
  await page.goto('/'); await page.locator('#asmr-browse').click();
  await page.locator('#preset-search').fill('blankets');
  await expect(page.locator('.explore-card')).toHaveCount(8);
  await expect(page.locator('.explore-card h3').filter({ hasText: 'Soft cloth cocoon' })).toHaveCount(1);
  await expect(page.locator('.explore-card h3').filter({ hasText: 'Linen room' })).toHaveCount(1);
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
  expect(result).toHaveLength(73);
  expect(new Set(result.map((entry: { id: string }) => entry.id)).size).toBe(73);
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

test('all six small detail experiences retain favorites and complete mixes across save, reload and share without consent', async ({ page }) => {
  test.setTimeout(120000); await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-detail-experiences.ts', { asmrDetailExperiences } = await import(path);
    return asmrDetailExperiences.map((recipe: { id: string; name: string; minutes: number; make: () => unknown }) =>
      ({ id: recipe.id, name: recipe.name, minutes: recipe.minutes, settings: recipe.make() }));
  });
  expect(recipes).toHaveLength(6);
  expect(recipes.map((recipe: { minutes: number }) => recipe.minutes)).toEqual([20, 30, 45, 60, 20, 30]);
  const canonical = (value: { layers: { id: string }[]; focus?: boolean }) =>
    ({ ...value, focus: value.focus ?? false, layers: value.layers.map(({ id: _id, ...layer }) => layer) });
  for (const recipe of recipes) {
    expect(recipe.settings.level, recipe.id).toBe(.45);
    expect(recipe.settings.layers.length, recipe.id).toBeLessThanOrEqual(2);
    expect(recipe.settings.variation.mode, recipe.id).toMatch(/^(natural|turns)$/);
    await page.locator('#asmr-browse').click();
    const favorite = page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true });
    await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await loadAsmrExperience(page, recipe.id);
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.locator('#trigger-enable')).toBeChecked();
    await page.locator('#preset-name').fill(recipe.name); await page.locator('#save-preset').click();
    await page.reload(); await page.locator('#asmr-browse').click();
    await expect(page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#close-explorer').click();
    await page.locator('.saved-preset').filter({ hasText: recipe.name }).click();
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const link = await page.getByLabel('Session link', { exact: true }).inputValue();
    const saved = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, link);
    expect(saved.mode, recipe.id).toBe('asmr'); expect(saved.minutes, recipe.id).toBe(recipe.minutes);
    expect(canonical(saved.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(saved.visual.triggers.brightness, recipe.id).toBe(.3);
    expect(saved.visual.triggers.speed, recipe.id).toBeLessThanOrEqual(.015);
    expect(saved.visual.triggers.reaction, recipe.id).toBeLessThanOrEqual(.2);
    expect(saved.visual.triggers, recipe.id).not.toHaveProperty('enabled');
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.locator('#notice')).toContainText('Shared session loaded');
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const importedLink = await page.getByLabel('Session link', { exact: true }).inputValue();
    const imported = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, importedLink);
    expect(canonical(imported.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(imported.visual, recipe.id).toEqual(saved.visual);
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
  }
});

test('all six quiet rooms preserve complete space mixes through favorites, save, share and JSON import without consent', async ({ page }) => {
  test.setTimeout(120000); await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-space-experiences.ts', { asmrSpaceExperiences } = await import(path);
    return asmrSpaceExperiences.map((recipe: { id: string; name: string; minutes: number; make: () => unknown }) =>
      ({ id: recipe.id, name: recipe.name, minutes: recipe.minutes, settings: recipe.make() }));
  });
  expect(recipes.map((recipe: { id: string }) => recipe.id)).toEqual([
    'reading-alcove', 'little-wooden-workshop', 'linen-room', 'water-on-the-table', 'rain-stick-corner', 'after-hours-writing',
  ]);
  expect(recipes.map((recipe: { minutes: number }) => recipe.minutes)).toEqual([30, 20, 45, 30, 60, 45]);
  const canonical = (value: { layers: { id: string }[]; focus?: boolean }) =>
    ({ ...value, focus: value.focus ?? false, layers: value.layers.map(({ id: _id, ...layer }) => layer) });
  for (const recipe of recipes) {
    expect(recipe.settings.level, recipe.id).toBe(.45);
    expect(recipe.settings.space.amount, recipe.id).toBeGreaterThanOrEqual(.08);
    expect(recipe.settings.space.amount, recipe.id).toBeLessThanOrEqual(.24);
    expect(recipe.settings.layers.length, recipe.id).toBeGreaterThanOrEqual(1);
    expect(recipe.settings.layers.length, recipe.id).toBeLessThanOrEqual(2);
    expect(recipe.settings.variation.mode, recipe.id).toMatch(/^(natural|turns)$/);
    expect(recipe.settings.variation.phraseSeconds, recipe.id).toBeGreaterThanOrEqual(15);
    expect(recipe.settings.variation.phraseSeconds, recipe.id).toBeLessThanOrEqual(25);
    expect(recipe.settings.variation.turnSeconds, recipe.id).toBeGreaterThanOrEqual(120);
    expect(recipe.settings.variation.turnSeconds, recipe.id).toBeLessThanOrEqual(180);
    await page.locator('#asmr-browse').click();
    const favorite = page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true });
    await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await loadAsmrExperience(page, recipe.id);
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.locator('#trigger-enable')).toBeChecked();
    await page.locator('#preset-name').fill(recipe.name); await page.locator('#save-preset').click();
    const json = await page.evaluate(name => JSON.parse(localStorage.getItem('binaural.presets.v1')!).find((saved: { name: string }) => saved.name === name), recipe.name);
    expect(canonical(json.asmr), recipe.id).toEqual(canonical(recipe.settings));
    await page.reload(); await page.locator('#asmr-browse').click();
    await expect(page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#close-explorer').click();
    await page.locator('.saved-preset').filter({ hasText: recipe.name }).click();
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const link = await page.getByLabel('Session link', { exact: true }).inputValue();
    const shared = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, link);
    expect(shared.mode, recipe.id).toBe('asmr'); expect(shared.minutes, recipe.id).toBe(recipe.minutes);
    expect(canonical(shared.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(shared.visual.triggers.brightness, recipe.id).toBe(.3);
    expect(shared.visual.triggers.speed, recipe.id).toBeLessThanOrEqual(.015);
    expect(shared.visual.triggers.reaction, recipe.id).toBeLessThanOrEqual(.2);
    expect(shared.visual.triggers, recipe.id).not.toHaveProperty('enabled');
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.locator('#notice')).toContainText('Shared session loaded');
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const reloadedLink = await page.getByLabel('Session link', { exact: true }).inputValue();
    const reloaded = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, reloadedLink);
    expect(canonical(reloaded.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(reloaded.visual, recipe.id).toEqual(shared.visual);
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
    await page.locator('#asmr-level').fill('0.11');
    await page.locator('#asmr-listening-space').selectOption('dry');
    await expect(page.locator('#asmr-listening-space')).toHaveValue('dry');
    await page.locator('#import-file').setInputFiles({ name: `${recipe.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await expect(page.locator('#import-file')).toHaveValue('');
    await expect(page.locator('#asmr-level')).toHaveValue('0.45');
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.locator('#share-session').click();
    const importedLink = await page.getByLabel('Session link', { exact: true }).inputValue();
    const imported = await page.evaluate(async link => {
      const path = '/src/share.ts', { readSharedSession } = await import(path);
      return readSharedSession(new URL(link).hash);
    }, importedLink);
    expect(canonical(imported.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(imported.visual, recipe.id).toEqual(shared.visual);
    await page.getByRole('button', { name: 'Close share', exact: true }).click();
  }
});
