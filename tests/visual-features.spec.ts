import { expect, test } from '@playwright/test';

test('visual settings reject unknown options, nonfinite and out-of-range values and exclude unsafe flags', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/visual-state.ts';
    const { defaultVisualSettings, parseVisualSettings } = await import(path);
    const state = defaultVisualSettings();
    const candidates = [{ ...state, scene: 'https://external.test' }, { ...state, milkdropPreset: 'custom' }, { ...state, natureDirection: Infinity },
      { ...state, cycleSeconds: 0 }, { ...state, quality: 'extreme' }, { ...state, light: { ...state.light, color: { ...state.light.color, level: 101 } } }];
    return { rejected: candidates.map(value => { try { parseVisualSettings(value); return false; } catch { return true; } }),
      parsed: parseVisualSettings({ ...state, consent: true, independent: true, fullscreen: true, media: 'blob:private' }), state };
  });
  expect(result.rejected).toEqual([true, true, true, true, true, true]);
  expect(result.parsed).toEqual(result.state);
});

test('Quick Start exposes every scene family and keeps MilkDrop consent explicit', async ({ page }) => {
  await page.goto('/');
  const quick = page.getByRole('group', { name: 'Visual Quick Start' });
  for (const [name, scene] of [['Calm', 'aurora'], ['Reactive', 'spectrum'], ['Nature', 'nature:forest-slope'], ['MilkDrop', 'milkdrop'], ['Off', 'off']]) {
    await quick.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Scene', { exact: true })).toHaveValue(scene);
    await expect(page.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('experience state round-trips safely and restore never authorizes motion or emits user edits', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'visual-contract';
    frame.srcdoc = '<main class="transport"></main><div id="visual-controls"></div>'; document.body.append(frame);
  });
  const frame = page.frameLocator('#visual-contract');
  await expect(frame.locator('#visual-controls')).toHaveCount(1);
  const result = await (await page.locator('#visual-contract').elementHandle())!.contentFrame().then(context => context!.evaluate(async () => {
    const visualsPath = '/src/visuals.ts', statePath = '/src/visual-state.ts';
    const { setupVisuals } = await import(visualsPath), { defaultVisualSettings } = await import(statePath);
    let changes = 0; const visuals = setupVisuals(() => undefined, () => changes++);
    const saved = defaultVisualSettings(); saved.light = { enabled: true, color: { hue: 0, saturation: 0, level: 0 }, mode: 'cycle', speed: 120, studio: true };
    saved.scene = 'local'; saved.milkdropPreset = 'deep-blue'; saved.natureDirection = 270; saved.quality = 'eco'; saved.autoCycle = true; saved.cycleSeconds = 10; saved.blendSeconds = 5;
    (document.querySelector('#scene-independent') as HTMLInputElement).checked = true;
    (document.querySelector('#milkdrop-enable') as HTMLInputElement).checked = true;
    visuals.restore(saved);
    const state = visuals.getState(), restoredChanges = changes;
    const safe = !(document.querySelector('#scene-independent') as HTMLInputElement).checked && !(document.querySelector('#milkdrop-enable') as HTMLInputElement).checked && !document.querySelector('dialog[open]');
    const reselect = document.querySelector('#scene-status')!.textContent;
    visuals.transport(true); visuals.transport(false);
    const transportChanges = changes;
    document.querySelector<HTMLButtonElement>('[data-visual-quick="calm"]')!.click();
    const editChanges = changes;
    visuals.restore();
    return { saved, state, safe: Boolean(safe), reselect, restoredChanges, transportChanges, editChanges, defaults: visuals.getState(), expected: defaultVisualSettings() };
  }));
  expect(result.state).toEqual(result.saved);
  expect(result.safe).toBe(true);
  expect(result.reselect).toContain('Choose your local');
  expect(result.restoredChanges).toBe(0);
  expect(result.transportChanges).toBe(0);
  expect(result.editChanges).toBe(1);
  expect(result.defaults).toEqual(result.expected);
});

test('panorama dragging and keyboard turning have equivalent direction controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('nature:forest-slope');
  await expect(page.locator('#scene-status')).toContainText('Use Look around');
  const canvas = page.locator('.scene-panorama');
  await canvas.scrollIntoViewIfNeeded();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Look around')).toHaveValue('5');
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Look around')).toHaveValue('0');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5);
  await page.mouse.up();
  expect(Number(await page.getByLabel('Look around').inputValue())).toBeGreaterThan(5);
});

test('MilkDrop navigation blends, favorites persist and quality bounds canvas size', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await page.getByLabel('Enable MilkDrop visuals').check();
  const canvas = page.locator('.scene-milkdrop');
  await expect(canvas).toHaveAttribute('data-preset', 'liquid-beats', { timeout: 15000 });
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await expect(page.getByLabel('MilkDrop preset')).toHaveValue('deep-blue');
  await expect(canvas).toHaveAttribute('data-preset', 'deep-blue');
  await page.getByRole('button', { name: 'Previous preset' }).click();
  await expect(page.getByLabel('MilkDrop preset')).toHaveValue('liquid-beats');
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await expect(page.getByLabel('MilkDrop preset')).not.toHaveValue('liquid-beats');
  await page.locator('#milkdrop-favorite').click();
  const favorite = await page.getByLabel('MilkDrop preset').inputValue();
  await page.getByLabel('Visual quality').selectOption('eco');
  await expect.poll(() => canvas.evaluate(node => node.width)).toBeLessThanOrEqual(960);
  await page.reload();
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await page.getByLabel('MilkDrop preset').selectOption(favorite);
  await expect(page.locator('#milkdrop-favorite')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
});

test('PNG still captures an actual scene and immersive Escape preserves listening', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG still' }).click();
  expect((await download).suggestedFilename()).toBe('binaural-scene.png');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.getByRole('button', { name: 'Open visualization', exact: false }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Immersive visualization' })).not.toBeVisible();
  await expect(page.locator('#status')).toHaveText('● Listening');
});

test('automatic MilkDrop rotation follows active motion and freezes when motion is reduced', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await page.getByLabel('Enable MilkDrop visuals').check();
  const canvas = page.locator('.scene-milkdrop');
  await expect(canvas).toHaveAttribute('data-preset', 'liquid-beats', { timeout: 15000 });
  await page.getByLabel('Change every (seconds)').fill('10');
  await page.getByLabel('Automatically change presets').check();
  await page.getByLabel('Animate without audio').check();
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute('data-preset', 'deep-blue', { timeout: 18000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const frames = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(200);
  await expect(canvas).toHaveAttribute('data-frames', frames!);
  await expect(page.getByLabel('MilkDrop preset', { exact: true })).toHaveValue('deep-blue');
});

test('MilkDrop still capture never uses a previous nature fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      if (this.classList.contains('scene-panorama') && type.startsWith('webgl')) return null;
      return context.apply(this, [type, ...args] as Parameters<typeof context>);
    } as typeof context;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args: Parameters<typeof draw>) {
      document.documentElement.dataset.capturedSource = (args[0] as HTMLElement).className;
      return draw.apply(this, args);
    };
  });
  await page.goto('/'); await page.getByLabel('Scene', { exact: true }).selectOption('nature:forest-slope');
  await expect(page.locator('#scene-status')).toContainText('flat view');
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await page.getByLabel('Enable MilkDrop visuals').check();
  await expect(page.locator('.scene-milkdrop')).toHaveAttribute('data-preset', 'liquid-beats', { timeout: 15000 });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save PNG still' }).click(); await download;
  await expect(page.locator('html')).toHaveAttribute('data-captured-source', 'scene-milkdrop');
});
