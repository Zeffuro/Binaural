import { expect, test, type Page } from '@playwright/test';
import type { AudioEngine } from '../src/audio/engine';
import type { setupVisuals } from '../src/visuals';
import type { VisualCapture } from '../src/visual-capture';

declare global {
  interface Window {
    markerDemandTest: {
      visuals: ReturnType<typeof setupVisuals>;
      engine?: AudioEngine;
      captures: VisualCapture[];
      active: number;
      acquired: number;
      released: number;
      waveformReads: number;
      cueReads: number;
      markerBatches: number;
      signal: boolean;
    };
  }
}

async function mount(page: Page, live = false): Promise<void> {
  await page.goto('/credits.html');
  if (live) await page.locator('h1').click();
  await page.evaluate(async live => {
    document.body.innerHTML = '<div class="transport"></div><div id="visual-controls"></div><style>#scene-preview{position:fixed;top:0;right:0;width:320px;height:180px;pointer-events:none}.scene-viewport{width:320px;height:180px}.scene-drawing{width:100%;height:100%}[hidden]{display:none!important}</style>';
    const visualPath = '/src/visuals.ts', { setupVisuals } = await import(visualPath) as typeof import('../src/visuals');
    const state = window.markerDemandTest = { captures: [], active: 0, acquired: 0, released: 0,
      waveformReads: 0, cueReads: 0, markerBatches: 0, signal: false } as unknown as Window['markerDemandTest'];
    if (live) {
      const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', layerPath = '/src/asmr-state.ts';
      const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(layerPath);
      const session = initialSession(); session.mode = 'asmr'; session.minutes = 0; session.master = .7; session.ambient = 'none';
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('wood'), level: .8 }],
        variation: { mode: 'natural', seed: 731, amount: .35, phraseSeconds: 4, turnSeconds: 30 } };
      const original = window.AudioWorkletNode;
      window.AudioWorkletNode = new Proxy(original, { construct(target, args) {
        const node = Reflect.construct(target, args) as AudioWorkletNode;
        node.port.addEventListener('message', event => { if (Array.isArray(event.data.markers)) state.markerBatches++; });
        node.port.start(); return node;
      } });
      try { const engine = state.engine = new AudioEngine(); await engine.start(session); }
      finally { window.AudioWorkletNode = original; }
    }
    const waveform = Uint8Array.from({ length: 1024 }, (_, index) => 128 + Math.round(Math.sin(index / 12) * 50));
    state.visuals = setupVisuals((timeline, offsetMs, needCues) => {
      state.waveformReads++; if (needCues) state.cueReads++;
      const frame = state.engine ? state.engine.visualFrame(timeline, offsetMs, needCues) :
        { waveform, frequency: new Uint8Array(512).fill(150), left: waveform, right: waveform, time: performance.now() / 1000 };
      state.signal ||= !!frame?.waveform.some(value => value !== 128); return frame;
    }, () => {}, () => {}, () => {
      state.active++; state.acquired++; const release = state.engine?.requestVisualCues(); let released = false;
      return () => { if (released) return; released = true; state.active--; state.released++; release?.(); };
    });
    state.visuals.transport(true);
  }, live);
}

const demand = (page: Page, count: number) => expect.poll(() => page.evaluate(() => window.markerDemandTest.active)).toBe(count);
const choose = (page: Page, scene: string) => page.locator('#scene-mode').selectOption(scene);
const hidden = (page: Page, value: boolean) => page.evaluate(value => {
  if (value) Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  else delete (document as unknown as Record<string, unknown>).hidden;
  document.dispatchEvent(new Event('visibilitychange'));
}, value);
const onscreen = (page: Page, value: boolean) => page.locator('#scene-preview').evaluate((element, value) => {
  (element as HTMLElement).style.top = value ? '0' : '10000px';
}, value);
async function synced(page: Page): Promise<void> {
  await choose(page, 'triggers'); await page.locator('#trigger-sync-asmr').check();
  await page.locator('#trigger-enable').check(); await demand(page, 1);
}

test('visual cue demand follows scene, consent, sync, playback, visibility and reduced motion while waveform scenes remain active', async ({ page }) => {
  await mount(page); await demand(page, 0);
  for (const scene of ['spectrum', 'aurora', 'milkdrop']) {
    await choose(page, scene);
    if (scene === 'milkdrop') await page.locator('#milkdrop-enable').check();
    const before = await page.evaluate(() => window.markerDemandTest.waveformReads);
    await expect.poll(() => page.evaluate(() => window.markerDemandTest.waveformReads)).toBeGreaterThan(before);
    await demand(page, 0);
    expect(await page.evaluate(() => window.markerDemandTest.cueReads)).toBe(0);
  }
  await choose(page, 'triggers'); await page.locator('#trigger-sync-asmr').check(); await demand(page, 0);
  await page.locator('#trigger-enable').check(); await demand(page, 1);
  await page.locator('#trigger-sync-asmr').uncheck(); await demand(page, 0);
  await page.locator('#trigger-sync-asmr').check(); await demand(page, 1);
  await choose(page, 'off'); await demand(page, 0);
  await synced(page); await hidden(page, true); await demand(page, 0);
  await hidden(page, false); await demand(page, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await demand(page, 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await demand(page, 1);
  await onscreen(page, false); await demand(page, 0); await onscreen(page, true); await demand(page, 1);
  await page.evaluate(() => window.markerDemandTest.visuals.transport(false)); await demand(page, 0);
  await page.locator('#scene-independent').check(); await demand(page, 0);
  await page.evaluate(() => window.markerDemandTest.visuals.transport(true)); await demand(page, 1);
  await page.locator('#trigger-enable').uncheck(); await demand(page, 0);
  await page.evaluate(() => window.markerDemandTest.visuals.stop());
  const counts = await page.evaluate(() => ({ acquired: window.markerDemandTest.acquired, released: window.markerDemandTest.released }));
  expect(counts.acquired).toBeGreaterThan(5); expect(counts.released).toBe(counts.acquired);
});

test('capture owns cue demand independently offscreen and releases every lease on hidden, reduced, unsynced, Off, pause and disposal', async ({ page }) => {
  await mount(page); await synced(page);
  await page.evaluate(() => {
    const state = window.markerDemandTest;
    state.captures.push(state.visuals.createCapture(320, 180), state.visuals.createCapture(320, 180));
  });
  await demand(page, 3); await onscreen(page, false); await demand(page, 2);
  await page.evaluate(() => window.markerDemandTest.captures[0].dispose()); await demand(page, 1);
  await page.evaluate(() => window.markerDemandTest.captures[0].dispose()); await demand(page, 1);
  await hidden(page, true); await demand(page, 0); await hidden(page, false); await demand(page, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await demand(page, 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await demand(page, 1);
  await page.locator('#trigger-sync-asmr').uncheck(); await demand(page, 0);
  await page.locator('#trigger-sync-asmr').check(); await demand(page, 1);
  await choose(page, 'off'); await demand(page, 0);
  await choose(page, 'triggers'); await page.locator('#trigger-enable').check(); await demand(page, 1);
  await page.evaluate(() => window.markerDemandTest.visuals.transport(false)); await demand(page, 0);
  await page.evaluate(() => window.markerDemandTest.visuals.transport(true)); await demand(page, 1);
  await onscreen(page, true); await demand(page, 2);
  await page.evaluate(() => window.markerDemandTest.captures[1].dispose()); await demand(page, 1);
  await page.locator('#trigger-enable').uncheck(); await demand(page, 0);
  const counts = await page.evaluate(() => ({ acquired: window.markerDemandTest.acquired, released: window.markerDemandTest.released }));
  expect(counts.released).toBe(counts.acquired);
});

test('@live app cue demand starts and stops actual marker batches without interrupting ordinary waveform reads or another owner', async ({ page }) => {
  test.setTimeout(60_000); await mount(page, true);
  const settle = () => page.evaluate(async () => {
    const path = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(path);
    const context = (window.markerDemandTest.engine as unknown as { context: AudioContext }).context;
    await waitForAudioTime(context, context.currentTime + .2);
  });
  const batches = () => page.evaluate(() => window.markerDemandTest.markerBatches);
  try {
    await choose(page, 'spectrum'); await settle(); expect(await batches()).toBe(0);
    await expect.poll(() => page.evaluate(() => window.markerDemandTest.signal)).toBe(true);
    await synced(page); await expect.poll(batches).toBeGreaterThan(0);
    await page.evaluate(() => window.markerDemandTest.captures.push(window.markerDemandTest.visuals.createCapture(320, 180)));
    await onscreen(page, false); await demand(page, 1);
    const captured = await batches(); await expect.poll(batches).toBeGreaterThan(captured);
    await page.evaluate(() => window.markerDemandTest.captures[0].dispose()); await demand(page, 0);
    await settle(); const stopped = await batches(); await settle(); expect(await batches()).toBe(stopped);
    await onscreen(page, true); await demand(page, 1); await expect.poll(batches).toBeGreaterThan(stopped);
    await choose(page, 'spectrum'); await demand(page, 0); await settle(); const reactive = await batches();
    const reads = await page.evaluate(() => window.markerDemandTest.waveformReads);
    await settle(); expect(await batches()).toBe(reactive);
    expect(await page.evaluate(() => window.markerDemandTest.waveformReads)).toBeGreaterThan(reads);
    await synced(page); const resumed = await batches(); await expect.poll(batches).toBeGreaterThan(resumed);
    await hidden(page, true); await demand(page, 0); await settle(); const invisible = await batches();
    await settle(); expect(await batches()).toBe(invisible);
  } finally {
    await page.evaluate(async () => { const state = window.markerDemandTest; state.captures.forEach(capture => capture.dispose()); state.visuals.stop(); await state.engine?.stop(); });
  }
});
