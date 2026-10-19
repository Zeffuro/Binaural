import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';
import { makeBwgLibraryFixture } from './helpers/bwg-library';

test('BWGen library chooser loads the selected full sequence without autoplay', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'Default.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgLibraryFixture().bytes) });
  await expect(page.locator('#bwg-preset option')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toContainText('Original sequence A');
  await page.locator('#bwg-preset').selectOption('1');
  await page.getByRole('button', { name: 'Load imported session' }).click();
  await expect(page.locator('#playing-title')).toHaveText('Original sequence B');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#layers article')).toHaveCount(2);
  await expect(page.locator('#add-layer')).toBeDisabled();
});

test('BWGen files are reviewed before loading, retain their timeline and save as portable JSON', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'my-session.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
  const review = page.getByRole('dialog', { name: 'Review BWGen import' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Synthetic compatibility fixture');
  await expect(review).toContainText('AudioStrobe');
  await expect(page.locator('#playing-title')).toHaveText('Quiet morning');
  await page.getByRole('button', { name: 'Load imported session' }).click();
  await expect(review).not.toBeVisible();
  await expect(page.locator('#playing-title')).toHaveText('Synthetic compatibility fixture');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.getByRole('switch', { name: 'Ambient light' })).not.toBeChecked();
  await expect(page.locator('[data-field=left]')).toHaveValue('405');
  await expect(page.locator('[data-field=right]')).toHaveValue('395');
  await expect(page.locator('[data-field=left]')).toBeDisabled();
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export preset JSON' }).click();
  const file = await downloadPromise;
  await page.locator('#import-file').setInputFiles((await file.path())!);
  await expect(page.locator('#timeline-info')).toBeVisible();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.getByRole('button', { name: 'Make an editable static copy' }).click();
  await expect(page.locator('#timeline-info')).not.toBeVisible();
  await expect(page.locator('[data-field=left]')).toBeEnabled();
});

test('nonlinear BWGen files are reviewable and malformed files leave the session untouched', async ({ page }) => {
  await page.goto('/');
  const data = makeBwgFixture(undefined, { 36: [{ value: 10000, position: 0, weight: 3 }, { value: 6000, position: 10000 }] });
  await page.locator('#import-file').setInputFiles({ name: 'nonlinear.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(data) });
  await expect(page.getByRole('dialog', { name: 'Review BWGen import' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('nonlinear sweeps');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#playing-title')).toHaveText('Quiet morning');
  await page.locator('#import-file').setInputFiles({ name: 'truncated.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(data.slice(0, 500)) });
  await expect(page.locator('#notice')).toContainText('Cannot import BWGen');
  await expect(page.locator('#playing-title')).toHaveText('Quiet morning');
});

test('an import requested while stopping stays reviewable and loads after the transition', async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      async close(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 800)); return super.close(); }
    };
  });
  await page.goto('/');
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#play').click();
  await page.locator('#import-file').setInputFiles({ name: 'during-stop.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
  await page.locator('#accept-import').click();
  await expect(page.getByRole('dialog')).toContainText('Playback is still changing');
  await expect(page.locator('#playing-title')).toHaveText('Quiet morning');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#accept-import').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#playing-title')).toHaveText('Synthetic compatibility fixture');
});
