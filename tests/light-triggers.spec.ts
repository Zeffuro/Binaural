import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function choose(page: Page) {
  await page.goto('/'); await page.locator('[data-visual-quick=triggers]').click();
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('light triggers have explicit opt-in, nineteen presets and a silent static preview', async ({ page }) => {
  await choose(page);
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.locator('#visual-dock-fullscreen')).toBeDisabled(); await expect(page.locator('.scene-drawing')).not.toBeVisible();
  await expect(page.locator('#trigger-preset option:not([disabled])')).toHaveCount(19);
  await page.getByLabel('Enable light triggers', { exact: true }).check();
  await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible(); await settle(page);
  const first = await page.locator('.scene-drawing').getAttribute('data-light');
  await page.waitForTimeout(120); await expect(page.locator('.scene-drawing')).toHaveAttribute('data-light', first!);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  for (const id of ['red-scan', 'soft-torch', 'prism-lantern']) {
    await page.locator('#trigger-preset').selectOption(id); await expect(page.locator('.scene-drawing')).toBeVisible();
  }
  await page.getByLabel('Enable light triggers', { exact: true }).uncheck(); await expect(page.locator('#visual-dock-fullscreen')).toBeDisabled();
});

test('featured lights and intensity are available immediately without opening advanced settings or granting consent', async ({ page }) => {
  await choose(page);
  await expect(page.locator('#trigger-controls details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#trigger-controls').getByRole('slider', { name: 'Brightness', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Light movement speed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Very bright white torch', exact: true }).click();
  await expect(page.locator('#trigger-preset')).toHaveValue('very-bright-torch');
  await expect(page.locator('#trigger-controls').getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.locator('.scene-drawing')).not.toBeVisible();
  await page.getByRole('button', { name: 'Comfortable', exact: true }).click();
  await expect(page.locator('#trigger-controls').getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('0.55');
  await page.getByRole('button', { name: 'Very bright', exact: true }).click();
  await expect(page.locator('#trigger-controls').getByRole('slider', { name: 'Brightness', exact: true })).toHaveAttribute('aria-valuetext', '400%');
  await page.getByLabel('Enable light triggers', { exact: true }).check();
  await expect(page.locator('.scene-drawing')).toBeVisible();
});

test('glass can stay fixed while the backlight moves and pause/reduced motion freeze both clocks', async ({ page }) => {
  await choose(page); await page.getByLabel('Enable light triggers', { exact: true }).check();
  await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
  await page.getByRole('slider', { name: 'Glass rotation speed', exact: true }).focus();
  await page.getByRole('slider', { name: 'Glass rotation speed', exact: true }).press('Home');
  await page.getByLabel('Animate without audio', { exact: true }).check();
  const canvas = page.locator('.scene-drawing'); await canvas.scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await canvas.getAttribute('data-light'))).toBeGreaterThan(.01);
  await expect(canvas).toHaveAttribute('data-glass', '0.0000');
  await page.getByLabel('Animate without audio', { exact: true }).uncheck(); await canvas.scrollIntoViewIfNeeded(); await settle(page);
  const paused = await canvas.getAttribute('data-light'); await page.waitForTimeout(150); await expect(canvas).toHaveAttribute('data-light', paused!);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByLabel('Animate without audio', { exact: true }).check();
  await canvas.scrollIntoViewIfNeeded(); await settle(page);
  const reduced = await canvas.getAttribute('data-light'); await page.waitForTimeout(150); await expect(canvas).toHaveAttribute('data-light', reduced!);
});

test('manual placement is reversible and the active light can export a real PNG', async ({ page }) => {
  await choose(page); await page.getByLabel('Enable light triggers', { exact: true }).check();
  await page.locator('#trigger-preset').selectOption('quiet-focus');
  const canvas = page.locator('.scene-drawing'); await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * .75, box.y + box.height * .3);
  await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
  await expect(page.getByRole('slider', { name: 'Horizontal position', exact: true })).toHaveValue('0.5');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.locator('#trigger-controls details')).toHaveAttribute('open', '');
  await expect(page.getByRole('slider', { name: 'Horizontal position', exact: true })).toHaveValue('0');
  await page.getByLabel('Enable light triggers', { exact: true }).check();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save PNG still', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(bytes.length).toBeGreaterThan(1000);
});

test('custom light colors and geometry survive saved/share sessions while consent and motion remain local', async ({ page }) => {
  await choose(page); await page.getByLabel('Enable light triggers', { exact: true }).check();
  await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
  await page.getByLabel('Mirror layout', { exact: true }).selectOption('radial');
  await page.getByRole('slider', { name: 'Radial symmetry', exact: true }).focus(); await page.getByRole('slider', { name: 'Radial symmetry', exact: true }).press('End');
  await page.getByLabel('Backlight color', { exact: true }).fill('#ffc277');
  await page.getByLabel('Main color', { exact: true }).fill('#dd2277');
  await page.getByRole('button', { name: 'Very bright', exact: true }).click();
  await page.getByRole('slider', { name: 'Backlight strength', exact: true }).focus(); await page.keyboard.press('End');
  await page.getByLabel('Animate without audio', { exact: true }).check();
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.getByRole('button', { name: 'Share session link', exact: true }).click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.goto('about:blank'); await page.goto(link);
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('triggers');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Animate without audio', { exact: true })).not.toBeChecked();
  await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
  await expect(page.getByLabel('Mirror layout', { exact: true })).toHaveValue('radial');
  await expect(page.getByRole('slider', { name: 'Radial symmetry', exact: true })).toHaveValue('16');
  await expect(page.getByLabel('Backlight color', { exact: true })).toHaveValue('#ffc277');
  await expect(page.getByLabel('Main color', { exact: true })).toHaveValue('#dd2277');
  await expect(page.locator('#trigger-controls').getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('4');
  await expect(page.getByRole('slider', { name: 'Backlight strength', exact: true })).toHaveValue('3');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
  await expect(page.getByLabel('Backlight color', { exact: true })).toHaveValue('#ffc277');
});

test('fullscreen light settings edit the same controls, close independently and preserve listening', async ({ page }) => {
  await page.addInitScript(() => { Element.prototype.requestFullscreen = async () => { throw new DOMException('Window fallback', 'NotSupportedError'); }; });
  await choose(page); await page.getByLabel('Enable light triggers', { exact: true }).check();
  await page.getByRole('button', { name: 'Start listening' }).click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('.scene-drawing').dblclick();
  await page.getByRole('button', { name: 'Light settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust light triggers', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByLabel('Light trigger preset', { exact: true }).selectOption('red-scan');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.locator('.scene-stage')).toBeVisible();
  await expect(page.locator('.scene-stage-tools')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Next visual', exact: true }).click();
  await expect(page.locator('#trigger-preset')).toHaveValue('red-orbit');
  await page.keyboard.press('Escape'); await expect(page.locator('#visual-dock #trigger-controls')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('● Listening');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} trigger settings and color pickers fit mobile with accessible controls`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' }); await page.setViewportSize({ width: 320, height: 844 });
    await choose(page); await page.getByLabel('Enable light triggers', { exact: true }).check();
    await page.locator('#trigger-controls details').evaluate((node: HTMLDetailsElement) => { node.open = true; });
    await page.getByRole('button', { name: 'Choose backlight color', exact: true }).click();
    await page.getByRole('slider', { name: 'Backlight color hue', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clipped = await page.locator('#trigger-controls label, #trigger-controls button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
    expect(clipped).toEqual([]);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
    await page.locator('#trigger-controls').screenshot({ path: `test-results/light-triggers-${colorScheme}-${test.info().project.name}.png` });
  });
}
