import { expect, test } from '@playwright/test';
import type { AudioCaptureLease } from '../src/audio/engine';

test('ASMR variation migrates safely, rejects malformed values and plans bounded reproducible long-session phrases', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const variationPath = '/src/asmr-variation.ts', phrasePath = '/src/audio/asmr-phrases.ts';
    const statePath = '/src/asmr-state.ts', sourcePath = '/src/audio/asmr-phrase-source.ts';
    const { defaultAsmrVariation, parseAsmrVariation } = await import(variationPath);
    const { planAsmrPhrase, asmrTurn } = await import(phrasePath);
    const { makeAsmrLayer, parseAsmr } = await import(statePath), { phraseConfig } = await import(sourcePath);
    const variation = { ...defaultAsmrVariation(), mode: 'natural' };
    const invalid: unknown[] = [null, false, [], {}, { ...variation, mode: 'random' }];
    for (const [field, values] of Object.entries({ seed: [0, -1, 1.5, 2147483648, '731'], amount: [-.01, 1.01, NaN],
      phraseSeconds: [3.99, 30.01, Infinity], turnSeconds: [14.9, 600.1, '90'] })) {
      for (const value of values) invalid.push({ ...variation, [field]: value });
    }
    const rejected = invalid.every(value => { try { parseAsmrVariation(value); return false; } catch { return true; } });
    const settings = { level: .7, variation, layers: [makeAsmrLayer('brush'), makeAsmrLayer('wood')] };
    const parsed = parseAsmr(settings), config = phraseConfig(settings, 0), reparsed = phraseConfig(parsed, 0);
    const cells = [0, 1, 127, 4294967295, 4294967296, 1000000000000];
    const plans = cells.map(cell => planAsmrPhrase(config, cell, 12));
    const turns = Array.from({ length: 36 }, (_, index) => asmrTurn(731, index, [0, 2, 5]));
    return { rejected, defaults: parseAsmrVariation(undefined), legacy: parseAsmr({ level: .5, layers: [] }).variation,
      uuidChanged: parsed.layers[0].id !== settings.layers[0].id,
      same: cells.every(cell => JSON.stringify(planAsmrPhrase(config, cell, 12)) === JSON.stringify(planAsmrPhrase(reparsed, cell, 12))),
      distinct: new Set(plans.map(plan => `${plan.offset}:${plan.duration}:${plan.rate}`)).size,
      bounded: plans.every(plan => plan.duration > 0 && plan.duration < 12 && plan.fade > 0 && plan.fade <= plan.duration / 3 &&
        plan.offset >= 0 && plan.offset < 12 && plan.rate >= .88 && plan.rate <= 1.12 && plan.gain >= .65 && plan.gain <= 1),
      bags: Array.from({ length: 12 }, (_, index) => new Set(turns.slice(index * 3, index * 3 + 3)).size),
      changedSeed: JSON.stringify(planAsmrPhrase(config, 1, 12)) !== JSON.stringify(planAsmrPhrase({ ...config, variation: { ...variation, seed: 732 } }, 1, 12)) };
  });
  expect(result.rejected).toBe(true); expect(result.defaults).toEqual({ mode: 'steady', seed: 731, amount: .55, phraseSeconds: 12, turnSeconds: 90 });
  expect(result.legacy).toBeUndefined(); expect(result.uuidChanged).toBe(true); expect(result.same).toBe(true);
  expect(result.distinct).toBe(6); expect(result.bounded).toBe(true); expect(result.changedSeed).toBe(true);
  expect(result.bags.every((size: number) => size === 3)).toBe(true);
});

test('shared phrase renderer preserves exact stereo PCM at fractional rates, arbitrary section starts, quiet gaps and long turns', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const phrasePath = '/src/audio/asmr-phrases.ts', variationPath = '/src/asmr-variation.ts';
    const { AsmrPhraseRenderer, asmrTurn } = await import(phrasePath), { defaultAsmrVariation } = await import(variationPath);
    const sourceRate = 24000, rate = 44100, count = rate * 65;
    const pcm = { sampleRate: sourceRate, channels: [
      Float32Array.from({ length: sourceRate * 2 }, (_, frame) => .2 * Math.sin(frame * .071)),
      Float32Array.from({ length: sourceRate * 2 }, (_, frame) => .3 * Math.cos(frame * .043))] };
    let error = 0, stereoDifference = 0, quiet = 0, active = 0, changedSeed = 0, wrongTurn = 0;
    for (const mode of ['natural', 'turns']) for (const pace of [.7, 1.1]) {
      const variation = { ...defaultAsmrVariation(), mode, phraseSeconds: 7.3, turnSeconds: 17.1, amount: .9 };
      const config = { variation, ordinal: 0, eligible: [0, 1] }, full = [new Float32Array(count), new Float32Array(count)];
      new AsmrPhraseRenderer(pcm, config).render(full, rate, 0, pace);
      for (const start of [1, rate * 27, rate * 30, rate * 33 + 17, count - 8192]) {
        const output = [new Float32Array(4096), new Float32Array(4096)];
        new AsmrPhraseRenderer(pcm, config).render(output, rate, start, pace);
        for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < output[ear].length; frame++) {
          error = Math.max(error, Math.abs(full[ear][start + frame] - output[ear][frame]));
        }
      }
      const changed = [new Float32Array(count), new Float32Array(count)];
      new AsmrPhraseRenderer(pcm, { ...config, variation: { ...variation, seed: variation.seed + 1 } }).render(changed, rate, 0, pace);
      for (let frame = 0; frame < count; frame += 31) {
        const level = Math.abs(full[0][frame]) + Math.abs(full[1][frame]);
        if (level === 0) quiet++; else active++;
        stereoDifference = Math.max(stereoDifference, Math.abs(full[0][frame] - full[1][frame]));
        changedSeed = Math.max(changedSeed, Math.abs(full[0][frame] - changed[0][frame]));
        if (mode === 'turns' && asmrTurn(variation.seed, Math.floor(frame / rate / variation.turnSeconds), [0, 1]) !== 0 && level > 0) wrongTurn++;
      }
    }
    return { error, stereoDifference, quiet, active, changedSeed, wrongTurn };
  });
  expect(result.error).toBe(0); expect(result.stereoDifference).toBeGreaterThan(.1);
  expect(result.quiet).toBeGreaterThan(1000); expect(result.active).toBeGreaterThan(1000);
  expect(result.changedSeed).toBeGreaterThan(.1); expect(result.wrongTurn).toBe(0);
});

test('generated phrase variants are deterministic, different from legacy PCM and reusable within the bounded cache', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const synthesisPath = '/src/audio/asmr-synthesis.ts';
    const { asmrSample, asmrVariantSample } = await import(synthesisPath);
    const original = asmrSample('brush'), first = asmrVariantSample('brush', 1), second = asmrVariantSample('brush', 2);
    const reused = first === asmrVariantSample('brush', 1);
    for (const sound of ['air', 'wood', 'glass', 'paper', 'scratch', 'water']) {
      asmrVariantSample(sound, 1); asmrVariantSample(sound, 2);
    }
    const regenerated = asmrVariantSample('brush', 1);
    let changed = 0, regeneratedError = 0, peak = 0;
    for (let frame = 0; frame < first.length; frame++) {
      changed = Math.max(changed, Math.abs(original[frame] - first[frame]), Math.abs(first[frame] - second[frame]));
      regeneratedError = Math.max(regeneratedError, Math.abs(first[frame] - regenerated[frame]));
      peak = Math.max(peak, Math.abs(first[frame]), Math.abs(second[frame]));
    }
    return { reused, evicted: first !== regenerated, legacyReused: original === asmrSample('brush'), changed, regeneratedError, peak };
  });
  expect(result.reused).toBe(true); expect(result.evicted).toBe(true); expect(result.legacyReused).toBe(true);
  expect(result.changed).toBeGreaterThan(.1); expect(result.regeneratedError).toBe(0); expect(result.peak).toBeLessThanOrEqual(.701);
});

test('take turns excludes muted and zero-level layers and respects a silent solo in actual offline audio', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', sourcePath = '/src/audio/asmr-phrase-source.ts';
    const statePath = '/src/asmr-state.ts', variationPath = '/src/asmr-variation.ts';
    const { AsmrMixer } = await import(mixerPath), { phraseConfig } = await import(sourcePath);
    const { makeAsmrLayer } = await import(statePath), { defaultAsmrVariation } = await import(variationPath);
    const settings = { level: 1, variation: { ...defaultAsmrVariation(), mode: 'turns', amount: 0, phraseSeconds: 4 },
      layers: [{ ...makeAsmrLayer('air'), level: .8, motion: 'still' }, { ...makeAsmrLayer('brush'), level: 0, solo: true, motion: 'still' }] };
    const render = async () => {
      const context = new OfflineAudioContext(2, 24000 * 3, 24000), mixer = new AsmrMixer(context, context.destination);
      mixer.update(settings); const output = await context.startRendering(); mixer.dispose();
      let energy = 0; for (const value of output.getChannelData(0)) energy += value * value;
      return Math.sqrt(energy / output.length);
    };
    const silentEligible = phraseConfig(settings, 0).eligible, silentSolo = await render();
    settings.layers[1].muted = true;
    const mutedEligible = phraseConfig(settings, 0).eligible, mutedSolo = await render();
    settings.layers[1].muted = false; settings.layers[1].level = .8;
    const soloEligible = phraseConfig(settings, 0).eligible, solo = await render();
    return { silentEligible, silentSolo, mutedEligible, mutedSolo, soloEligible, solo };
  });
  expect(result.silentEligible).toEqual([]); expect(result.silentSolo).toBe(0);
  expect(result.mutedEligible).toEqual([0]); expect(result.mutedSolo).toBeGreaterThan(.001);
  expect(result.soloEligible).toEqual([1]); expect(result.solo).toBeGreaterThan(.001);
});

test('actual offline ASMR graph and 30-second PCM export match a full render across fractional rates and phrase/turn boundaries', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const graphPath = '/src/audio/export-graph.ts', pcmPath = '/src/audio/pcm-export.ts', statePath = '/src/asmr-state.ts';
    const variationPath = '/src/asmr-variation.ts', modelPath = '/src/model.ts';
    const { exportGraph } = await import(graphPath), { renderPcm } = await import(pcmPath);
    const { makeAsmrLayer } = await import(statePath), { defaultAsmrVariation } = await import(variationPath), { initialSession } = await import(modelPath);
    const rate = 44100, seconds = 65, frames = rate * seconds, results = [];
    for (const mode of ['natural', 'turns']) for (const pace of [.7, 1.1]) {
      const session = initialSession(); session.mode = 'asmr'; session.master = .4; session.minutes = 0; session.ambient = 'none';
      session.asmr = { level: .8, variation: { ...defaultAsmrVariation(), mode, phraseSeconds: 7.3, turnSeconds: 17.1 },
        layers: [{ ...makeAsmrLayer('air'), rate: pace, motion: 'still', pan: -.4 },
          { ...makeAsmrLayer('brush'), rate: pace, motion: 'still', pan: .4 }] };
      const context = new OfflineAudioContext(2, frames, rate), cleanup = exportGraph(context, session, 0, undefined);
      const rendered = await context.startRendering(); cleanup();
      const chunks = [new Float32Array(frames), new Float32Array(frames)]; let cursor = 0;
      await renderPcm(session, seconds, 90, { start: async () => {},
        write: async (left: Float32Array, right: Float32Array, first: number, count: number) => {
          chunks[0].set(left.subarray(first, first + count), cursor); chunks[1].set(right.subarray(first, first + count), cursor); cursor += count;
        } }, {});
      let error = 0, peak = 0, energy = 0;
      for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < frames; frame++) {
        error = Math.max(error, Math.abs(rendered.getChannelData(ear)[frame] - chunks[ear][frame]));
        peak = Math.max(peak, Math.abs(chunks[ear][frame])); energy += chunks[ear][frame] ** 2;
      }
      results.push({ mode, pace, error, peak, rms: Math.sqrt(energy / (frames * 2)), frames: cursor });
    }
    return results;
  });
  expect(result).toHaveLength(4);
  for (const item of result) {
    expect(item.frames).toBe(65 * 44100); expect(item.error, JSON.stringify(item)).toBeLessThan(.0001);
    expect(item.rms).toBeGreaterThan(.001); expect(item.peak).toBeLessThan(1);
  }
});

test('phrase pace automation integrates sample phase continuously instead of jumping through an ongoing phrase', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const phrasePath = '/src/audio/asmr-phrases.ts', variationPath = '/src/asmr-variation.ts';
    const { AsmrPhraseRenderer, planAsmrPhrase } = await import(phrasePath), { defaultAsmrVariation } = await import(variationPath);
    const rate = 24000, start = rate * 5, frames = rate, variation = { ...defaultAsmrVariation(), mode: 'natural', amount: 0, phraseSeconds: 20 };
    const config = { variation, ordinal: 0, eligible: [0] };
    const pcm = { sampleRate: rate, channels: [Float32Array.from({ length: rate * 12 }, (_, index) => .2 * Math.sin(index * 2 * Math.PI * 92 / (rate * 12)))] };
    const rates = Float32Array.from({ length: frames }, (_, frame) => Math.fround(.7 + .6 * Math.min(1, frame / (rate * .035))));
    const output = [new Float32Array(frames)], renderer = new AsmrPhraseRenderer(pcm, config);
    renderer.render(output, rate, start, rates);
    const phrase = planAsmrPhrase(config, 0, 12);
    let phase = (start / rate - phrase.start) * rates[0], error = 0, jump = 0, warpedError = 0;
    for (let frame = 0; frame < frames; frame++) {
      if (frame) phase += rates[frame] / rate;
      const position = ((phrase.offset + phase) * rate) % pcm.channels[0].length;
      const index = Math.floor(position), fraction = position - index;
      const expected = pcm.channels[0][index] + (pcm.channels[0][(index + 1) % pcm.channels[0].length] - pcm.channels[0][index]) * fraction;
      error = Math.max(error, Math.abs(expected - output[0][frame]));
      if (frame) jump = Math.max(jump, Math.abs(output[0][frame] - output[0][frame - 1]));
      const warped = ((phrase.offset + (start / rate + frame / rate - phrase.start) * rates[frame]) * rate) % pcm.channels[0].length;
      warpedError = Math.max(warpedError, Math.abs(output[0][frame] - pcm.channels[0][Math.floor(warped)]));
    }
    return { error, jump, warpedError };
  });
  expect(result.error).toBeLessThan(.0000001); expect(result.jump).toBeLessThan(.001);
  expect(result.warpedError).toBeGreaterThan(.1);
});

test('@live phrase resources load lazily once, obey pending/mode gates and retain absolute time for late voices and pause', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
    const variationPath = '/src/asmr-variation.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { defaultAsmrVariation } = await import(variationPath), { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession(); session.mode = 'mixed'; session.master = .3; session.minutes = 0; session.tonesMuted = true;
    session.ambient = 'white'; session.ambientLevel = .4;
    session.asmr = { level: .8, focus: true, layers: [{ ...makeAsmrLayer('air'), motion: 'still' }] };
    const OriginalNode = window.AudioWorkletNode, creations: { origin: number; bytes: number }[] = [];
    window.AudioWorkletNode = new Proxy(OriginalNode, { construct(target, args) {
      if (args[1] === 'asmr-phrases') {
        const options = args[2].processorOptions, pcm = options.pcm;
        creations.push({ origin: options.originFrame,
          bytes: [...pcm.channels, ...(pcm.variants ?? []).flat()].reduce((sum: number, channel: Float32Array) => sum + channel.byteLength, 0) });
      }
      return Reflect.construct(target, args);
    } });
    try {
      await engine.start(session);
      const context: AudioContext = engine.context, add = context.audioWorklet.addModule.bind(context.audioWorklet);
      let calls = 0, release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      context.audioWorklet.addModule = async (url, options) => { calls++; await held; return add(url, options); };
      const lazy = creations.length === 0;
      session.asmr.variation = { ...defaultAsmrVariation(), mode: 'natural', amount: 0, phraseSeconds: 4 };
      engine.update(session); engine.update(session);
      await waitForAudioTime(context, context.currentTime + .55);
      const pending = engine.loadingAsmr, backgroundPending = engine.noiseGain.gain.value, hiddenVoices = engine.asmr.voices.size;
      session.mode = 'binaural'; engine.update(session); release();
      const deadline = performance.now() + 10000;
      while (calls < 1 || engine.loadingAsmr) { if (performance.now() > deadline) throw new Error('Phrase preparation did not settle.'); await new Promise(resolve => setTimeout(resolve, 20)); }
      await waitForAudioTime(context, context.currentTime + .6);
      const disabled = engine.asmr.bus.gain.value, disabledVoices = engine.asmr.voices.size;
      session.mode = 'mixed'; session.ambient = 'none'; engine.update(session);
      while (engine.loadingAsmr) { if (performance.now() > deadline) throw new Error('Phrase source never became ready.'); await new Promise(resolve => setTimeout(resolve, 20)); }
      const analyzer = context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
      const peak = () => { const data = new Float32Array(2048); analyzer.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
      await waitForAudioTime(context, Math.ceil(context.currentTime / 4) * 4 + 1); const audible = peak();
      const count = creations.length; for (let index = 0; index < 10; index++) engine.update(session);
      const reused = creations.length === count;
      session.asmr.layers.push({ ...makeAsmrLayer('brush'), motion: 'still', rate: .7 }); engine.update(session);
      const lateOrigin = creations.at(-1)!.origin, firstOrigin = creations[0].origin;
      await engine.pause(); const frozen = context.currentTime; await new Promise(resolve => setTimeout(resolve, 120));
      const paused = context.currentTime === frozen; await engine.resume(); await waitForAudioTime(context, frozen + .2);
      session.asmr.layers.forEach((layer: { muted: boolean }) => { layer.muted = true; }); engine.update(session);
      session.ambient = 'none'; engine.update(session); await waitForAudioTime(context, context.currentTime + .5); const muted = peak();
      await engine.stop();
      return { lazy, calls, pending, backgroundPending, hiddenVoices, disabled, disabledVoices, audible, reused,
        lateOrigin, firstOrigin, paused, muted, stopped: !engine.playing, bytes: creations.map(item => item.bytes), failure: engine.failure };
    } finally { await engine.stop(); window.AudioWorkletNode = OriginalNode; }
  });
  expect(result.lazy).toBe(true); expect(result.calls).toBe(1); expect(result.pending).toBe(true);
  expect(result.backgroundPending).toBeCloseTo(.4 * .22, 5); expect(result.hiddenVoices).toBe(0);
  expect(result.disabled).toBeCloseTo(0, 5); expect(result.disabledVoices).toBe(0);
  expect(result.audible).toBeGreaterThan(.001); expect(result.reused).toBe(true);
  expect(result.lateOrigin).toBe(result.firstOrigin); expect(result.paused).toBe(true); expect(result.muted).toBeLessThan(.00001);
  expect(result.stopped).toBe(true); expect(result.failure).toBeUndefined();
  expect(result.bytes.every((bytes: number) => bytes <= 3 * 24000 * 12 * 4)).toBe(true);
});

test('@live failed phrase preparation can retry and a stopped engine cannot adopt a late module', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
    const variationPath = '/src/asmr-variation.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { defaultAsmrVariation } = await import(variationPath);
    const engine = new AudioEngine(), session = initialSession(); session.mode = 'asmr'; session.minutes = 0;
    await engine.start(session);
    const context: AudioContext = engine.context, original = context.audioWorklet.addModule.bind(context.audioWorklet);
    let calls = 0, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    context.audioWorklet.addModule = async (url, options) => {
      calls++; if (calls === 1) throw new Error('Synthetic module failure'); await held; return original(url, options);
    };
    session.asmr = { level: 1, layers: [makeAsmrLayer('air')], variation: { ...defaultAsmrVariation(), mode: 'natural' } };
    engine.update(session);
    const deadline = performance.now() + 5000;
    while (engine.loadingAsmr) { if (performance.now() > deadline) throw new Error('Failure did not settle.'); await new Promise(resolve => setTimeout(resolve, 10)); }
    const failure = engine.failure; engine.failure = undefined; engine.update(session);
    const retryPending = engine.loadingAsmr;
    const stopped = engine.stop(); release(); await stopped; await new Promise(resolve => setTimeout(resolve, 150));
    return { failure, retryPending, calls, playing: engine.playing, loading: engine.loadingAsmr, mixer: engine.asmr, finalFailure: engine.failure };
  });
  expect(result.failure).toContain('Synthetic module failure'); expect(result.retryPending).toBe(true); expect(result.calls).toBe(2);
  expect(result.playing).toBe(false); expect(result.loading).toBe(false); expect(result.mixer).toBeUndefined(); expect(result.finalFailure).toBeUndefined();
});

test('@live decoded stereo recording reaches the real phrase worklet with exact shared-renderer PCM at fractional pace', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const sampleRate = 24000, frames = sampleRate * 2, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(7000 * Math.sin(frame * 2 * Math.PI * 220 / sampleRate)), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(5000 * Math.sin(frame * 2 * Math.PI * 660 / sampleRate)), 46 + frame * 4);
  }
  await page.route('**/audio/asmr/page-turning.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: bytes }));
  const results = await page.evaluate(async () => {
    const sourcePath = '/src/audio/asmr-phrase-source.ts', assetsPath = '/src/audio/asmr-assets.ts', phrasePath = '/src/audio/asmr-phrases.ts';
    const statePath = '/src/asmr-state.ts', variationPath = '/src/asmr-variation.ts';
    const { prepareAsmrAudio, createAsmrPhraseSource, phraseConfig } = await import(sourcePath), { recordedAsmrBuffer } = await import(assetsPath);
    const { AsmrPhraseRenderer } = await import(phrasePath), { makeAsmrLayer } = await import(statePath), { defaultAsmrVariation } = await import(variationPath);
    const results = [];
    for (const rate of [.7, 1.1]) {
      const context = new AudioContext(); await context.suspend();
      const layer = { ...makeAsmrLayer('recorded-pages'), rate }, settings = { level: 1, layers: [layer],
        variation: { ...defaultAsmrVariation(), mode: 'natural', phraseSeconds: 4, amount: 0 } };
      await prepareAsmrAudio(context, settings);
      const code = `class Probe extends AudioWorkletProcessor {
        remaining = 32;
        process(inputs) { if (this.remaining > 0 && inputs[0]?.length === 2) {
          this.port.postMessage({ first: currentFrame, channels: inputs[0].map(channel => channel.slice()) }); this.remaining--;
        } return true; }
      } registerProcessor('phrase-probe', Probe);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
        const probe = new AudioWorkletNode(context, 'phrase-probe', { channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] });
        const blocks: { first: number; channels: Float32Array[] }[] = [];
        const captured = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Real phrase worklet produced no capture blocks.')), 8000);
          probe.port.onmessage = event => { blocks.push(event.data); if (blocks.length === 32) { clearTimeout(timer); resolve(); } };
        });
        const offset = 30.75, origin = Math.round((context.currentTime - offset) * context.sampleRate), config = phraseConfig(settings, 0);
        const source = createAsmrPhraseSource(context, layer, config, offset); source.connect(probe); probe.connect(context.destination); source.start();
        await context.resume(); await captured;
        const buffer: AudioBuffer = recordedAsmrBuffer('recorded-pages');
        const pcm = { sampleRate: buffer.sampleRate, channels: [buffer.getChannelData(0), buffer.getChannelData(1)] };
        let error = 0, difference = 0, peak = 0;
        for (const block of blocks) {
          const expected = [new Float32Array(block.channels[0].length), new Float32Array(block.channels[1].length)];
          new AsmrPhraseRenderer(pcm, config).render(expected, context.sampleRate, block.first - origin, rate);
          for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < expected[ear].length; frame++) {
            error = Math.max(error, Math.abs(expected[ear][frame] - block.channels[ear][frame]));
            peak = Math.max(peak, Math.abs(block.channels[ear][frame]));
            difference = Math.max(difference, Math.abs(block.channels[0][frame] - block.channels[1][frame]));
          }
        }
        results.push({ rate, error, peak, difference, stereo: buffer.numberOfChannels }); source.stop(); source.disconnect(); probe.disconnect();
      } finally { URL.revokeObjectURL(url); await context.close(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.stereo).toBe(2); expect(result.error).toBeLessThan(.000001);
    expect(result.peak).toBeGreaterThan(.05); expect(result.difference).toBeGreaterThan(.05);
  }
});

test('@live phrase processor errors stop the app and dispose the active audio capture', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/audio/engine.ts', { AudioEngine } = await import(path);
    const probe: { node?: AudioWorkletNode; lease?: AudioCaptureLease; disconnected: boolean } = { disconnected: false };
    (window as unknown as { phraseFailureProbe: typeof probe }).phraseFailureProbe = probe;
    const OriginalNode = window.AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(OriginalNode, { construct(target, args) {
      const node: AudioWorkletNode = Reflect.construct(target, args);
      if (args[1] === 'asmr-phrases') {
        probe.node = node;
        const disconnect = node.disconnect.bind(node);
        node.disconnect = (...values: unknown[]) => { probe.disconnected = true; Reflect.apply(disconnect, node, values); };
      }
      return node;
    } });
    const start = AudioEngine.prototype.start;
    AudioEngine.prototype.start = async function(this: { captureAudio(): AudioCaptureLease }, session: unknown) {
      await start.call(this, session); probe.lease = this.captureAudio();
    };
  });
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-flow').selectOption('natural');
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const probe = (window as unknown as { phraseFailureProbe: { node?: AudioWorkletNode; lease?: AudioCaptureLease } }).phraseFailureProbe;
    return !!probe.node && probe.lease?.state() === 'playing' && probe.lease.stream.getAudioTracks().some(track => track.readyState === 'live');
  })).toBe(true);
  await page.evaluate(() => {
    const probe = (window as unknown as { phraseFailureProbe: { node: AudioWorkletNode } }).phraseFailureProbe;
    probe.node.dispatchEvent(new Event('processorerror'));
  });
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#notice')).toContainText('ASMR phrase processor stopped unexpectedly');
  await expect(page.getByRole('button', { name: 'Start listening', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const probe = (window as unknown as { phraseFailureProbe: { node: AudioWorkletNode; lease: AudioCaptureLease; disconnected: boolean } }).phraseFailureProbe;
    return { state: probe.node.context.state, capture: probe.lease.state(), ended: probe.lease.stream.getTracks().every(track => track.readyState === 'ended'),
      disconnected: probe.disconnected };
  })).toEqual({ state: 'closed', capture: 'stopped', ended: true, disconnected: true });
});
