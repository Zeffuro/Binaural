import { expect, test } from '@playwright/test';

test('offline synthesis keeps frequencies and ear routing exact', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const modulePath = '/src/audio/graph.ts';
    const { ToneVoice } = await import(modulePath);
    const results = [];
    for (const route of ['binaural', 'mixed', 'left', 'right']) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      new ToneVoice(context, { id: 'test', name: 'test', left: 200, right: 210, level: 1, route }, context.destination, 1);
      const buffer = await context.startRendering();
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const amplitude = (data: Float32Array, hz: number): number => {
        let re = 0, im = 0;
        for (let i = 24000; i < 48000; i++) {
          re += data[i] * Math.cos(2 * Math.PI * hz * i / 48000);
          im += data[i] * Math.sin(2 * Math.PI * hz * i / 48000);
        }
        return 2 * Math.hypot(re, im) / 24000;
      };
      results.push({ route, left200: amplitude(channels[0], 200), left210: amplitude(channels[0], 210),
        right200: amplitude(channels[1], 200), right210: amplitude(channels[1], 210) });
    }
    return results;
  });
  const [binaural, mixed, left, right] = results;
  expect(binaural.left200).toBeCloseTo(0.22, 3);
  expect(binaural.right210).toBeCloseTo(0.22, 3);
  expect(binaural.left210).toBeLessThan(0.0001);
  expect(binaural.right200).toBeLessThan(0.0001);
  for (const value of [mixed.left200, mixed.left210, mixed.right200, mixed.right210]) expect(value).toBeCloseTo(0.11, 3);
  expect(left.left200).toBeCloseTo(0.22, 3);
  expect(left.right200 + left.right210).toBeLessThan(0.0001);
  expect(right.right210).toBeCloseTo(0.22, 3);
  expect(right.left200 + right.left210).toBeLessThan(0.0001);
});

test('all ten aligned tone layers retain headroom and stop on the audio clock', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/audio/graph.ts';
    const { ToneVoice } = await import(modulePath);
    const context = new OfflineAudioContext(2, 48000, 48000);
    for (let i = 0; i < 10; i++) {
      new ToneVoice(context, { id: String(i), name: 'test', left: 200, right: 210, level: 1, route: 'mixed' }, context.destination, 10, 0.75);
    }
    const buffer = await context.startRendering();
    let peak = 0, afterStop = 0;
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i > 36500) afterStop = Math.max(afterStop, Math.abs(data[i]));
      }
    }
    return { peak, afterStop };
  });
  expect(result.peak).toBeGreaterThan(0.2);
  expect(result.peak).toBeLessThanOrEqual(0.221);
  expect(result.afterStop).toBe(0);
});

test('timer gate silences tones, ambience, and looping music after live edits without a UI stop call', async ({ page }) => {
  await page.goto('/');
  await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts';
    const modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath);
    const { initialSession } = await import(modelPath);
    const engine = new AudioEngine();
    const session = initialSession();
    session.minutes = 0.03;
    session.master = 0.5;
    session.ambient = 'white';
    const wav = new ArrayBuffer(44 + 48000 * 2);
    const view = new DataView(wav);
    const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
    view.setUint32(40, wav.byteLength - 44, true);
    for (let i = 0; i < 48000; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 110 / 48000) * 10000, true);
    await engine.setMusic(new File([wav], 'test.wav', { type: 'audio/wav' }));
    await engine.start(session);
    // Observe the actual output, including the downstream scheduled gate.
    const context: AudioContext = engine.context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    engine.gate.connect(analyser);
    await new Promise(resolve => setTimeout(resolve, 200));
    await engine.pause();
    const pausedTime = context.currentTime;
    const pausedMusic = engine.music.currentTime;
    await new Promise(resolve => setTimeout(resolve, 300));
    if (context.currentTime !== pausedTime || !engine.music.paused || Math.abs(engine.music.currentTime - pausedMusic) > 0.01) {
      throw new Error('Pausing did not freeze the audio clock and local music.');
    }
    await engine.resume();
    await new Promise(resolve => setTimeout(resolve, 500));
    session.master = 0.4;
    session.ambientLevel = 1;
    engine.update(session);
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    const before = Math.max(...data.map(Math.abs));
    await new Promise(resolve => setTimeout(resolve, 1700));
    analyser.getFloatTimeDomainData(data);
    const after = Math.max(...data.map(Math.abs));
    const remaining = engine.remaining;
    await engine.stop();
    return { before, after, remaining };
  });
  expect(result.before).toBeGreaterThan(0.001);
  expect(result.after).toBeLessThan(0.00001);
  expect(result.remaining).toBe(0);
});
