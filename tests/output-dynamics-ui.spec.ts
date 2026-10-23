import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function sharedSettings(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  const session = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    const value = readSharedSession(new URL(link).hash);
    return { ...value, layers: value.layers.map(({ id: _id, ...layer }: { id: string }) => layer) };
  }, link);
  return { link, session };
}

test('sound settings default to original Balanced, preserve the rest of the session and support undo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sound-settings')).not.toHaveAttribute('open');
  const before = (await sharedSettings(page)).session;
  expect(before).not.toHaveProperty('dynamics');
  await page.locator('.sound-settings > summary').click();
  const select = page.getByLabel('Sound dynamics', { exact: true });
  await expect(select).toHaveValue('balanced'); await select.focus(); await select.selectOption('open');
  await expect(select).toBeFocused();
  const open = (await sharedSettings(page)).session;
  expect(open).toEqual({ ...before, dynamics: 'open' });
  await expect(page.locator('#output-dynamics-help')).toContainText('quiet and loud');
  await page.locator('#undo-edit').click(); await expect(select).toHaveValue('balanced');
  expect((await sharedSettings(page)).session).not.toHaveProperty('dynamics');
  await select.selectOption('soft'); await expect(page.locator('#output-dynamics-help')).toContainText('Earlier compression');
  await select.selectOption('balanced'); expect((await sharedSettings(page)).session).not.toHaveProperty('dynamics');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('all three dynamics choices survive saved presets, share links and JSON import without autoplay', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/');
  for (const profile of ['balanced', 'open', 'soft']) {
    await page.locator('.sound-settings > summary').click();
    await page.getByLabel('Sound dynamics', { exact: true }).selectOption(profile);
    const name = `Dynamics ${profile}`;
    await page.locator('#preset-name').fill(name); await page.locator('#save-preset').click();
    await page.reload(); await page.locator('.saved-preset').filter({ hasText: name }).click();
    await expect(page.locator('#output-dynamics')).toHaveValue(profile);
    const { link, session } = await sharedSettings(page);
    expect(session.dynamics).toBe(profile === 'balanced' ? undefined : profile);
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.locator('#notice')).toContainText('Shared session loaded');
    await expect(page.locator('#output-dynamics')).toHaveValue(profile);
    session.name = `Imported ${profile}`;
    await page.locator('#import-file').setInputFiles({ name: 'dynamics.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) });
    await expect(page.locator('#session-label')).toHaveText(session.name);
    await expect(page.locator('#output-dynamics')).toHaveValue(profile);
    expect((await sharedSettings(page)).session).toEqual(session);
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    await page.reload();
  }
});

test('dynamics controls retain keyboard focus, ignore busy edits and reject unknown imported profiles', async ({ page }) => {
  await page.goto('/'); await page.locator('.sound-settings > summary').click();
  const select = page.getByLabel('Sound dynamics', { exact: true });
  await select.focus(); await select.press('End'); await select.press('Tab');
  await expect(select).toHaveValue('soft');
  const { session } = await sharedSettings(page);
  expect(session.dynamics).toBe('soft');
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...session, dynamics: 'bypass' })) });
  await expect(page.locator('#notice')).toContainText('Invalid');
  expect((await sharedSettings(page)).session).toEqual(session);
  await page.goto('/credits.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<section id="transport"><div id="visual-quick"></div></section>';
    const path = '/src/output-dynamics-controls.ts', { setupOutputDynamicsControls } = await import(path);
    let profile: 'balanced' | 'open' | 'soft' | undefined, busy = true, edits = 0;
    const controls = setupOutputDynamicsControls(document.querySelector('#transport')!, {
      get: () => profile, busy: () => busy, edit: (value: typeof profile) => { profile = value; edits++; } });
    const select = document.querySelector<HTMLSelectElement>('#output-dynamics')!;
    const blocked = select.disabled;
    select.value = 'open'; select.dispatchEvent(new Event('change')); const ignored = edits === 0 && select.value === 'balanced';
    busy = false; controls.transport(); select.value = 'soft'; select.dispatchEvent(new Event('change'));
    const changed = profile === 'soft' && edits === 1 && !select.disabled;
    select.value = 'unknown'; select.dispatchEvent(new Event('change'));
    return { blocked, ignored, changed, restored: select.value === 'soft' && edits === 1 };
  });
  expect(result).toEqual({ blocked: true, ignored: true, changed: true, restored: true });
});

test('sound settings fit 320px screens and remain accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  await page.locator('.sound-settings > summary').click();
  await page.getByLabel('Sound dynamics', { exact: true }).selectOption('open');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#transport').analyze()).violations).toEqual([]);
  }
});

test('@live dynamics edits keep playback and pause intact and stop isolated previews', async ({ page }) => {
  test.setTimeout(45000); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('.sound-settings > summary').click();
  await page.getByLabel('Sound dynamics', { exact: true }).selectOption('open');
  await page.getByRole('button', { name: 'Preview sound 1', exact: true }).click();
  await expect(page.locator('#asmr-preview-status')).toContainText('Previewing one sound');
  await page.getByLabel('Sound dynamics', { exact: true }).selectOption('soft');
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeEnabled();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByLabel('Sound dynamics', { exact: true }).selectOption('open');
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.getByLabel('Sound dynamics', { exact: true }).selectOption('balanced');
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
});
