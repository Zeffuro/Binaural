import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function adjust(page: Page) {
  const details = page.locator('.asmr-advanced').first();
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}

async function share(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  const session = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    const value = readSharedSession(new URL(link).hash);
    return { ...value, layers: value.layers.map(({ id: _id, ...layer }: { id: string }) => layer),
      asmr: { ...value.asmr, layers: value.asmr.layers.map(({ id: _id, ...layer }: { id: string }) => layer) } };
  }, link);
  return { link, session };
}

test('headphone profiles default to the browser, preserve positions and support undo without loading audio', async ({ page }) => {
  const loads: string[] = [];
  page.on('request', request => { if (request.url().includes('/audio/hrtf/')) loads.push(request.url()); });
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click(); await adjust(page);
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  const select = page.getByLabel('Sound 1 headphone profile', { exact: true });
  await expect(select).toHaveValue('native');
  const before = (await share(page)).session;
  expect(before.asmr.layers[0].spatial).not.toHaveProperty('profile');
  await select.focus(); await select.selectOption('sadie-d1'); await expect(select).toBeFocused();
  const selected = (await share(page)).session;
  expect(selected.asmr.layers[0].spatial).toEqual({ ...before.asmr.layers[0].spatial, profile: 'sadie-d1' });
  expect(selected.asmr.layers[0].pan).toBe(before.asmr.layers[0].pan);
  await page.locator('#undo-edit').click(); await adjust(page); await expect(select).toHaveValue('native');
  await select.selectOption('sadie-h10'); await select.selectOption('native');
  expect((await share(page)).session.asmr.layers[0].spatial).not.toHaveProperty('profile');
  await expect(page.locator('#status')).toHaveText('Ready when you are'); expect(loads).toEqual([]);
  await page.getByLabel('Boost to 200%', { exact: true }).check();
  await expect(page.locator('#master')).toHaveAttribute('max', '2');
});

test('both headphone profiles round-trip through saved presets, links and JSON while rejecting invalid profiles', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click(); await adjust(page);
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  for (const profile of ['sadie-d1', 'sadie-h10']) {
    await adjust(page); await page.getByLabel('Sound 1 headphone profile', { exact: true }).selectOption(profile);
    const name = `Headphone ${profile}`;
    await page.locator('#preset-name').fill(name); await page.locator('#save-preset').click();
    await page.reload(); await page.locator('.saved-preset').filter({ hasText: name }).click();
    await adjust(page); await expect(page.getByLabel('Sound 1 headphone profile', { exact: true })).toHaveValue(profile);
    const { link, session } = await share(page);
    await page.goto('about:blank'); await page.goto(link); await expect(page.locator('#notice')).toContainText('Shared session loaded');
    expect((await share(page)).session).toEqual(session);
    session.name = `Imported ${profile}`;
    await page.locator('#import-file').setInputFiles({ name: 'headphone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) });
    expect((await share(page)).session).toEqual(session);
    const invalid = structuredClone(session); invalid.asmr.layers[0].spatial.profile = 'native';
    await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.locator('#notice')).toContainText('Invalid ASMR HRTF profile');
    expect((await share(page)).session).toEqual(session);
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
});

test('headphone controls support keyboard, narrow screens, both themes and accessible labels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click(); await adjust(page);
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  const select = page.getByLabel('Sound 1 headphone profile', { exact: true });
  await select.focus(); await select.press('End'); await select.press('Tab'); await expect(select).toHaveValue('sadie-h10');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});

test('@live headphone profiles switch during playback, pause and previews without starting extra sessions', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click(); await adjust(page);
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  const select = page.getByLabel('Sound 1 headphone profile', { exact: true }); await select.selectOption('sadie-d1');
  await page.getByRole('button', { name: 'Preview sound 1', exact: true }).click();
  await expect(page.locator('#asmr-preview-status')).toContainText('Previewing one sound');
  await select.selectOption('sadie-h10');
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeEnabled();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await select.selectOption('sadie-d1'); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await select.selectOption('native'); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
});
