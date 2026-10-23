import { expect, test, type Page } from '@playwright/test';
import type { AsmrPreset } from '../src/asmr-presets';
import type { AsmrSettings } from '../src/asmr-state';

const ids = ['hands-in-soft-light', 'hairbrush-at-each-ear', 'zipper-and-page-study',
  'pencil-lines-after-dark', 'mist-across-the-light', 'metal-points-in-the-dark'];
const canonical = (settings: AsmrSettings) => ({ ...settings, focus: settings.focus ?? false,
  layers: settings.layers.map(({ id: _id, ...layer }) => layer) });

async function shared(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  const session = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    return readSharedSession(new URL(link).hash);
  }, link);
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  return { link, session };
}

test('six recorded gesture recipes retain explicit sources, slow contrasting turns and paired lights', async ({ page }) => {
  await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-recorded-gesture-presets.ts', { asmrRecordedGesturePresets } = await import(path);
    return asmrRecordedGesturePresets.map((recipe: AsmrPreset) => ({ id: recipe.id, light: recipe.light, settings: recipe.make() }));
  });
  expect(recipes.map((recipe: { id: string }) => recipe.id)).toEqual(ids);
  expect(recipes.map((recipe: { light: string }) => recipe.light)).toEqual([
    'gesture-follow', 'gesture-ear', 'gesture-inspect', 'gesture-trace', 'gesture-drop', 'gesture-tap',
  ]);
  expect(recipes.map((recipe: { settings: AsmrSettings }) => recipe.settings.layers.map(layer => layer.sound))).toEqual([
    ['recorded-hands'], ['recorded-hair', 'recorded-hair'], ['recorded-zipper', 'recorded-sketchbook'],
    ['recorded-sketching'], ['recorded-mist'], ['recorded-metal'],
  ]);
  for (const { settings } of recipes as { settings: AsmrSettings }[]) {
    expect(settings.level).toBe(.5); expect(settings.variation!.seed).toBeGreaterThan(0);
    expect(settings.variation!.mode).toMatch(/^(natural|turns)$/);
    expect(settings.variation!.phraseSeconds).toBeGreaterThanOrEqual(8);
    for (const layer of settings.layers) expect(layer.rate).toBeLessThanOrEqual(.95);
    if (settings.variation!.mode === 'turns') {
      expect(settings.variation!.turnSeconds).toBe(90); expect(settings.layers).toHaveLength(2);
      expect(settings.layers[0].pan).toBeLessThan(-.5); expect(settings.layers[1].pan).toBeGreaterThan(.5);
    }
  }
  const hair = recipes[1].settings as AsmrSettings;
  expect(hair.layers[0].rate).toBeLessThan(hair.layers[1].rate);
  expect(recipes.flatMap((recipe: { settings: AsmrSettings }) => recipe.settings.layers).filter((layer: { spatial?: unknown }) => layer.spatial)).toHaveLength(1);
});

test('every recorded gesture is discoverable and preserves duration, flow and lights through save, share and import', async ({ page }) => {
  test.setTimeout(120000); await page.goto('/');
  const recipes = await page.evaluate(async () => {
    const path = '/src/asmr-recorded-gesture-presets.ts', { asmrRecordedGesturePresets } = await import(path);
    return asmrRecordedGesturePresets.map((recipe: AsmrPreset) => ({ id: recipe.id, name: recipe.name,
      minutes: recipe.minutes, group: recipe.group, settings: recipe.make() }));
  });
  expect(recipes.map((recipe: { minutes: number }) => recipe.minutes)).toEqual([20, 30, 30, 60, 20, 45]);
  for (const recipe of recipes as { id: string; name: string; minutes: number; group: string; settings: AsmrSettings }[]) {
    expect(recipe.group).toBe('Recorded gestures');
    await page.locator('#asmr-browse').click(); await page.locator('#preset-search').fill('Recorded gestures');
    await expect(page.locator('.explore-card')).toHaveCount(6);
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name);
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    await expect(page.locator('#trigger-enable')).toBeChecked();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    const { link, session } = await shared(page);
    expect(session.mode).toBe('asmr'); expect(session.minutes).toBe(recipe.minutes);
    expect(canonical(session.asmr)).toEqual(canonical(recipe.settings));
    expect(session.visual.triggers.brightness).toBe(.3);
    expect(session.visual.triggers.syncAsmr).toBe(true);
    expect(session.visual.triggers).not.toHaveProperty('enabled');
    await page.locator('#preset-name').fill(recipe.name); await page.locator('#save-preset').click();
    const saved = await page.evaluate(name => JSON.parse(localStorage.getItem('binaural.presets.v1')!)
      .find((entry: { name: string }) => entry.name === name), recipe.name);
    expect(canonical(saved.asmr)).toEqual(canonical(recipe.settings));
    await page.reload(); await page.locator('.saved-preset').filter({ hasText: recipe.name }).click();
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    expect(canonical((await shared(page)).session.asmr)).toEqual(canonical(recipe.settings));
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.locator('#notice')).toContainText('Shared session loaded');
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    const loaded = (await shared(page)).session;
    expect(canonical(loaded.asmr)).toEqual(canonical(recipe.settings)); expect(loaded.visual).toEqual(session.visual);
    if (await page.locator('#asmr-mixer').getAttribute('open') === null) await page.locator('#asmr-mixer > summary').click();
    await page.locator('#asmr-level').evaluate((element: HTMLInputElement) => {
      element.value = '0.11'; element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#asmr-level')).toHaveValue('0.11');
    await page.locator('#import-file').setInputFiles({ name: `${recipe.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await expect(page.locator('#asmr-level')).toHaveValue('0.5');
    const imported = (await shared(page)).session;
    expect(canonical(imported.asmr)).toEqual(canonical(recipe.settings)); expect(imported.visual).toEqual(session.visual);
    await expect(page.locator('#trigger-enable')).not.toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
});
