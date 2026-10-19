import { expect, test } from '@playwright/test';

test('Auto is canonical saved state while its measured quality stays transient', async ({ page }) => {
  await page.goto('/');
  const contract = await page.evaluate(async () => {
    const statePath = '/src/visual-state.ts', modelPath = '/src/model.ts';
    const { defaultVisualSettings, parseVisualSettings, visualBudget } = await import(statePath);
    const { initialSession, parseSession } = await import(modelPath);
    const state = { ...defaultVisualSettings(), quality: 'auto' };
    return { quality: parseSession(JSON.parse(JSON.stringify({ ...initialSession(), visual: state }))).visual.quality,
      legacy: ['eco', 'balanced', 'high'].map(quality => parseVisualSettings({ ...state, quality }).quality),
      fallback: visualBudget('auto'), defaultQuality: defaultVisualSettings().quality };
  });
  expect(contract).toEqual({ quality: 'auto', legacy: ['eco', 'balanced', 'high'], fallback: { fps: 30, ratio: 1, maxWidth: 960 }, defaultQuality: 'balanced' });
  await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
  await page.getByLabel('Visual quality', { exact: true }).selectOption('auto');
  await expect(page.locator('#visual-quality-status')).toContainText('Auto: Eco');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.reload();
  await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Visual quality', { exact: true })).toHaveValue('auto');
  await expect(page.locator('#visual-quality-status')).toHaveAttribute('data-effective', 'eco');
  await expect(page.getByLabel('Animate without audio')).not.toBeChecked();
});

test.describe('adaptive rendering lifecycle', () => {
  test.use({ deviceScaleFactor: 2 });

  test('effective quality reaches rendering and learning pauses with inactive motion', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const path = '/src/adaptive-visual-quality.ts';
      const { AdaptiveVisualQuality } = await import(path);
      const sample = AdaptiveVisualQuality.prototype.sample;
      const state = window as unknown as { qualitySamples: number; promoteQuality: boolean };
      state.qualitySamples = 0; state.promoteQuality = false;
      AdaptiveVisualQuality.prototype.sample = function(cost: number, cadence: number, elapsed: number) {
        state.qualitySamples++;
        if (!state.promoteQuality) return sample.call(this, cost, cadence, elapsed);
        let changed = false;
        // Advance controller evidence without loading the GPU or waiting through recovery windows.
        for (let i = 0; i < 60; i++) changed = sample.call(this, 1, 1000 / 60, 250) || changed;
        return changed;
      };
    });
    const samples = () => page.evaluate(() => (window as unknown as { qualitySamples: number }).qualitySamples);
    const frozen = async () => {
      await page.waitForTimeout(120);
      const count = await samples();
      await page.waitForTimeout(160);
      expect(await samples()).toBe(count);
    };
    await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
    await page.getByLabel('Visual quality', { exact: true }).selectOption('auto');
    const canvas = page.locator('.scene-drawing');
    await canvas.scrollIntoViewIfNeeded();
    const ecoWidth = await canvas.evaluate(node => node.width);
    await frozen();
    expect(await samples()).toBe(0);
    await page.getByLabel('Animate without audio').check();
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(samples).toBeGreaterThan(0);
    await page.evaluate(() => { (window as unknown as { promoteQuality: boolean }).promoteQuality = true; });
    await expect(page.locator('#visual-quality-status')).toHaveAttribute('data-effective', 'high');
    await expect.poll(() => canvas.evaluate(node => node.width)).toBeGreaterThan(ecoWidth);
    await expect.poll(() => canvas.evaluate(node => node.width)).toBeLessThanOrEqual(1920);
    await expect(page.getByLabel('Visual quality', { exact: true })).toHaveValue('auto');

    await page.emulateMedia({ reducedMotion: 'reduce' }); await frozen();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let count = await samples(); await expect.poll(samples).toBeGreaterThan(count);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await frozen();
    await page.evaluate(() => {
      delete (document as unknown as { hidden?: boolean }).hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    count = await samples(); await expect.poll(samples).toBeGreaterThan(count);
    await page.locator('#scene-preview').evaluate(node => { node.style.display = 'none'; }); await frozen();
    await page.locator('#scene-preview').evaluate(node => { node.style.display = ''; });
    await canvas.scrollIntoViewIfNeeded(); count = await samples(); await expect.poll(samples).toBeGreaterThan(count);
    await page.getByLabel('Animate without audio').uncheck(); await frozen();

    await page.getByLabel('Visual quality', { exact: true }).selectOption('high');
    await page.getByLabel('Animate without audio').check(); await canvas.scrollIntoViewIfNeeded(); await frozen();
    await expect(page.locator('#visual-quality-status')).toHaveAttribute('data-effective', 'high');
    await page.evaluate(() => { (window as unknown as { promoteQuality: boolean }).promoteQuality = false; });
    await page.getByLabel('Visual quality', { exact: true }).selectOption('auto');
    await expect(page.locator('#visual-quality-status')).toHaveAttribute('data-effective', 'eco');
  });
});
