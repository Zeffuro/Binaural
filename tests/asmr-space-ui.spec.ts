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

test('listening spaces are opt-in and roundtrip complete mixes through save, share, undo and Dry without autoplay', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  const choice = page.getByLabel('Listening space', { exact: true });
  await expect(choice).toHaveValue('dry');
  const original = (await shared(page)).session;
  expect(original.asmr).not.toHaveProperty('space');
  await choice.focus(); await choice.selectOption('close');
  await expect(page.locator('#asmr-room-settings')).not.toHaveAttribute('open');
  const { link, session } = await shared(page);
  expect(session.asmr.space).toEqual({ amount: .12, size: .75, warmth: .7 });
  const layers = (value: typeof session) => value.asmr.layers.map(({ id: _id, ...layer }: { id: string }) => layer);
  expect(layers(session)).toEqual(layers(original));
  for (const field of ['mode', 'master', 'ambient', 'ambientLevel', 'musicLevel']) expect(session[field]).toEqual(original[field]);
  await page.locator('#preset-name').fill('My quiet room'); await page.locator('#save-preset').click();
  await page.reload(); await page.locator('.saved-preset').filter({ hasText: 'My quiet room' }).click();
  await expect(choice).toHaveValue('close');
  await choice.focus(); await choice.selectOption('soft');
  expect((await shared(page)).session.asmr.space).toEqual({ amount: .24, size: 1.25, warmth: .85 });
  await page.locator('#undo-edit').click(); await expect(choice).toHaveValue('close');
  await choice.focus(); await choice.selectOption('dry');
  expect((await shared(page)).session.asmr).not.toHaveProperty('space');
  await page.locator('#undo-edit').click(); await expect(choice).toHaveValue('close');
  await page.goto('about:blank'); await page.goto(link);
  await expect(page.locator('#notice')).toContainText('Shared session loaded');
  await expect(choice).toHaveValue('close');
  expect(layers((await shared(page)).session)).toEqual(layers(original));
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
});

test('advanced room controls support keyboard edits, accessible values, custom import and validation', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-room-settings > summary').click();
  const amount = page.getByLabel('Reflections', { exact: true }), size = page.getByLabel('Room size', { exact: true });
  const warmth = page.getByLabel('Warmth', { exact: true });
  await expect(size).toBeDisabled(); await expect(warmth).toBeDisabled(); await expect(amount).toBeEnabled();
  await amount.focus(); await amount.press('End'); await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute('aria-valuetext', '35%');
  await size.focus(); await size.press('End'); await expect(size).toHaveAttribute('aria-valuetext', '1.50×');
  await warmth.focus(); await warmth.press('Home'); await expect(warmth).toHaveAttribute('aria-valuetext', '0%');
  await expect(page.locator('#asmr-listening-space')).toHaveValue('custom');
  const { session } = await shared(page);
  expect(session.asmr.space).toEqual({ amount: .35, size: 1.5, warmth: 0 });
  session.name = 'A custom listening room';
  await page.locator('#import-file').setInputFiles({ name: 'room.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) });
  await expect(page.locator('#session-label')).toHaveText(session.name);
  await expect(page.locator('#asmr-listening-space')).toHaveValue('custom');
  expect((await shared(page)).session.asmr.space).toEqual(session.asmr.space);
  await page.locator('#import-file').setInputFiles({ name: 'invalid-room.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...session, asmr: { ...session.asmr, space: { ...session.asmr.space, amount: .36 } } })) });
  await expect(page.locator('#notice')).toContainText('Invalid ASMR');
  expect((await shared(page)).session.asmr.space).toEqual(session.asmr.space);
  await page.locator('#asmr-listening-space').selectOption('dry');
  await expect(size).toBeDisabled(); await expect(warmth).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('simple and advanced listening-space controls fit 320px screens and remain accessible in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-listening-space').selectOption('soft');
  await page.locator('#asmr-room-settings > summary').click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});

test('room controls ignore pending playback edits and restore Dry-dependent disabling after transport changes', async ({ page }) => {
  await page.goto('/credits.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<section id="asmr-controls"></section>';
    const controlsPath = '/src/asmr-controls.ts', statePath = '/src/asmr-state.ts';
    const { setupAsmr } = await import(controlsPath), { defaultAsmr } = await import(statePath);
    let state = defaultAsmr(), busy = false, edits = 0;
    const controls = setupAsmr({ get: () => state, update: (value: typeof state) => { state = value; edits++; },
      beforeEdit: () => {}, isolate: () => {}, busy: () => busy, importedMute: () => undefined, muteImported: () => {} });
    const choice = document.querySelector<HTMLSelectElement>('#asmr-listening-space')!;
    const amount = document.querySelector<HTMLInputElement>('#asmr-room-amount')!;
    const size = document.querySelector<HTMLInputElement>('#asmr-room-size')!;
    const warmth = document.querySelector<HTMLInputElement>('#asmr-room-warmth')!;
    busy = true; controls.transport();
    const pending = [choice, amount, size, warmth].every(input => input.disabled);
    amount.value = '.35'; amount.dispatchEvent(new Event('input', { bubbles: true }));
    const ignored = edits === 0 && !state.space && amount.value === '0';
    busy = false; controls.transport();
    const dry = !choice.disabled && !amount.disabled && size.disabled && warmth.disabled;
    choice.value = 'close'; choice.dispatchEvent(new Event('input', { bubbles: true }));
    const enabled = [choice, amount, size, warmth].every(input => !input.disabled);
    busy = true; controls.transport();
    const allBlocked = [choice, amount, size, warmth].every(input => input.disabled);
    choice.value = 'soft'; choice.dispatchEvent(new Event('input', { bubbles: true }));
    busy = false; controls.transport();
    return { pending, ignored, dry, enabled, allBlocked, edits, space: state.space, choice: choice.value };
  });
  expect(result).toEqual({ pending: true, ignored: true, dry: true, enabled: true, allBlocked: true,
    edits: 1, space: { amount: .12, size: .75, warmth: .7 }, choice: 'close' });
});
