import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeBwgFixture } from './helpers/bwg';

test('fullscreen volume waits for native startup and master rejects busy changes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'test.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
  await page.getByRole('button', { name: 'Load imported session', exact: true }).click();
  await page.locator('[data-visual-quick=calm]').click(); await page.locator('#visual-dock-fullscreen').click();
  const originalVolume = await page.locator('#master').inputValue();
  await page.evaluate(() => {
    const original = Worklet.prototype.addModule;
    Worklet.prototype.addModule = async function(...args) {
      await new Promise<void>(resolve => { (window as any).finishNativeStartup = resolve; });
      return original.apply(this, args);
    };
  });
  const controls = page.locator('.scene-stage').getByRole('group', { name: 'Audio controls', exact: true });
  await controls.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishNativeStartup)).toBe('function');
  await expect(controls.getByRole('slider', { name: 'Volume', exact: true })).toBeDisabled();
  await page.locator('#master').evaluate((node: HTMLInputElement) => { node.value = '.9'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#master')).toHaveValue(originalVolume);
  await page.evaluate(() => (window as any).finishNativeStartup());
  await expect(controls.getByRole('slider', { name: 'Volume', exact: true })).toBeEnabled();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await controls.getByRole('button', { name: 'Stop audio', exact: true }).click();
});

for (const kind of ['scene', 'light'] as const) {
  test(`${kind} fullscreen audio controls share playback, mute and volume with the studio`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
    if (kind === 'scene') await page.locator('[data-visual-quick=calm]').click();
    else await page.getByRole('switch', { name: 'Ambient light' }).check();
    await page.locator('#visual-dock-fullscreen').click();
    const stage = page.locator(kind === 'scene' ? '.scene-stage' : '.light-stage');
    const controls = stage.getByRole('group', { name: 'Audio controls', exact: true });
    await controls.getByRole('button', { name: 'Play audio', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('● Listening');
    await controls.getByRole('button', { name: 'Pause audio', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
    await controls.getByRole('button', { name: 'Mute tones', exact: true }).click();
    await expect(page.locator('#scene-mute-tones')).toHaveAttribute('aria-pressed', 'true');
    const volume = controls.getByRole('slider', { name: /Volume/ });
    await volume.focus(); await volume.press('Home');
    for (let n = 0; n < 3; n++) await volume.press('ArrowRight');
    await expect(page.locator('#master')).toHaveValue('0.03'); await expect(controls.locator('output')).toHaveText('3%');
    await expect(volume).toHaveAttribute('aria-valuetext', '3%');
    await controls.getByRole('button', { name: 'Resume audio', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('● Listening');
    await controls.getByRole('button', { name: 'Stop audio', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Ready when you are'); await expect(stage).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Stop audio', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(stage).not.toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/immersive-open/);
    await page.locator('#master').focus(); await page.locator('#master').press('ArrowRight');
    await page.locator('#visual-dock-fullscreen').click();
    await expect(volume).toHaveValue('0.04');
    await expect(controls.getByRole('button', { name: 'Unmute tones', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test(`${kind} fullscreen has no scrollbar and audio controls hide after pointer use`, async ({ page }) => {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = async () => { throw new DOMException('Window fallback coverage', 'NotSupportedError'); };
    });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
    if (kind === 'scene') await page.locator('[data-visual-quick=calm]').click();
    else await page.getByRole('switch', { name: 'Ambient light' }).check();
    await page.locator('#visual-dock-fullscreen').click();
    const stage = page.locator(kind === 'scene' ? '.scene-stage' : '.light-stage');
    const controls = stage.locator('.immersive-audio');
    await expect(controls).toHaveCSS('opacity', '0');
    await stage.dispatchEvent('pointermove');
    await controls.getByRole('button', { name: 'Mute tones', exact: true }).click();
    await page.mouse.move(100, 150);
    await expect(controls).toHaveCSS('opacity', '0');
    await page.keyboard.press('Escape'); await expect(stage).not.toBeVisible();
    await page.getByLabel('Hide fullscreen controls when idle').uncheck();
    for (const [width, colorScheme] of [[1280, 'light'], [1280, 'dark'], [320, 'light'], [320, 'dark']] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 844 });
      await page.locator('#visual-dock-fullscreen').click(); await expect(stage).toBeVisible();
      expect(await stage.evaluate(node => ({ width: node.clientWidth === innerWidth, height: node.clientHeight === innerHeight }))).toEqual({ width: true, height: true });
      await expect(controls.locator('output')).toHaveCSS('color', 'rgb(238, 242, 227)');
      expect(await stage.evaluate(node => ({ x: node.scrollWidth > node.clientWidth, y: node.scrollHeight > node.clientHeight, overflow: getComputedStyle(node).overflow }))).toEqual({ x: false, y: false, overflow: 'hidden' });
      expect(await page.evaluate(() => ({ width: document.documentElement.clientWidth === innerWidth, overflow: getComputedStyle(document.documentElement).overflow }))).toEqual({ width: true, overflow: 'hidden' });
      await stage.dispatchEvent('pointermove');
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(accessibility.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
      await stage.dispatchEvent('pointermove'); await page.screenshot({ path: `test-results/${kind}-fullscreen-audio-${width}-${colorScheme}-${test.info().project.name}.png` });
      await page.keyboard.press('Escape'); await expect(stage).not.toBeVisible();
    }
  });
}
