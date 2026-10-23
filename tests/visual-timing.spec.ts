import { expect, test } from '@playwright/test';

test('output clock maps valid device timestamps once and rejects unavailable, stale and invalid mappings', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/visual-timing.ts', { outputTime } = await import(path);
    const context = { currentTime: 10, sampleRate: 48000, baseLatency: .02, outputLatency: .08,
      getOutputTimestamp: () => ({ contextTime: 9.8, performanceTime: 990 }) };
    const mapped = outputTime(context, 1000), invalid = [];
    for (const stamp of [{ contextTime: 0, performanceTime: 0 }, { contextTime: 9.8, performanceTime: 500 },
      { contextTime: NaN, performanceTime: 990 }, { contextTime: 20, performanceTime: 990 },
      { contextTime: 1, performanceTime: 990 }, { contextTime: 9.8, performanceTime: 1010 }]) {
      context.getOutputTimestamp = () => stamp; invalid.push(outputTime(context, 1000));
    }
    context.getOutputTimestamp = () => { throw new Error('No device'); };
    const throwing = outputTime(context, 1000);
    const missing = outputTime({ ...context, getOutputTimestamp: undefined, outputLatency: undefined }, 1000);
    const bounded = outputTime({ ...context, baseLatency: 100, outputLatency: 100 }, 1000);
    const finite = outputTime({ ...context, baseLatency: NaN, outputLatency: Infinity }, 1000);
    return { mapped, invalid, throwing, missing, bounded, finite };
  });
  expect(result.mapped).toBeCloseTo(9.81, 8);
  for (const value of result.invalid) expect(value).toBeCloseTo(9.9, 8);
  expect(result.throwing).toBeCloseTo(9.9, 8); expect(result.missing).toBeCloseTo(9.98, 8);
  expect(result.bounded).toBe(8); expect(result.finite).toBe(10);
});

test('cue history compensates analysis windows and graph delay, copies snapshots and stays bounded across discontinuities', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/visual-timing.ts', { AsmrCueTimeline } = await import(path);
    const timeline = new AsmrCueTimeline(), cue = { id: 'brush', kind: 'brush', pan: -.8, strength: .8, progress: .3, contact: .4, time: 1 };
    timeline.push(1, [cue]); cue.pan = .8;
    const future = timeline.read(.97, 48000), old = timeline.read(1, 48000);
    old[0].pan = .2; const copied = timeline.read(1, 48000);
    timeline.push(1.1, [{ ...cue, time: 1.1 }]);
    const beforeBoundary = timeline.read(1.09, 48000), afterBoundary = timeline.read(1.1, 48000);
    timeline.push(1.1, []); const replaced = timeline.read(1.1, 48000);
    timeline.push(3, [cue]); const gap = timeline.read(1.1, 48000), stale = timeline.read(4, 48000);
    timeline.push(.5, [cue]); const reversed = timeline.frames.length;
    for (let index = 0; index < 1000; index++) timeline.push(.5 + index / 500, [cue]);
    const frames = timeline.frames.length; timeline.clear();
    return { future, copied, beforeBoundary, afterBoundary, replaced, gap, stale, reversed, frames, cleared: timeline.read(2, 48000) };
  });
  expect(result.future).toEqual([]); expect(result.copied[0].pan).toBe(-.8);
  expect(result.beforeBoundary[0].time).toBe(1); expect(result.afterBoundary[0].time).toBe(1.1);
  expect(result.replaced).toEqual([]); expect(result.gap).toEqual([]); expect(result.stale).toEqual([]);
  expect(result.reversed).toBe(1); expect(result.frames).toBeLessThanOrEqual(240); expect(result.cleared).toEqual([]);
});

test('@live output cues lag analysis by device time while video capture and audibility gates remain independent', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath);
    const { initialSession } = await import(modelPath), { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession();
    session.mode = 'asmr'; session.master = .5; session.ambient = 'none'; session.minutes = 0;
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), motion: 'still', level: .8 }] };
    await engine.start(session); const context = engine.context;
    Object.defineProperty(context, 'getOutputTimestamp', { value: () => ({
      contextTime: Math.max(0, context.currentTime - .16), performanceTime: performance.now() - 1,
    }) });
    await waitForAudioTime(context, .6);
    for (let index = 0; index < 30; index++) {
      engine.visualFrame('output'); await waitForAudioTime(context, context.currentTime + .015);
    }
    const raw = engine.visualFrame(), output = engine.visualFrame('output'), capture = engine.visualFrame('capture');
    const analysisTime = raw.asmr[0]?.time, outputTime = output.asmr[0]?.time, captureTime = capture.asmr[0]?.time;
    session.musicLevel = .2; session.master = .7; engine.update(session);
    const afterEdit = engine.visualFrame('output').asmr[0]?.time;
    session.master = 0; engine.update(session);
    const mute = ['analysis', 'output', 'capture'].map(target => engine.visualFrame(target).asmr.length);
    session.master = .5; engine.update(session);
    await engine.pause(); const paused = engine.visualFrame('output').asmr.length;
    await engine.resume(); const resumed = engine.visualFrame('output').asmr.length;
    await engine.stop(); const stopped = engine.visualFrame('output');
    return { analysisTime, outputTime, captureTime, afterEdit, mute, paused, resumed, stopped };
  });
  expect(result.analysisTime - result.outputTime).toBeGreaterThan(.12);
  expect(result.analysisTime - result.outputTime).toBeLessThan(.21);
  expect(Math.abs(result.analysisTime - result.captureTime)).toBeLessThan(.035);
  expect(result.afterEdit).toBeGreaterThan(0); expect(Math.abs(result.afterEdit - result.outputTime)).toBeLessThan(.035);
  expect(result.mute).toEqual([0, 0, 0]); expect(result.paused).toBe(0); expect(result.resumed).toBe(0); expect(result.stopped).toBeUndefined();
});

test('gesture capture uses its own timeline and keeps display, pause and reduced-motion poses intact', async ({ page }) => {
  await page.goto('/credits.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="transport"></div><div id="visual-controls"></div><style>.scene-viewport{width:640px;height:360px;position:relative}[hidden]{display:none!important}</style>';
    const path = '/src/visuals.ts', { setupVisuals } = await import(path), silence = new Uint8Array(1024).fill(128);
    const frame = { frequency: new Uint8Array(512), waveform: silence, left: silence, right: silence, time: 1 };
    const probe = { calls: [] as string[], capturePan: .8, visual: undefined as any, capture: undefined as any };
    probe.visual = setupVisuals((timeline: string) => {
      probe.calls.push(timeline); return { ...frame, asmr: [{ id: 'brush', kind: 'brush', strength: .8, contact: .4,
        progress: .3, pan: timeline === 'capture' ? probe.capturePan : -.8, time: 1 }] };
    });
    (window as any).timingCapture = probe;
  });
  await page.locator('#scene-mode').selectOption('triggers'); await page.locator('#trigger-enable').check();
  await page.locator('#trigger-preset').selectOption('gesture-brush');
  await page.evaluate(() => { const probe = (window as any).timingCapture; probe.visual.transport(true); probe.capture = probe.visual.createCapture(320, 180); });
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cue-pan', '-0.800');
  const pixels = () => page.evaluate(() => {
    const probe = (window as any).timingCapture; probe.capture.draw();
    const data = probe.capture.canvas.getContext('2d').getImageData(0, 0, 320, 180).data;
    let hash = 2166136261; for (const value of data) hash = Math.imul(hash ^ value, 16777619);
    return hash;
  });
  const first = await pixels();
  await page.evaluate(() => { (window as any).timingCapture.visual.transport(false); });
  expect(await pixels()).toBe(first);
  await page.evaluate(() => { (window as any).timingCapture.visual.transport(true); });
  await page.evaluate(() => { (window as any).timingCapture.capturePan = -.8; });
  await expect.poll(pixels).not.toBe(first);
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cue-pan', '-0.800');
  expect(await page.evaluate(() => (window as any).timingCapture.calls.includes('capture'))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const frozen = await pixels();
  await page.evaluate(() => { (window as any).timingCapture.capturePan = .5; });
  await page.waitForTimeout(160); expect(await pixels()).toBe(frozen);
  await page.evaluate(() => { (window as any).timingCapture.capture.dispose(); });
});
