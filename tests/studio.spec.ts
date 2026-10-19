import { expect, test } from '@playwright/test';

test('a stereo session plays, changes live, and stops repeatedly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Find your own/ })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Start listening' }).click();
    await expect(page.locator('#status')).toHaveText('● Listening');
    await page.locator('[data-field=left]').fill('240');
    await page.locator('[data-field=right]').fill('246');
    await expect(page.locator('[data-beat]')).toHaveText('6.0');
    await page.locator('[data-field=route]').selectOption('mixed');
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.getByLabel('Background sound').selectOption('ocean');
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.getByRole('button', { name: 'Remove layer 2', exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test('presets save, persist, export, import, and reject malformed data', async ({ page }) => {
  await page.goto('/');
  const name = 'My <quiet> & personal mix';
  await page.getByLabel('Preset name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await expect(page.locator('.saved-preset')).toHaveText(name);
  await page.reload();
  await page.locator('.saved-preset').click();
  await expect(page.locator('#playing-title')).toHaveText(name);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export preset JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator('#import-file').setInputFiles(path!);
  await expect(page.locator('#playing-title')).toHaveText(name);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"layers":[]}') });
  await expect(page.locator('#notice')).toContainText('Invalid preset');
  await expect(page.locator('#playing-title')).toHaveText(name);
  await page.getByRole('button', { name: `Delete preset ${name}`, exact: true }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(0);
});

test('frequency collection separates carriers and beats and enforces the layer limit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  const love = page.locator('.tone-layer').nth(1);
  await expect(love.locator('[data-field=left]')).toHaveValue('528');
  await expect(love.locator('[data-field=right]')).toHaveValue('528');
  await expect(love.locator('[data-field=route]')).toHaveValue('mixed');
  await page.getByRole('button', { name: /^Theta 6 Hz/ }).click();
  await expect(page.locator('.tone-layer').nth(2).locator('[data-beat]')).toHaveText('6.0');
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.locator('.tone-layer')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Add layer' })).toBeDisabled();
  await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  await expect(page.locator('.tone-layer')).toHaveCount(10);
  await page.locator('[data-field=left]').first().fill('5000');
  await page.locator('[data-field=left]').first().blur();
  await expect(page.locator('[data-field=left]').first()).toHaveValue('200');
});

test('local WAV music can join the session and be removed', async ({ page }) => {
  await page.goto('/');
  const wav = Buffer.alloc(44 + 48000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 48000; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 110 / 48000) * 1000), 44 + i * 2);
  await page.locator('#music-file').setInputFiles({ name: 'my-track.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.locator('#music-name')).toHaveText('my-track.wav');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Remove track' }).click();
  await expect(page.locator('#music-name')).toHaveText('Bring a little of your world.');
  await page.getByRole('button', { name: 'Stop listening' }).click();
});

test('motion is opt-in, respects reduced motion, and Shift Escape stops everything', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('switch', { name: /Ambient light/ })).not.toBeChecked();
  await page.getByRole('switch', { name: /Ambient light/ }).check();
  await page.getByRole('button', { name: 'Start listening' }).click();
  expect(await page.locator('.orb').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Shift+Escape');
  await expect(page.getByRole('switch', { name: /Ambient light/ })).not.toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('damaged local audio does not prevent a later tone-only session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#music-file').setInputFiles({ name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not an audio file') });
  await expect(page.locator('#notice')).toContainText('could not be played');
  await expect(page.locator('#music-name')).toHaveText('Bring a little of your world.');
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Stop listening' }).click();
});

test('mobile layout fits a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeVisible();
  await expect(page.getByLabel('Preset name', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/studio-mobile-${test.info().project.name}.png`, fullPage: true });
});

test('desktop studio renders without external resource requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:5173') && !request.url().startsWith('data:')) external.push(request.url());
  });
  await page.goto('/');
  await page.screenshot({ path: `test-results/studio-desktop-${test.info().project.name}.png`, fullPage: true });
  expect(external).toEqual([]);
});
