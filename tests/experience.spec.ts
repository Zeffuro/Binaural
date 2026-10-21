import { expect, test } from '@playwright/test';

test('volume reaches 100 percent and survives saving', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Master volume').fill('1');
  await expect(page.locator('#master-value')).toHaveText('100%');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.reload();
  await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Master volume')).toHaveValue('1');
});

test('pause freezes audio timer, resumes, and can stop while paused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const clock = await page.locator('#clock').textContent();
  await page.waitForTimeout(1300);
  await expect(page.locator('#clock')).toHaveText(clock!);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
});

test('explorer filters sourced recipes and loads without autoplay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore all presets' }).click();
  await expect(page.locator('.explore-card')).toHaveCount(70);
  await page.screenshot({ path: `test-results/preset-explorer-${test.info().project.name}.png` });
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('432 theta');
  await expect(page.locator('.explore-card')).toHaveCount(1);
  await expect(page.locator('.recipe-tones')).toContainText('432 / 438 Hz');
  await page.getByText('Recipe notes & sources').click();
  await expect(page.getByRole('link', { name: 'Usage source 1' })).toBeVisible();
  await page.getByRole('button', { name: /^Load 432/ }).click();
  await expect(page.locator('#preset-explorer')).not.toBeVisible();
  await expect(page.locator('#playing-title')).toContainText('432');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('[data-field=left]')).toHaveValue('432');
});

test('frequency search includes aliases and shows evidence notes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Find a frequency' }).fill('Schumann');
  await expect(page.locator('#frequencies button')).toHaveCount(1);
  await page.locator('#frequencies button').click();
  await expect(page.locator('#frequency-detail')).toContainText('7.83');
  await expect(page.locator('#frequency-detail a')).toHaveCount(2);
});

test('ambient colors are visible, whole-studio hues apply, and motion freezes on pause', async ({ page }) => {
  await page.goto('/');
  const preview = page.locator('#visual-preview');
  const before = await preview.evaluate(el => getComputedStyle(el).backgroundImage);
  await page.getByLabel('Color hue', { exact: true }).fill('280');
  expect(await preview.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(before);
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Color the whole studio').check();
  await expect(page.locator('body')).toHaveClass(/color-studio/);
  await page.getByLabel('Light style').selectOption('cycle');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.style.getPropertyValue('--light-hue')))).toBeGreaterThan(280);
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const pausedHue = await page.evaluate(() => document.documentElement.style.getPropertyValue('--light-hue'));
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--light-hue'))).toBe(pausedHue);
  await page.getByRole('button', { name: 'Open immersive light' }).click();
  await expect(page.getByRole('dialog', { name: 'Immersive ambient light' })).toBeVisible();
  await page.screenshot({ path: `test-results/immersive-light-${test.info().project.name}.png` });
  await page.getByRole('button', { name: 'Close light' }).click();
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('body')).not.toHaveClass(/color-studio/);
});

test('every catalog recipe validates and the expanded collection is fully present', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const catalogPath = '/src/catalog.ts';
    const modelPath = '/src/model.ts';
    const { presets, frequencies } = await import(catalogPath);
    const { parseSession } = await import(modelPath);
    for (const preset of presets) parseSession(preset.session);
    return { presets: presets.length, frequencies: frequencies.length, distinct: new Set(presets.map((p: { id: string }) => p.id)).size };
  });
  expect(result).toEqual({ presets: 30, frequencies: 36, distinct: 30 });
  await expect(page.locator('#frequencies button')).toHaveCount(36);
});
