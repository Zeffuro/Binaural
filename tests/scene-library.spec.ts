import { expect, test } from '@playwright/test';

test('MilkDrop is opt-in, all six presets render, and pause/reduced motion freeze frames', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await expect(page.locator('#scene-status')).toContainText('Enable MilkDrop');
  const canvas = page.locator('.scene-milkdrop');
  const settleLayout = () => canvas.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(canvas).not.toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-frames');
  await page.getByLabel('Enable MilkDrop visuals').check();
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute('data-frames'), { timeout: 15000 }).not.toBeNull();
  await page.getByLabel('Animate without audio').check();
  const ids = await page.locator('#milkdrop-preset option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(ids).toHaveLength(6);
  for (const id of ids) {
    await page.getByLabel('MilkDrop preset').selectOption(id);
    await expect(canvas).toHaveAttribute('data-preset', id);
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(4);
    await canvas.scrollIntoViewIfNeeded();
    await canvas.screenshot({ path: `test-results/milkdrop-${id}-${test.info().project.name}.png` });
    await expect(page.locator('#scene-credit')).toContainText('MIT');
  }
  await page.getByLabel('Animate without audio').uncheck();
  await settleLayout();
  const frozen = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frames', frozen!);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => canvas.getAttribute('data-frames')).not.toBe(frozen);
  await expect(canvas).toHaveAttribute('data-audio', 'mix');
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await settleLayout();
  const paused = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frames', paused!);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Animate without audio').check();
  await settleLayout();
  const reduced = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frames', reduced!);
  await page.getByLabel('Enable MilkDrop visuals').uncheck();
  await expect(canvas).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('all nature photographs render, turn, and load only same-origin assets', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url()); });
  await page.goto('/');
  for (const id of ['forest-slope', 'mountain-dawn', 'autumn-meadow']) {
    await page.getByLabel('Scene', { exact: true }).selectOption(`nature:${id}`);
    await expect(page.locator('#scene-status')).toContainText('Use Look around');
    const canvas = page.locator('.scene-panorama');
    await expect(canvas).toBeVisible();
    await expect(page.locator('#scene-credit')).toContainText('CC0');
    const start = await canvas.getAttribute('data-yaw');
    await page.getByLabel('Look around').fill('90');
    await expect.poll(() => canvas.getAttribute('data-yaw')).not.toBe(start);
    await page.getByLabel('Look around').fill('0');
    await canvas.scrollIntoViewIfNeeded();
    await canvas.screenshot({ path: `test-results/nature-${id}-${test.info().project.name}.png` });
    await page.getByLabel('Animate without audio').check();
    const before = await canvas.getAttribute('data-yaw');
    await expect.poll(() => canvas.getAttribute('data-yaw')).not.toBe(before);
    await page.getByLabel('Animate without audio').uncheck();
    const still = await canvas.getAttribute('data-yaw');
    await page.waitForTimeout(100);
    await expect(canvas).toHaveAttribute('data-yaw', still!);
  }
  expect(external).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('WebGL failure keeps photography usable and reports MilkDrop availability', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('nature:forest-slope');
  await expect(page.locator('.scene-nature-flat')).toBeVisible();
  await expect(page.locator('#scene-status')).toContainText('flat view');
  await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
  await page.getByLabel('Enable MilkDrop visuals').check();
  await expect(page.locator('#scene-status')).toContainText('WebGL 2');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
});

test('interrupted nature graphics fall back even during a pending decode', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('nature:forest-slope');
  await expect(page.locator('#scene-status')).toContainText('Use Look around');
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function() { await new Promise(resolve => setTimeout(resolve, 200)); await decode.call(this); };
  });
  await page.getByLabel('Scene', { exact: true }).selectOption('nature:mountain-dawn');
  await page.locator('.scene-panorama').evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('.scene-nature-flat')).toBeVisible();
  await expect(page.locator('#scene-status')).toContainText('flat view');
  await page.getByLabel('Scene', { exact: true }).selectOption('water');
  await expect(page.locator('.scene-drawing')).toBeVisible();
});

test('output snapshots preserve separate ears for MilkDrop without changing playback', async ({ page }) => {
  await page.goto('/');
  await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath); const { initialSession } = await import(modelPath);
    const engine = new AudioEngine(); const session = initialSession();
    session.ambient = 'none'; session.layers[0].route = 'left'; session.master = 1;
    await engine.start(session); await new Promise(resolve => setTimeout(resolve, 250));
    const frame = engine.visualFrame()!;
    const range = (data: Uint8Array) => Math.max(...data) - Math.min(...data);
    const result = { left: range(frame.left), right: range(frame.right) };
    await engine.pause(); const before = engine.visualFrame()!.time;
    await new Promise(resolve => setTimeout(resolve, 100));
    const frozen = engine.visualFrame()!.time === before; await engine.stop();
    return { ...result, frozen };
  });
  expect(result.left).toBeGreaterThan(5); expect(result.right).toBe(0); expect(result.frozen).toBe(true);
});
