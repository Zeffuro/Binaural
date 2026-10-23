import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

test('all fifteen generated ASMR triggers produce distinct bounded seamless PCM', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const path = '/src/audio/asmr-synthesis.ts', statePath = '/src/asmr-state.ts';
    const { asmrSample } = await import(path); const { generatedAsmrSounds } = await import(statePath);
    return generatedAsmrSounds.map(({ id }: { id: string }) => {
      const sample: Float32Array = asmrSample(id); let sum = 0, peak = 0, hash = 0;
      for (let i = 0; i < sample.length; i++) { sum += sample[i] ** 2; peak = Math.max(peak, Math.abs(sample[i])); if (i % 127 === 0) hash += sample[i] * (i % 97); }
      return { id, rms: Math.sqrt(sum / sample.length), peak, first: sample[0], last: sample.at(-1), hash, same: sample === asmrSample(id) };
    });
  });
  expect(results).toHaveLength(15); expect(new Set(results.map((result: { hash: number }) => result.hash)).size).toBe(15);
  const added = ['fingertip-taps', 'keyboard', 'comb', 'fabric', 'rain-stick', 'soft-clicks'];
  for (const result of results) { expect(result.rms).toBeGreaterThan(added.includes(result.id) ? .001 : .025); expect(result.peak).toBeLessThanOrEqual(.701); expect(Math.abs(result.first)).toBe(0); expect(Math.abs(result.last)).toBe(0); expect(result.same).toBe(true); }
});

test('ASMR stereo routing, sweep direction, mute/solo and six-layer headroom render correctly', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', statePath = '/src/asmr-state.ts';
    const { AsmrMixer } = await import(mixerPath); const { makeAsmrLayer } = await import(statePath);
    const layer = (values = {}) => ({ ...makeAsmrLayer('air'), level: 1, tone: .5, ...values });
    async function render(layers: unknown[], seconds = 2.5) {
      const context = new OfflineAudioContext(2, Math.round(24000 * seconds), 24000);
      new AsmrMixer(context, context.destination).update({ level: 1, layers });
      const buffer = await context.startRendering(); return [buffer.getChannelData(0), buffer.getChannelData(1)];
    }
    const rms = (data: Float32Array, start = .3, end = 2) => {
      let sum = 0; for (let i = Math.round(start * 24000); i < end * 24000; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / ((end - start) * 24000));
    };
    const left = await render([layer({ motion: 'still', pan: -1 })]);
    const right = await render([layer({ motion: 'still', pan: 1 })]);
    const sweep = await render([layer({ motion: 'sweep', period: 2, width: 1 })]);
    const muted = await render([layer({ muted: true })]);
    const soloLayer = layer({ motion: 'still', pan: -.2, solo: true });
    const solo = await render([soloLayer, layer({ sound: 'glass', pan: 1 })]);
    const single = await render([soloLayer]);
    const six = await render(Array.from({ length: 6 }, () => layer({ motion: 'still' })));
    let peak = 0, soloError = 0;
    for (let channel = 0; channel < 2; channel++) for (let i = 8000; i < six[channel].length; i++) {
      peak = Math.max(peak, Math.abs(six[channel][i])); soloError = Math.max(soloError, Math.abs(solo[channel][i] - single[channel][i]));
    }
    return { left: left.map(data => rms(data)), right: right.map(data => rms(data)), muted: muted.map(data => rms(data)),
      sweepRight: sweep.map(data => rms(data, .3, .7)), sweepLeft: sweep.map(data => rms(data, 1.3, 1.7)), peak, soloError };
  });
  expect(result.left[0]).toBeGreaterThan(.01); expect(result.left[1]).toBeLessThan(.000001);
  expect(result.right[1]).toBeGreaterThan(.01); expect(result.right[0]).toBeLessThan(.000001);
  expect(result.sweepRight[1]).toBeGreaterThan(result.sweepRight[0] * 4);
  expect(result.sweepLeft[0]).toBeGreaterThan(result.sweepLeft[1] * 4);
  expect(Math.max(...result.muted)).toBeLessThan(.000001); expect(result.soloError).toBeLessThan(.000001);
  expect(result.peak).toBeGreaterThan(.1); expect(result.peak).toBeLessThan(.7);
});

test('ASMR follows pause, live edits and the audio-clock stop gate; expired edits cannot restart voices', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession();
    session.minutes = .025; session.master = 1; session.tonesMuted = true; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1 }] };
    await engine.start(session);
    const context: AudioContext = engine.context, analyzer = context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
    const read = () => { const data = new Float32Array(2048); analyzer.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
    await waitForAudioTime(context, .55); const before = read();
    await engine.pause(); const frozen = context.currentTime; await new Promise(resolve => setTimeout(resolve, 150)); const paused = context.currentTime === frozen;
    await engine.resume(); session.asmr.layers[0].pan = 1; engine.update(session);
    await waitForAudioTime(context, 1.7); const after = read();
    session.asmr.layers.push(makeAsmrLayer('wood')); engine.update(session);
    await waitForAudioTime(context, context.currentTime + .18); const expired = read(), voices = engine.asmr.voices.size;
    await engine.stop(); return { before, paused, after, expired, voices, playing: engine.playing };
  });
  expect(result.before).toBeGreaterThan(.001); expect(result.paused).toBe(true); expect(result.after).toBe(0); expect(result.expired).toBe(0); expect(result.voices).toBe(0); expect(result.playing).toBe(false);
});

test('ASMR schema is bounded and legacy sessions still load; WAV contains the actual stereo mixer', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', exportPath = '/src/audio/export.ts', presetPath = '/src/asmr-presets.ts';
    const { makeAsmrLayer, parseAsmr } = await import(statePath), { initialSession, parseSession } = await import(modelPath);
    const { renderWav } = await import(exportPath), { asmrPresets } = await import(presetPath);
    const valid = { level: 1, layers: [{ ...makeAsmrLayer('air'), motion: 'still', pan: -1, level: 1 }] };
    const bad: unknown[] = [null, { ...valid, level: Infinity }, { ...valid, layers: Array(7).fill(valid.layers[0]) }];
    for (const [field, value] of [['sound', 'unknown'], ['motion', 'unknown'], ['pan', 2], ['period', 0], ['tone', '1'], ['rate', NaN], ['pressure', 2], ['pressurePhase', 361], ['muted', 1], ['solo', 'false']]) bad.push({ ...valid, layers: [{ ...valid.layers[0], [field as string]: value }] });
    const rejected = bad.every(value => { try { parseAsmr(value); return false; } catch { return true; } });
    const session = initialSession(); session.tonesMuted = true; session.ambient = 'none'; session.master = 1; session.asmr = valid;
    const blob = await renderWav(session, 1), view = new DataView(await blob.arrayBuffer()); let left = 0, right = 0;
    for (let i = 44 + 22050 * 4; i < view.byteLength; i += 4) { left += Math.abs(view.getInt16(i, true)); right += Math.abs(view.getInt16(i + 2, true)); }
    return { rejected, legacy: parseSession(initialSession()).asmr === undefined, presets: asmrPresets.map((preset: { make: () => unknown }) => parseAsmr(preset.make()).layers.length), left, right };
  });
  expect(result.rejected).toBe(true); expect(result.legacy).toBe(true);
  expect(result.presets).toHaveLength(73); expect(result.presets.every((count: number) => count >= 1 && count <= 6)).toBe(true);
  expect(result.left).toBeGreaterThan(10000); expect(result.right).toBe(0);
});

test('whole BWGen mute silences native noise and restores it without muting ASMR', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async data => {
    const enginePath = '/src/audio/engine.ts', importPath = '/src/import/bwg.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath), { importBwg } = await import(importPath), { makeAsmrLayer } = await import(statePath), { parseSession } = await import(modelPath);
    const engine = new AudioEngine(), session = importBwg(new Uint8Array(data)).session;
    session.master = 1; session.tonesMuted = true;
    await engine.start(session);
    const context: AudioContext = engine.context, analyzer = context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
    const read = () => { const samples = new Float32Array(2048); analyzer.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs)); };
    await new Promise(resolve => setTimeout(resolve, 600)); const native = read();
    session.bwgMuted = true; const muteAt = context.currentTime; engine.update(session);
    await new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 3000;
      const tick = () => {
        if (context.currentTime >= muteAt + .55) resolve();
        else if (performance.now() > deadline) reject(new Error('The live audio clock stopped while muting.'));
        else setTimeout(tick, 20);
      };
      tick();
    });
    const muted = read();
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1 }] }; engine.update(session);
    await new Promise(resolve => setTimeout(resolve, 350)); const asmr = read();
    session.asmr.layers = []; session.bwgMuted = false; engine.update(session);
    await new Promise(resolve => setTimeout(resolve, 350)); const restored = read();
    const parsed = parseSession({ ...session, bwgMuted: true }).bwgMuted;
    let malformed = false; try { parseSession({ ...session, bwgMuted: 'yes' }); } catch { malformed = true; }
    await engine.stop(); return { native, muted, asmr, restored, parsed, malformed };
  }, makeBwgFixture(undefined, {
    5: [{ value: 5000, position: 0 }, { value: 5000, position: 10000 }],
    6: [{ value: 5000, position: 0 }, { value: 5000, position: 10000 }],
  }));
  expect(result.native).toBeGreaterThan(.001); expect(result.muted).toBeLessThan(.00001); expect(result.asmr).toBeGreaterThan(.001); expect(result.restored).toBeGreaterThan(.001); expect(result.parsed).toBe(true); expect(result.malformed).toBe(true);
});
