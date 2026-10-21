import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setSources } from './helpers/listening-sources';
import { loadAsmrExperience } from './helpers/asmr-discovery';

async function adjust(page: Page, index = 0) {
  const details = page.locator('.asmr-advanced').nth(index);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}

async function range(input: Locator, value: string) {
  await input.focus();
  await input.evaluate((element: HTMLInputElement, next) => { element.value = next; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

async function sharedMix(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  const session = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    return readSharedSession(new URL(link).hash);
  }, link);
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  return { link, session };
}

test('3D controls retain stereo settings and save, share and undo complete positions without autoplay', async ({ page }) => {
  await page.goto('/'); await setSources(page, 'asmr'); await adjust(page);
  await range(page.getByLabel('Sound 1 left / right', { exact: true }), '.4');
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  await expect(page.getByLabel('Sound 1 direction', { exact: true })).toHaveValue('36');
  await expect(page.getByLabel('Sound 1 left / right', { exact: true })).toHaveCount(0);
  await range(page.getByLabel('Sound 1 direction', { exact: true }), '-45');
  await range(page.getByLabel('Sound 1 distance', { exact: true }), '1.25');
  await page.getByLabel('Sound 1 3D movement', { exact: true }).selectOption('orbit');
  await range(page.getByLabel('Sound 1 height', { exact: true }), '30');
  await page.locator('#preset-name').fill('Around my chair'); await page.locator('#save-preset').click();
  await expect(page.locator('#notice')).toContainText('saved');
  const { link, session } = await sharedMix(page);
  expect(session.asmr.layers[0].pan).toBe(.4);
  expect(session.asmr.layers[0].spatial).toEqual({ azimuth: -45, elevation: 30, distance: 1.25, motion: 'orbit' });
  await page.getByLabel('Sound 1 sound space', { exact: true }).focus();
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('stereo');
  await expect(page.getByLabel('Sound 1 left / right', { exact: true })).toHaveValue('0.4');
  await expect(page.getByLabel('Sound 1 movement', { exact: true })).toHaveValue('sweep');
  await page.locator('#undo-edit').click();
  await adjust(page);
  await expect(page.getByLabel('Sound 1 sound space', { exact: true })).toHaveValue('hrtf');
  await expect(page.getByLabel('Sound 1 direction', { exact: true })).toHaveValue('-45');
  await page.reload(); await page.locator('[data-saved]').click();
  await adjust(page);
  await expect(page.getByLabel('Sound 1 distance', { exact: true })).toHaveValue('1.25');
  await expect(page.getByLabel('Sound 1 height', { exact: true })).toHaveValue('30');
  await page.goto(link);
  await adjust(page);
  await expect(page.getByLabel('Sound 1 3D movement', { exact: true })).toHaveValue('orbit');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
});

test('duplicated 3D sounds keep independent positions through subsequent edits and serialization', async ({ page }) => {
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-clear').click(); await page.locator('#asmr-add').click();
  await adjust(page);
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  await page.getByRole('button', { name: 'Duplicate sound 1', exact: true }).click();
  await range(page.getByLabel('Sound 1 direction', { exact: true }), '-80');
  await page.locator('.asmr-advanced summary').nth(1).click();
  await range(page.getByLabel('Sound 2 height', { exact: true }), '15');
  const { session } = await sharedMix(page);
  expect(session.asmr.layers.map((layer: { spatial: unknown }) => layer.spatial)).toEqual([
    { azimuth: -80, elevation: 0, distance: .6, motion: 'still' },
    { azimuth: 0, elevation: 15, distance: .6, motion: 'still' },
  ]);
  await setSources(page, 'mixed');
  await expect(page.getByLabel('Sound 2 direction', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Sound 1 height', { exact: true })).toHaveValue('0');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('3D controls fit 320px screens and remain accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  await setSources(page, 'asmr');
  await loadAsmrExperience(page, 'around-your-head');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await page.locator('.asmr-advanced').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
