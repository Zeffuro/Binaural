import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('quick visuals show a nearby preview and enter fullscreen without starting sound', async ({ page }) => {
  await page.goto('/');
  const quick = page.getByRole('group', { name: 'Visual Quick Start' });
  await quick.getByRole('button', { name: 'Calm', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Visualization preview', exact: true });
  await expect(dock).toBeVisible();
  await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
  await expect(quick.getByRole('button', { name: 'Calm', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.getByRole('button', { name: 'Fullscreen visualization', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Immersive visualization' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
  await quick.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(dock).not.toBeVisible();
});

test('MilkDrop opt-in is beside quick controls and fullscreen waits for consent', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-visual-quick=milkdrop]').click();
  await expect(page.locator('#visual-dock #milkdrop-enable')).toBeVisible();
  await expect(page.locator('#visual-dock')).toContainText('rapid motion or flashing');
  await expect(page.locator('#visual-dock-fullscreen')).toBeDisabled();
  await expect(page.locator('.scene-milkdrop')).not.toBeVisible();
  await page.getByLabel('Enable MilkDrop visuals').check();
  await expect(page.locator('#visual-dock .scene-milkdrop')).toHaveAttribute('data-preset', 'liquid-beats', { timeout: 15000 });
  await page.locator('#visual-dock-fullscreen').click();
  await expect(page.locator('.scene-stage .scene-milkdrop')).toBeVisible();
  await page.getByRole('button', { name: 'Next visual', exact: true }).click();
  await expect(page.locator('.scene-milkdrop')).toHaveAttribute('data-preset', 'deep-blue');
  await page.keyboard.press('Escape');
  await expect(page.locator('#visual-dock .scene-milkdrop')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.locator('#visual-dock #milkdrop-enable')).not.toBeChecked();
  await expect(page.locator('#visual-dock-fullscreen')).toBeDisabled();
});

test('ambient light also has an inline color preview and uses its matching fullscreen', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ambient light color', { exact: true }).fill('#cc3399');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await expect(page.locator('.visual-dock-light')).toBeVisible();
  expect(await page.locator('.visual-dock-light').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(204, 51, 153)');
  await page.getByRole('button', { name: 'Fullscreen visualization', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Immersive ambient light' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('fullscreen navigation and touch swipes keep audio playing and preserve panorama dragging', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-visual-quick=reactive]').click();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#visual-dock-fullscreen').click();
  await page.getByRole('button', { name: 'Next visual', exact: true }).click();
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('scope');
  await page.keyboard.press(']'); await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('orbits');
  const swipe = async (left: boolean) => page.locator('.scene-viewport').evaluate((node, left) => {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, pointerType: 'touch', clientX: left ? 250 : 50, clientY: 100 }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, pointerType: 'touch', clientX: left ? 50 : 250, clientY: 110 }));
  }, left);
  await swipe(true); await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
  await swipe(false); await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('orbits');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('[data-visual-quick=nature]').click(); await page.locator('#visual-dock-fullscreen').click();
  await swipe(true); await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('nature:forest-slope');
  await page.keyboard.press('Escape'); await expect(page.locator('#status')).toHaveText('● Listening');
});

test('double-click toggles fullscreen and idle controls wake on movement and keyboard focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('[data-visual-quick=calm]').click();
  await page.locator('#visual-dock .scene-drawing').dblclick();
  const stage = page.getByRole('dialog', { name: 'Immersive visualization', exact: true });
  const toolbar = stage.locator('.scene-stage-tools');
  await expect(stage).toBeVisible();
  await expect(toolbar).toHaveCSS('opacity', '0');
  await stage.dispatchEvent('pointermove', { clientX: 100, clientY: 150 });
  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect(toolbar).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await expect(stage.getByRole('button', { name: 'Previous visual', exact: true })).toBeFocused();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await stage.locator('.scene-drawing').dblclick();
  await expect(stage).not.toBeVisible();
  await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('fullscreen control preference persists and ambient light supports double-click', async ({ page }) => {
  await page.goto('/'); await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Hide fullscreen controls when idle').uncheck();
  await page.reload(); await page.getByRole('switch', { name: 'Ambient light' }).check();
  await expect(page.getByLabel('Hide fullscreen controls when idle')).not.toBeChecked();
  await page.locator('.visual-dock-light').dblclick();
  const stage = page.getByRole('dialog', { name: 'Immersive ambient light', exact: true });
  await expect(stage).toBeVisible();
  await expect(stage).not.toHaveClass(/controls-auto-hide/);
  await stage.locator('.light-field').dblclick();
  await expect(stage).not.toBeVisible();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('touch devices keep fullscreen controls visible while idle', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:5173/');
    expect(await page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches)).toBe(true);
    await page.locator('[data-visual-quick=calm]').click(); await page.locator('#visual-dock-fullscreen').click();
    const stage = page.locator('.scene-stage');
    await expect(stage).not.toHaveClass(/controls-awake/);
    for (const toolbar of await stage.locator('.immersive-toolbar').all()) await expect(toolbar).toHaveCSS('opacity', '1');
    await stage.getByRole('button', { name: 'Close visualization (Esc)', exact: true }).click();
    await expect(stage).not.toBeVisible();
  } finally { await context.close(); }
});

for (const kind of ['scene', 'light'] as const) {
  test(`${kind} cannot reopen while emergency fullscreen exit is still pending`, async ({ page }) => {
    await page.addInitScript(() => {
      let current: Element | null = null, defer = true;
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
      Element.prototype.requestFullscreen = async function () { current = this; document.dispatchEvent(new Event('fullscreenchange')); };
      document.exitFullscreen = async () => {
        const exit = () => { current = null; document.dispatchEvent(new Event('fullscreenchange')); };
        if (!defer) { exit(); return; }
        await new Promise<void>(resolve => { (window as any).finishFullscreenExit = () => { defer = false; exit(); resolve(); }; });
      };
    });
    await page.goto('/');
    if (kind === 'scene') await page.locator('[data-visual-quick=calm]').click();
    else await page.getByRole('switch', { name: 'Ambient light' }).check();
    await page.locator('#visual-dock-fullscreen').click();
    const stage = page.locator(kind === 'scene' ? '.scene-stage' : '.light-stage');
    await expect(stage).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await page.keyboard.press('Shift+Escape'); await expect(stage).not.toBeVisible();
    if (kind === 'light') await page.getByRole('switch', { name: 'Ambient light' }).check();
    await page.locator('#visual-dock-fullscreen').click();
    if (kind === 'light') await page.locator('#light-fullscreen').click();
    await expect(stage).not.toBeVisible();
    await page.evaluate(() => (window as any).finishFullscreenExit());
    if (kind === 'scene') await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
    await page.locator('#visual-dock-fullscreen').click(); await expect(stage).toBeVisible();
    await page.keyboard.press('Escape'); await expect(stage).not.toBeVisible();
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} visual controls wrap without clipped labels at sidebar and mobile widths`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' }); await page.goto('/');
    await page.locator('[data-visual-quick=milkdrop]').click();
    for (const width of [1280, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const clipped = await page.locator('.scene-navigation button, #milkdrop-controls .visual-toggle, #visual-dock .visual-toggle').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
      expect(clipped, `${width}px clipped labels`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(accessibility.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
    await page.locator('#milkdrop-controls').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/visual-controls-${colorScheme}-${test.info().project.name}.png` });
  });
}
