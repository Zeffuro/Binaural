import { expect, test } from '@playwright/test';

test('rendered automation preserves segment frequencies and independent ear levels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const graphPath = '/src/audio/graph.ts';
    const { ToneVoice } = await import(graphPath);
    const context = new OfflineAudioContext(2, 96000, 48000);
    const points = (a: number, b: number) => [
      { time: 0, value: a, curve: 'step' }, { time: 1, value: a, curve: 'step' },
      { time: 1, value: b, curve: 'step' }, { time: 2, value: b, curve: 'step' },
    ];
    const layer = { id: 'timeline', name: 'Original test', left: 210, right: 200, level: 1, route: 'binaural',
      automation: { left: points(210, 310), right: points(200, 300), leftLevel: points(1, 0.5), rightLevel: points(0.25, 1) } };
    const voice = new ToneVoice(context, layer, context.destination, 1, 2, 0);
    voice.update(layer, 1);
    const buffer = await context.startRendering();
    const amplitude = (ear: number, hz: number, start: number) => {
      let re = 0, im = 0;
      const data = buffer.getChannelData(ear);
      for (let i = start; i < start + 24000; i++) {
        re += data[i] * Math.cos(2 * Math.PI * hz * i / 48000);
        im += data[i] * Math.sin(2 * Math.PI * hz * i / 48000);
      }
      return 2 * Math.hypot(re, im) / 24000;
    };
    return [amplitude(0, 210, 24000), amplitude(1, 200, 24000), amplitude(0, 310, 60000), amplitude(1, 300, 60000), amplitude(0, 210, 60000)];
  });
  expect(result[0]).toBeCloseTo(0.22, 3);
  expect(result[1]).toBeCloseTo(0.055, 3);
  expect(result[2]).toBeCloseTo(0.11, 3);
  expect(result[3]).toBeCloseTo(0.22, 3);
  expect(result[4]).toBeLessThan(0.0001);
});

test('automation persists in JSON and rejects missing duration and malformed curves', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/model.ts';
    const { parseSession, initialSession } = await import(path);
    const source = initialSession();
    source.timelineDuration = 10;
    const points = [{ time: 0, value: 200, curve: 'step' }, { time: 10, value: 300, curve: 'linear' }];
    source.layers[0].automation = { left: points, right: points, leftLevel: [{ time: 0, value: 1, curve: 'step' }], rightLevel: [{ time: 0, value: 0, curve: 'step' }] };
    const saved = parseSession(JSON.parse(JSON.stringify(source)));
    let missing = false, invalid = false;
    delete source.timelineDuration;
    try { parseSession(source); } catch { missing = true; }
    source.timelineDuration = 10;
    source.layers[0].automation.left[1].time = -1;
    try { parseSession(source); } catch { invalid = true; }
    source.layers[0].automation.left[1].time = 10;
    let badCurves = 0;
    for (const curve of [['linear'], { toString: () => 'linear' }, null, 1]) {
      source.layers[0].automation.left[1].curve = curve;
      try { parseSession(source); } catch { badCurves++; }
    }
    return { saved: saved.layers[0].automation.left.length, missing, invalid, badCurves };
  });
  expect(result).toEqual({ saved: 2, missing: true, invalid: true, badCurves: 4 });
});
