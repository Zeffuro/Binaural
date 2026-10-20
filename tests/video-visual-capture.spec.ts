import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { VisualCapture } from '../src/visual-capture';
import type { setupVisuals } from '../src/visuals';

declare global {
  interface Window {
    videoVisualTest: {
      visuals: ReturnType<typeof setupVisuals>;
      capture?: VisualCapture;
      make(width?: number, height?: number): void;
      pixels(): { hash: number; colors: number; width: number; height: number; corner: number[]; center: number[] };
    };
  }
}

async function mount(page: Page): Promise<void> {
  await page.goto('/credits.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="transport"></div><div id="visual-controls"></div><style>.scene-viewport { width:640px;height:360px;position:relative }.scene-viewport>canvas,.scene-media {width:100%;height:100%}[hidden]{display:none!important}</style>';
    const path = '/src/visuals.ts';
    const { setupVisuals } = await import(path) as typeof import('../src/visuals');
    const waveform = Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(Math.sin(i / 12) * 50));
    const frequency = new Uint8Array(512).fill(150);
    const visuals = setupVisuals(() => ({ waveform, frequency, left: waveform, right: waveform, time: 0 }));
    window.videoVisualTest = { visuals,
      make(width = 320, height = 180) {
        this.capture?.dispose(); this.capture = undefined;
        this.capture = visuals.createCapture(width, height, 30);
      },
      pixels() {
        const capture = this.capture!; capture.draw(); const canvas = capture.canvas;
        const ctx = canvas.getContext('2d')!, bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261; const colors = new Set<number>();
        for (let i = 0; i < bytes.length; i += 4) { hash = Math.imul(hash ^ bytes[i] ^ (bytes[i + 1] << 8) ^ (bytes[i + 2] << 16), 16777619); colors.add(bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16); }
        return { hash, colors: colors.size, width: canvas.width, height: canvas.height,
          corner: [...ctx.getImageData(0, 0, 1, 1).data], center: [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data] };
      },
    };
  });
}

const choose = (page: Page, scene: string) => page.locator('#scene-mode').selectOption(scene);
const make = (page: Page, width = 320, height = 180) => page.evaluate(({ width, height }) => window.videoVisualTest.make(width, height), { width, height });
const pixels = (page: Page) => page.evaluate(() => window.videoVisualTest.pixels());
const settleMotion = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const failure = (page: Page) => page.evaluate(() => {
  try { window.videoVisualTest.make(); return ''; } catch (error) { return String(error); }
});

test('all ordinary scene families capture at requested dimensions with no UI and stop safely', async ({ page }) => {
  await mount(page);
  for (const scene of ['spectrum', 'scope', 'orbits', 'aurora', 'water']) {
    await choose(page, scene); await make(page, 640, 360);
    const result = await pixels(page);
    expect(result).toMatchObject({ width: 640, height: 360 }); expect(result.colors).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.videoVisualTest.capture!.canvas.isConnected)).toBe(false);
    await page.evaluate(() => window.videoVisualTest.capture!.dispose());
  }
  const disposed = await page.evaluate(() => {
    const capture = window.videoVisualTest.capture!; capture.dispose();
    try { capture.draw(); return ''; } catch (error) { return String(error); }
  });
  expect(disposed).toContain('disposed');
});

test('Off, missing local media and both explicit consent gates reject without enabling', async ({ page }) => {
  await mount(page); expect(await failure(page)).toContain('Choose a visual');
  await choose(page, 'local'); expect(await failure(page)).toContain('ready local');
  for (const [scene, input, message] of [['milkdrop', '#milkdrop-enable', 'Enable MilkDrop'], ['triggers', '#trigger-enable', 'Enable light triggers']]) {
    await choose(page, scene); expect(await failure(page)).toContain(message);
    await expect(page.locator(input)).not.toBeChecked();
  }
  await page.evaluate(() => window.videoVisualTest.visuals.applyTrigger('prism-lantern'));
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
  expect(await failure(page)).toContain('Enable light triggers');
});

test('trigger styles capture only with live consent and revoke an existing lease', async ({ page }) => {
  await mount(page); await choose(page, 'triggers'); await page.locator('#trigger-enable').check();
  const hashes: number[] = [];
  for (const preset of ['prism-lantern', 'red-scan', 'soft-torch']) {
    await page.locator('#trigger-preset').selectOption(preset); await make(page);
    const result = await pixels(page); hashes.push(result.hash); expect(result.colors).toBeGreaterThan(5);
  }
  expect(new Set(hashes).size).toBe(3);
  await page.locator('#trigger-enable').uncheck();
  const error = await page.evaluate(() => {
    try { window.videoVisualTest.capture!.draw(); return ''; } catch (error) { return String(error); }
  });
  expect(error).toContain('Enable light triggers');
});

test('ambient light captures its current gradient, follows playback and freezes for reduced motion', async ({ page }) => {
  await mount(page); await page.locator('#visuals').check(); await page.locator('#visual-mode').selectOption('cycle');
  await page.locator('#visual-mode').dispatchEvent('input');
  await make(page); const initial = await pixels(page); expect(initial.colors).toBeGreaterThan(5);
  await page.evaluate(() => window.videoVisualTest.visuals.transport(true));
  await expect.poll(async () => (await pixels(page)).hash).not.toBe(initial.hash);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settleMotion(page);
  const reduced = await pixels(page); await page.waitForTimeout(150); expect((await pixels(page)).hash).toBe(reduced.hash);
  await page.locator('#visuals').uncheck();
  const error = await page.evaluate(() => {
    try { window.videoVisualTest.capture!.draw(); return ''; } catch (error) { return String(error); }
  });
  expect(error).toContain('Choose a visual');
});

test('capture animates offscreen and behind a modal, keeps dimensions through resize and restores suspension', async ({ page }) => {
  await mount(page); await choose(page, 'aurora');
  await page.evaluate(() => {
    window.videoVisualTest.visuals.transport(true);
    const dock = document.querySelector<HTMLElement>('#visual-dock')!; dock.style.position = 'absolute'; dock.style.top = '10000px';
    const modal = document.createElement('dialog'); modal.textContent = 'Export controls'; document.body.append(modal); modal.showModal();
  });
  await page.waitForTimeout(100); await make(page, 640, 360); const start = await pixels(page);
  await expect.poll(async () => (await pixels(page)).hash).not.toBe(start.hash);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await pixels(page)).toMatchObject({ width: 640, height: 360 });
  await page.evaluate(() => window.videoVisualTest.capture!.dispose());
  await page.waitForTimeout(100);
  const frozen = await page.locator('.scene-drawing').getAttribute('data-frame');
  await page.waitForTimeout(150); await expect(page.locator('.scene-drawing')).toHaveAttribute('data-frame', frozen!);
});

test('reduced motion and hidden tabs freeze active capture without starting independent motion', async ({ page }) => {
  await mount(page); await choose(page, 'aurora'); await make(page);
  const paused = await pixels(page); await page.waitForTimeout(100); expect((await pixels(page)).hash).toBe(paused.hash);
  await page.evaluate(() => window.videoVisualTest.visuals.transport(true));
  await expect.poll(async () => (await pixels(page)).hash).not.toBe(paused.hash);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settleMotion(page); const reduced = await pixels(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100); expect((await pixels(page)).hash).toBe(reduced.hash);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settleMotion(page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await pixels(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100); expect((await pixels(page)).hash).toBe(hidden.hash);
  await page.evaluate(() => { delete (document as unknown as Record<string, unknown>).hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => (await pixels(page)).hash).not.toBe(hidden.hash);
  await expect(page.locator('#scene-independent')).not.toBeChecked();
});

test('local photo and video capture aspect fit, preserve live motion and fail when removed', async ({ page }) => {
  await mount(page);
  await page.locator('#scene-file').setInputFiles({ name: 'portrait.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="100"><rect width="40" height="100" fill="#ff0000"/></svg>') });
  await expect(page.locator('#scene-mode')).toHaveValue('local'); await make(page);
  const photo = await pixels(page); expect(photo.corner).toEqual([8, 23, 20, 255]); expect(photo.center).toEqual([255, 0, 0, 255]);
  await page.locator('#scene-file').setInputFiles(fileURLToPath(new URL('./fixtures/moodscape.webm', import.meta.url)));
  await expect(page.locator('.scene-media video')).toHaveCount(1); await make(page);
  const still = await pixels(page); expect(still.center[3]).toBe(255); expect(still.center.slice(0, 3)).not.toEqual([8, 23, 20]);
  const video = page.locator('.scene-media video'), start = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.evaluate(() => window.videoVisualTest.visuals.transport(true));
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(start);
  await pixels(page);
  await page.locator('#scene-clear').click();
  expect(await failure(page)).toContain('Choose a visual');
});

test('MilkDrop captures fresh WebGL frames or reports unavailable graphics', async ({ page }) => {
  test.setTimeout(60000); await mount(page); await choose(page, 'milkdrop'); await page.locator('#milkdrop-enable').check();
  await page.locator('#visual-quality').selectOption('eco');
  const supported = await page.locator('.scene-milkdrop').evaluate((canvas: HTMLCanvasElement) => !!canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
  }));
  if (!supported) {
    expect(process.platform).toBe('win32'); expect(test.info().project.name).toBe('firefox');
    await expect(page.locator('#scene-status')).toContainText('MilkDrop needs WebGL 2');
    expect(await failure(page)).toContain('Wait for this scene');
    await expect(page.locator('#milkdrop-enable')).toBeChecked();
    await choose(page, 'aurora'); await make(page); expect((await pixels(page)).colors).toBeGreaterThan(5);
    return;
  }
  await expect.poll(() => page.locator('.scene-milkdrop').getAttribute('data-frames'), { timeout: 20000 }).not.toBeNull();
  await make(page); const paused = await pixels(page);
  const pausedFrames = await page.locator('.scene-milkdrop').getAttribute('data-frames');
  expect(Number(pausedFrames)).toBeGreaterThan(0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settleMotion(page);
  expect((await pixels(page)).hash).toBe(paused.hash);
  await expect(page.locator('.scene-milkdrop')).toHaveAttribute('data-frames', pausedFrames!);
  await page.evaluate(() => { window.videoVisualTest.visuals.transport(true); document.querySelector<HTMLElement>('#visual-dock')!.style.display = 'none'; });
  await make(page, 640, 360);
  await expect.poll(async () => (await pixels(page)).colors).toBeGreaterThan(10);
  expect(await page.locator('.scene-milkdrop').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(640);
  const initial = await pixels(page); await expect.poll(async () => (await pixels(page)).hash).not.toBe(initial.hash);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settleMotion(page);
  const frozen = await pixels(page), frozenFrames = await page.locator('.scene-milkdrop').getAttribute('data-frames');
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.videoVisualTest.make(640, 360);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100); expect((await pixels(page)).hash).toBe(frozen.hash);
  await expect(page.locator('.scene-milkdrop')).toHaveAttribute('data-frames', frozenFrames!);
  await page.evaluate(() => document.querySelector<HTMLCanvasElement>('.scene-milkdrop')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await expect.poll(async () => page.evaluate(() => {
    try { window.videoVisualTest.capture!.draw(); return ''; } catch (error) { return String(error); }
  })).toContain('interrupted');
});

test('all panoramas capture fresh graphics and source changes fail while pending', async ({ page }) => {
  await mount(page);
  await choose(page, 'aurora'); await make(page);
  let requested!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/moodscapes/forest-slope.webp', async route => { requested(); await gate; await route.continue(); });
  await choose(page, 'nature:forest-slope');
  await pending;
  try {
    const changed = await page.evaluate(() => {
      try { window.videoVisualTest.capture!.draw(); return ''; } catch (error) { return String(error); }
    });
    expect(changed).toContain('Wait for this scene');
    expect(await failure(page)).toContain('Wait for this scene');
  } finally { release(); }
  await expect(page.locator('#scene-status')).toContainText('Use Look around');
  await page.unroute('**/moodscapes/forest-slope.webp');
  for (const scene of ['forest-slope', 'mountain-dawn', 'autumn-meadow']) {
    await choose(page, `nature:${scene}`); await expect(page.locator('#scene-status')).toContainText('Use Look around');
    await make(page); expect((await pixels(page)).colors).toBeGreaterThan(50);
    const first = await pixels(page);
    await page.locator('#nature-direction').evaluate((input: HTMLInputElement) => {
      input.value = String((Number(input.value) + 90) % 360); input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((await pixels(page)).hash).not.toBe(first.hash);
  }
});

test('flat photograph fallback captures and unreadable media surfaces an error', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await mount(page); await choose(page, 'nature:forest-slope'); await expect(page.locator('#scene-status')).toContainText('flat view');
  await make(page); expect((await pixels(page)).colors).toBeGreaterThan(50);
  const tainted = await page.evaluate(() => {
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() { throw new DOMException('Capture source is not origin-clean.', 'SecurityError'); };
    try { window.videoVisualTest.make(); return ''; } catch (error) { return String(error); }
    finally { CanvasRenderingContext2D.prototype.getImageData = read; }
  });
  expect(tainted).toContain('SecurityError');
  await choose(page, 'water'); await make(page); expect((await pixels(page)).colors).toBeGreaterThan(1);
});
