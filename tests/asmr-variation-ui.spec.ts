import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

test('variation is optional, changes only selected sounds and keeps its settings through undo and sharing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#asmr-flow')).toHaveValue('steady');
  await expect(page.locator('#asmr-variation-settings')).toBeHidden();
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/audio/asmr/')) requests.push(request.url()); });
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-flow').selectOption('natural');
  await page.locator('#asmr-variation-settings > summary').click();
  await page.locator('#asmr-variation-amount').fill('0.72');
  await page.locator('#asmr-phrase-seconds').fill('20');
  await page.locator('#asmr-variation-seed').fill('9281');
  await expect(page.locator('#asmr-variation-seed')).toBeFocused();
  const before = await shared(page);
  expect(before.session.asmr.variation).toEqual({ mode: 'natural', seed: 9281, amount: .72, phraseSeconds: 20, turnSeconds: 90 });
  expect(before.session.asmr.layers.map((layer: { sound: string }) => layer.sound)).toEqual(['brush']);
  await page.locator('#asmr-new-variation').click();
  const changed = await page.locator('#asmr-variation-seed').inputValue();
  expect(changed).not.toBe('9281');
  await page.locator('#undo-edit').click();
  await expect(page.locator('#asmr-variation-seed')).toHaveValue('9281');
  await page.locator('#asmr-flow').selectOption('turns');
  await page.locator('#asmr-turn-seconds').fill('180');
  await page.locator('#asmr-flow').selectOption('steady');
  await expect(page.locator('#asmr-variation-settings')).toBeHidden();
  await page.locator('#asmr-flow').selectOption('turns');
  await expect(page.locator('#asmr-turn-seconds')).toHaveValue('180');
  const { link, session } = await shared(page);
  expect(session.asmr.variation).toMatchObject({ mode: 'turns', seed: 9281, amount: .72, phraseSeconds: 20, turnSeconds: 180 });
  expect(requests).toEqual([]);
  await page.goto('about:blank'); await page.goto(link);
  await expect(page.locator('#asmr-flow')).toHaveValue('turns');
  await page.locator('#asmr-variation-settings > summary').click();
  await expect(page.locator('#asmr-variation-seed')).toHaveValue('9281');
  await expect(page.locator('#asmr-turn-seconds')).toHaveValue('180');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('all six long routines load their complete duration and repeatable flow from Explore', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/');
  const recipes = [
    ['pages-evening', '30', 'natural'], ['hairbrush-unhurried', '45', 'natural'], ['water-preparation', '30', 'natural'],
    ['pencil-notes', '45', 'natural'], ['unhurried-salon', '60', 'turns'], ['quiet-desk-journey', '60', 'turns'],
  ];
  for (const [id, minutes, mode] of recipes) {
    await page.locator('#explore-presets').click(); await page.locator('#preset-category').selectOption('ASMR');
    await page.locator(`[data-load-preset="asmr-${id}"]`).click();
    await expect(page.locator('#minutes')).toHaveValue(minutes);
    await expect(page.locator('#asmr-flow')).toHaveValue(mode);
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    const { session } = await shared(page);
    expect(session.mode).toBe('asmr'); expect(session.asmr.variation.turnSeconds).toBe(180);
    expect(session.asmr.layers.length).toBeGreaterThan(0); expect(session.asmr.layers.length).toBeLessThanOrEqual(3);
    expect(session.asmr.layers.some((layer: { sound: string }) => /^recorded-(pages|hair|spray|writing)$/.test(layer.sound))).toBe(true);
  }
  await page.locator('#save-preset').click(); await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.locator('#minutes')).toHaveValue('60');
  await expect(page.locator('#asmr-flow')).toHaveValue('turns');
  const { session } = await shared(page);
  expect(session.asmr.variation).toEqual({ mode: 'turns', seed: 7717, amount: .55, phraseSeconds: 16, turnSeconds: 180 });
  expect(session.asmr.layers.map((layer: { sound: string }) => layer.sound)).toEqual(['recorded-writing', 'recorded-pages', 'wood']);
});

test('cleared and invalid seed edits preserve the last valid serializable session', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-flow').selectOption('natural'); await page.locator('#asmr-variation-settings > summary').click();
  const seed = page.locator('#asmr-variation-seed'); await seed.fill('9281');
  for (const value of ['', '0', '-1', '1.5', '2147483648']) {
    await seed.fill(value);
    const { session } = await shared(page);
    expect(session.asmr.variation.seed).toBe(9281);
    await expect(seed).toHaveValue('9281');
  }
  await page.locator('#save-preset').click(); await page.reload(); await page.locator('.saved-preset').click();
  const { session } = await shared(page); expect(session.asmr.variation.seed).toBe(9281);
});

test('natural flow remains selected for ordinary mixes and new recordings stay available individually', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-flow').selectOption('natural');
  await page.locator('[data-asmr-preset=hands-close]').click();
  await expect(page.locator('#asmr-flow')).toHaveValue('natural');
  await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption('recorded-writing');
  for (const value of ['recorded-pages', 'recorded-hair', 'recorded-spray', 'recorded-writing']) {
    await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption(value);
    await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue(value);
    await expect(page.locator('#asmr-flow')).toHaveValue('natural');
  }
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('variation controls fit a small screen and remain accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click(); await page.locator('#asmr-flow').selectOption('turns');
  await page.locator('#asmr-variation-settings > summary').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
