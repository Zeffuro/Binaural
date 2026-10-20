import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('ASMR mixes load silently, pair with lights without consent, and keep advanced controls optional', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#asmr-controls')).not.toBeVisible();
  await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await page.locator('button[data-listening-mode="asmr"]').click();
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.locator('[data-asmr]')).toHaveCount(2);
  await expect(page.locator('#asmr-preset option')).toHaveCount(28);
  for (const id of ['glass-lantern', 'red-sweep', 'rose-brushes', 'paper-prism', 'blue-droplets', 'torch-whisper']) {
    await page.locator('#asmr-preset').selectOption(id); await page.locator('#asmr-pair').click();
    await expect(page.locator('[data-asmr]')).toHaveCount(2); await expect(page.locator('#scene-mode')).toHaveValue('triggers');
    await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await expect(page.getByRole('slider', { name: 'Sound 1 volume', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Sound 1 sound pace', exact: true })).not.toBeVisible();
  await page.locator('.asmr-advanced summary').first().click();
  await expect(page.getByRole('slider', { name: 'Sound 1 sound pace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mute sound 1', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mute sound 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Solo sound 2', exact: true }).click(); await expect(page.getByRole('button', { name: 'Solo sound 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('button[data-listening-mode="mixed"]').click();
  await page.locator('#asmr-only').click();
  await expect(page.locator('button[data-listening-mode="asmr"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ambient-level')).toHaveValue('0.2'); await expect(page.locator('#music-level')).toHaveValue('0.4');
  await page.locator('#undo-edit').click();
  await expect(page.locator('button[data-listening-mode="mixed"]')).toHaveAttribute('aria-pressed', 'true');
});

test('six sound layers can be edited, duplicated, removed and undone without starting audio', async ({ page }) => {
  await page.goto('/'); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.locator('#asmr-clear').click(); await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await page.locator('#asmr-add').click();
  await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption('wood');
  await page.getByLabel('Sound 1 movement', { exact: true }).selectOption('still');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Duplicate sound 1', exact: true }).click();
  await expect(page.locator('[data-asmr]')).toHaveCount(6); await expect(page.locator('#asmr-add')).toBeDisabled();
  await page.getByRole('button', { name: 'Remove sound 2', exact: true }).click(); await expect(page.locator('[data-asmr]')).toHaveCount(5);
  await page.locator('#undo-edit').click(); await expect(page.locator('[data-asmr]')).toHaveCount(6);
  await page.locator('#asmr-clear').click(); await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await page.locator('#undo-edit').click(); await expect(page.locator('[data-asmr]')).toHaveCount(6);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('saved and shared experiences retain ASMR settings and lights without autoplay or visual consent', async ({ page }) => {
  await page.goto('/'); await page.locator('button[data-listening-mode="asmr"]').click();
  await page.locator('#asmr-preset').selectOption('glass-lantern'); await page.locator('#asmr-pair').click();
  await page.getByRole('button', { name: 'Solo sound 1', exact: true }).click();
  await page.getByLabel('Sound 1 movement', { exact: true }).selectOption('wander');
  const pressure = page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true });
  await pressure.focus(); await pressure.evaluate((input: HTMLInputElement) => { input.value = '.65'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('.asmr-advanced summary').first().click();
  const phase = page.getByRole('slider', { name: 'Sound 1 cupping phase', exact: true });
  await phase.focus(); await phase.evaluate((input: HTMLInputElement) => { input.value = '180'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#preset-name').fill('Glass sound space'); await page.locator('#save-preset').click();
  await expect(page.locator('#notice')).toContainText('saved'); await page.reload();
  await page.locator('[data-saved]').click(); await expect(page.getByLabel('Sound 1 movement', { exact: true })).toHaveValue('wander');
  await expect(page.locator('button[data-listening-mode="asmr"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true })).toHaveValue('0.65');
  await expect(page.getByLabel('Sound 1 cupping phase', { exact: true })).toHaveValue('180');
  await expect(page.getByRole('button', { name: 'Solo sound 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#share-session').click(); const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.goto(link); await expect(page.locator('[data-asmr]')).toHaveCount(2); await expect(page.locator('#trigger-preset')).toHaveValue('prism-lantern');
  await expect(page.locator('button[data-listening-mode="asmr"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true })).toHaveValue('0.65');
  await expect(page.getByLabel('Sound 1 cupping phase', { exact: true })).toHaveValue('180');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('ASMR controls remain usable in both themes at 320px with no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  await page.locator('button[data-listening-mode="asmr"]').click(); await page.locator('#asmr-load').click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await page.locator('.asmr-advanced').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    await page.getByRole('button', { name: 'Mute sound 1', exact: true }).click();
    await page.locator('#asmr-controls').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
