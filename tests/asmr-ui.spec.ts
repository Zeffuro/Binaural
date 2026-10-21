import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setSources } from './helpers/listening-sources';

async function adjust(page: Page, index = 0) {
  const details = page.locator('.asmr-advanced').nth(index);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}

test('ASMR mixes load silently, explicitly approve paired lights once, and keep advanced controls optional', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await setSources(page, 'asmr');
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.locator('[data-asmr]')).toHaveCount(1);
  await page.locator('#asmr-more-experiences > summary').click();
  await expect(page.locator('#asmr-preset option')).toHaveCount(28);
  for (const id of ['glass-lantern', 'red-sweep', 'rose-brushes', 'paper-prism', 'blue-droplets', 'torch-whisper']) {
    await page.locator('#asmr-preset').selectOption(id); await page.locator('#asmr-pair').click();
    if (id === 'glass-lantern') await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-asmr]')).toHaveCount(2); await expect(page.locator('#scene-mode')).toHaveValue('triggers');
    await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await expect(page.getByRole('slider', { name: 'Sound 1 volume', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Sound 1 sound pace', exact: true })).not.toBeVisible();
  await adjust(page);
  await expect(page.getByRole('slider', { name: 'Sound 1 sound pace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mute sound 1', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mute sound 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await adjust(page, 1);
  await page.getByRole('button', { name: 'Solo sound 2', exact: true }).click(); await expect(page.getByRole('button', { name: 'Solo sound 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await setSources(page, 'mixed');
  await page.locator('#asmr-only').click();
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ambient-level')).toHaveValue('0.2'); await expect(page.locator('#music-level')).toHaveValue('0.4');
  await page.locator('#undo-edit').click();
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
});

test('six sound layers can be edited, duplicated, removed and undone without starting audio', async ({ page }) => {
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-clear').click(); await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await page.locator('#asmr-add').click();
  await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption('wood');
  await adjust(page);
  await page.getByLabel('Sound 1 movement', { exact: true }).selectOption('still');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Duplicate sound 1', exact: true }).click();
  await expect(page.locator('[data-asmr]')).toHaveCount(6); await expect(page.locator('#asmr-add')).toBeDisabled();
  await page.getByRole('button', { name: 'Remove sound 2', exact: true }).click(); await expect(page.locator('[data-asmr]')).toHaveCount(5);
  await page.locator('#undo-edit').click(); await expect(page.locator('[data-asmr]')).toHaveCount(6);
  await page.locator('#asmr-clear').click(); await expect(page.locator('[data-asmr]')).toHaveCount(0);
  await page.locator('#undo-edit').click(); await expect(page.locator('[data-asmr]')).toHaveCount(6);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('saved and shared experiences retain ASMR and soft lights while restored visual consent stays off', async ({ page }) => {
  await page.goto('/'); await setSources(page, 'asmr');
  await page.locator('#asmr-more-experiences > summary').click();
  await page.locator('#asmr-preset').selectOption('glass-lantern'); await page.locator('#asmr-pair').click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked();
  await adjust(page);
  await page.getByRole('button', { name: 'Solo sound 1', exact: true }).click();
  await page.getByLabel('Sound 1 movement', { exact: true }).selectOption('wander');
  const pressure = page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true });
  await pressure.focus(); await pressure.evaluate((input: HTMLInputElement) => { input.value = '.65'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const phase = page.getByRole('slider', { name: 'Sound 1 alternate sides (advanced)', exact: true });
  await phase.focus(); await phase.evaluate((input: HTMLInputElement) => { input.value = '180'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#preset-name').fill('Glass sound space'); await page.locator('#save-preset').click();
  await expect(page.locator('#notice')).toContainText('saved'); await page.reload();
  await page.locator('[data-saved]').click();
  await expect(page.locator('#preset-name')).toHaveValue('Glass sound space');
  await adjust(page);
  await expect(page.getByLabel('Sound 1 movement', { exact: true })).toHaveValue('wander');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true })).toHaveValue('0.65');
  await expect(page.getByLabel('Sound 1 alternate sides (advanced)', { exact: true })).toHaveValue('180');
  await expect(page.getByRole('button', { name: 'Solo sound 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })).toHaveCount(0);
  await page.locator('#share-session').click(); const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('dialog', { name: 'Share session', exact: true }).getByRole('button', { name: 'Close share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share session', exact: true })).toHaveCount(0);
  await page.goto('about:blank'); await page.goto(link);
  await expect(page.locator('#preset-name')).toHaveValue('Glass sound space');
  await adjust(page);
  await expect(page.locator('[data-asmr]')).toHaveCount(2); await expect(page.locator('#trigger-preset')).toHaveValue('custom');
  await expect(page.locator('#trigger-seed')).toHaveValue('47');
  await expect(page.locator('#trigger-brightness')).toHaveValue('0.3');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', { name: 'Sound 1 ear cupping', exact: true })).toHaveValue('0.65');
  await expect(page.getByLabel('Sound 1 alternate sides (advanced)', { exact: true })).toHaveValue('180');
  await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('ASMR controls remain usable in both themes at 320px with no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  await setSources(page, 'asmr'); await page.locator('#asmr-more-experiences > summary').click(); await page.locator('#asmr-load').click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await page.locator('.asmr-advanced').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    await page.getByRole('button', { name: 'Mute sound 1', exact: true }).click();
    await page.locator('#asmr-controls').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
  }
});
