import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setSources } from './helpers/listening-sources';

async function range(input: Locator, value: string) {
  await input.focus();
  await input.evaluate((element: HTMLInputElement, next) => {
    element.value = next; element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

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

test('quick sounds stay available with ASMR off and focus an existing sound without duplication or autoplay', async ({ page }) => {
  await page.goto('/');
  const quick = page.getByRole('group', { name: 'Quick ASMR sounds', exact: true });
  await expect(quick.getByRole('button')).toHaveText(['Brush', 'Tapping', 'Fabric', 'Crinkle', 'Air', 'Water', 'Hair', 'Writing']);
  await expect(page.locator('#asmr-mixer')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('group', { name: 'Starter experiences', exact: true }).getByRole('button')).toHaveCount(6);
  await expect(page.locator('#asmr-browse')).toBeVisible();
  await expect(page.locator('#asmr-preset, #asmr-search, #asmr-library-list')).toHaveCount(0);
  await quick.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.asmr-layer')).toHaveCount(1);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toBeFocused();
  await quick.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(page.locator('.asmr-layer')).toHaveCount(1);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toBeFocused();
  await setSources(page, 'binaural');
  await expect(page.locator('#asmr-mixer')).not.toHaveAttribute('open', '');
  await expect(quick).toBeVisible();
  await quick.getByRole('button', { name: 'Brush', exact: true }).click();
  const { session } = await shared(page);
  expect(session.mode).toBe('mixed');
  expect(session.asmr.layers).toHaveLength(1);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('simple placements serialize correctly and keep advanced sound edits through a shared-link round trip', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('.asmr-advanced summary').click();
  for (const [label, value] of [['sound pace', '.73'], ['tone', '.31'], ['travel width', '.42'], ['alternate sides (advanced)', '180']]) {
    await range(page.getByLabel(`Sound 1 ${label}`, { exact: true }), value);
    await expect(page.getByLabel(`Sound 1 ${label}`, { exact: true })).toBeFocused();
  }
  await page.locator('.asmr-advanced summary').click();
  const placement = page.getByRole('group', { name: 'Sound 1 placement', exact: true });
  for (const [label, pan] of [['Left ear', -1], ['Center', 0], ['Right ear', 1]] as const) {
    await placement.getByRole('button', { name: label, exact: true }).click();
    await expect(placement.getByRole('button', { name: label, exact: true })).toBeFocused();
    const { session } = await shared(page);
    expect(session.asmr.layers[0]).toMatchObject({ pan, motion: 'still', rate: .73, tone: .31, width: .42, pressurePhase: 180 });
  }
  await placement.getByRole('button', { name: 'Move slowly', exact: true }).click();
  await placement.getByRole('button', { name: 'Cupping', exact: true }).click();
  const { session, link } = await shared(page);
  expect(session.asmr.layers[0]).toMatchObject({ pan: 0, motion: 'sweep', period: 18, pressure: .8, pressurePhase: 180, rate: .73, tone: .31, width: .42 });
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Cupping', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Move slowly', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.asmr-advanced summary').click();
  await expect(page.getByLabel('Sound 1 alternate sides (advanced)', { exact: true })).toHaveValue('180');
  await expect(page.getByLabel('Sound 1 sound pace', { exact: true })).toHaveValue('0.73');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('placement shortcuts preserve 3D height and distance while advanced controls stay open and focused', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=fabric]').click();
  await page.locator('.asmr-advanced summary').click();
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  await expect(page.getByLabel('Sound 1 sound space', { exact: true })).toBeFocused();
  await expect(page.locator('.asmr-advanced')).toHaveAttribute('open', '');
  await range(page.getByLabel('Sound 1 height', { exact: true }), '25');
  await range(page.getByLabel('Sound 1 distance', { exact: true }), '1.2');
  const placement = page.getByRole('group', { name: 'Sound 1 placement', exact: true });
  await placement.getByRole('button', { name: 'Left ear', exact: true }).click();
  await expect(page.getByLabel('Sound 1 direction', { exact: true })).toHaveValue('-90');
  await placement.getByRole('button', { name: 'Move slowly', exact: true }).click();
  const { session } = await shared(page);
  expect(session.asmr.layers[0].spatial).toEqual({ azimuth: -90, elevation: 25, distance: 1.2, motion: 'orbit' });
});

test('six-sound limit disables additions and duplicates while existing quick sounds remain focusable', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('.asmr-advanced summary').click();
  for (let count = 1; count < 6; count++) await page.getByRole('button', { name: 'Duplicate sound 1', exact: true }).click();
  await expect(page.locator('.asmr-layer')).toHaveCount(6);
  await expect(page.locator('#asmr-add')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Duplicate sound 1', exact: true })).toBeDisabled();
  await expect(page.locator('[data-asmr-sound=fabric]')).toBeDisabled();
  await page.locator('[data-asmr-sound=brush]').click();
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toBeFocused();
  await expect(page.locator('.asmr-layer')).toHaveCount(6);
  await page.getByRole('button', { name: 'Remove sound 6', exact: true }).click();
  await page.locator('[data-asmr-sound=fabric]').click();
  await expect(page.getByLabel('Sound 6 trigger', { exact: true })).toHaveValue('fabric');
  await expect(page.getByLabel('Sound 6 trigger', { exact: true })).toBeFocused();
  expect((await shared(page)).session.asmr.layers).toHaveLength(6);
});

test('starter experiences use the existing mixes and the compact and expanded workspace fit 320px in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  const starters = page.getByRole('group', { name: 'Starter experiences', exact: true });
  for (const id of ['hands-close', 'slow-ear-sweep', 'woven-hush', 'soft-crinkle-room', 'fingertip-duet', 'ear-cupping']) {
    await starters.locator(`[data-asmr-preset="${id}"]`).click();
    const { session } = await shared(page);
    const expected = await page.evaluate(async id => {
      const path = '/src/asmr-presets.ts', { asmrPresets } = await import(path);
      return asmrPresets.find((preset: { id: string }) => preset.id === id).make();
    }, id);
    expect(session.asmr.level).toBe(expected.level);
    expect(session.asmr.layers.map(({ id: _id, ...layer }: { id: string }) => layer)).toEqual(expected.layers.map(({ id: _id, ...layer }: { id: string }) => layer));
  }
  await page.locator('#asmr-browse').click();
  await expect(page.locator('#preset-category')).toHaveValue('ASMR');
  await expect(page.locator('.explore-card')).toHaveCount(73);
  await page.locator('#close-explorer').click();
  await page.locator('.asmr-advanced').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
