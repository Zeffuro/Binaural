import { expect, test } from '@playwright/test';

test('HRTF settings validate strictly, retain legacy positions and survive session formats', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', spatialPath = '/src/asmr-spatial.ts', sharePath = '/src/share.ts';
    const { initialSession, parseSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { defaultSpatial, parseAsmrSpatial } = await import(spatialPath), { sessionLink, readSharedSession } = await import(sharePath);
    const position = defaultSpatial(), invalid = [null, false, 1, {}, [], 'native', 'missing', 'SADIE'];
    const errors = invalid.map(profile => { try { parseAsmrSpatial({ ...position, profile }); return ''; } catch (error) { return (error as Error).message; } });
    const session = initialSession(); session.mode = 'asmr';
    session.asmr = { level: .4, layers: [{ ...makeAsmrLayer('air'), spatial: position }] };
    return { errors, legacy: parseSession(session).asmr.layers[0].spatial, profiles: ['sadie-d1', 'sadie-h10'].map(profile => {
      session.asmr.layers[0].spatial = { ...position, profile };
      return [parseSession(JSON.parse(JSON.stringify(session))).asmr.layers[0].spatial,
        readSharedSession(new URL(sessionLink(session)).hash).asmr.layers[0].spatial];
    }) };
  });
  expect(result.errors).toEqual(Array(8).fill('Invalid ASMR HRTF profile.'));
  expect(result.legacy).toEqual({ azimuth: 0, elevation: 0, distance: .6, motion: 'still' });
  for (const [index, pair] of result.profiles.entries()) for (const position of pair) {
    expect(position).toEqual({ ...result.legacy, profile: ['sadie-d1', 'sadie-h10'][index] });
  }
});

test('real HRTF graphs preserve full and sectioned WAV, FLAC, room and motion exports', async ({ page }, testInfo) => {
  test.setTimeout(240000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', graphPath = '/src/audio/export-graph.ts';
    const exportPath = '/src/audio/export.ts', readyPath = '/src/audio/hrtf-audio.ts';
    const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { exportGraph } = await import(graphPath), { renderWav, renderFlac } = await import(exportPath);
    const { prepareHrtfAudio } = await import(readyPath), rate = 44100, frames = 31 * rate, results = [];
    for (const [profile, motion] of [['sadie-d1', 'still'], ['sadie-h10', 'still'], ['sadie-d1', 'orbit']]) {
      const session = initialSession(); session.mode = 'asmr'; session.minutes = 0; session.master = .25; session.ambient = 'none';
      session.asmr = { level: .6, space: { amount: .2, size: 1.2, warmth: .7 }, layers: [
        { ...makeAsmrLayer('air'), motion: 'still', period: 12,
          spatial: { azimuth: 65, elevation: 25, distance: .6, motion, profile } },
      ] };
      const context = new OfflineAudioContext(2, frames, rate); await prepareHrtfAudio(context, session.asmr);
      const cleanup = exportGraph(context, session, 0, undefined), full = await context.startRendering(); cleanup();
      const bytes = new DataView(await (await renderWav(session, 31)).arrayBuffer());
      let peakError = 0, boundaryError = 0, squaredError = 0, energy = 0, peak = 0, finite = true;
      for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < 2; ear++) {
        const actual = bytes.getInt16(44 + frame * 4 + ear * 2, true) / 32768, expected = full.getChannelData(ear)[frame];
        const error = Math.abs(actual - expected); peakError = Math.max(peakError, error);
        if (Math.abs(frame / rate - 30) < .1) boundaryError = Math.max(boundaryError, error);
        squaredError += error ** 2; energy += expected ** 2; peak = Math.max(peak, Math.abs(expected)); finite &&= Number.isFinite(expected);
      }
      let flacError = 0, flacFrames = 0;
      if (motion === 'still') {
        const flac = await renderFlac(session, .5), decode = new OfflineAudioContext(2, 1, rate);
        const decoded = await decode.decodeAudioData(await flac.arrayBuffer()); flacFrames = decoded.length;
        for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < decoded.length; frame++) {
          flacError = Math.max(flacError, Math.abs(decoded.getChannelData(ear)[frame] - full.getChannelData(ear)[frame]));
        }
      }
      results.push({ profile, motion, bytes: bytes.byteLength, peakError, boundaryError,
        relativeRms: Math.sqrt(squaredError / energy), energy, peak, finite, flacError, flacFrames });
    }
    return results;
  });
  await testInfo.attach('hrtf-export-measurements.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const item of result) {
    const diagnostic = JSON.stringify(item);
    expect(item.bytes).toBe(44 + 31 * 44100 * 4); expect(item.finite).toBe(true);
    expect(item.energy, diagnostic).toBeGreaterThan(1); expect(item.peak, diagnostic).toBeLessThan(1);
    expect(item.peakError, diagnostic).toBeLessThan(item.motion === 'still' ? .00015 : .005);
    expect(item.boundaryError, diagnostic).toBeLessThan(item.motion === 'still' ? .00015 : .005);
    expect(item.relativeRms, diagnostic).toBeLessThan(.025);
    if (item.motion === 'still') { expect(item.flacFrames).toBe(22050); expect(item.flacError, diagnostic).toBeLessThan(.00015); }
  }
});

test('@live six HRTF layers retain stereo capture, bounded clock progress, pause and preview inheritance', async ({ page }, testInfo) => {
  test.setTimeout(90000); await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const previewPath = '/src/audio/asmr-preview.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const { AsmrPreview } = await import(previewPath), { waitForAudioTime } = await import(clockPath);
    const session = initialSession(); session.mode = 'asmr'; session.minutes = 0; session.master = .3; session.ambient = 'none';
    session.asmr = { level: .5, layers: Array.from({ length: 6 }, (_, index) => ({ ...makeAsmrLayer('air'), level: .2,
      spatial: { azimuth: -150 + index * 60, elevation: index % 2 ? 25 : -25, distance: .6,
        motion: 'orbit', profile: index % 2 ? 'sadie-h10' : 'sadie-d1' } })) };
    const engine: any = new AudioEngine(), nodes: AudioWorkletNode[] = [], NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options); if (name === 'asmr-hrtf') nodes.push(this);
      }
    };
    let preview: any;
    try {
      await engine.start(session); const context: AudioContext = engine.context, capture = engine.captureAudio();
      const splitter = context.createChannelSplitter(2), taps = [context.createAnalyser(), context.createAnalyser()];
      engine.transport.connect(splitter); taps.forEach((tap, ear) => { tap.fftSize = 8192; splitter.connect(tap, ear); });
      const began = performance.now(), audioBegan = context.currentTime;
      await waitForAudioTime(context, audioBegan + 2, 10000);
      const clockProgress = context.currentTime - audioBegan, elapsed = (performance.now() - began) / 1000;
      const readings = taps.map(tap => { const pcm = new Float32Array(8192); tap.getFloatTimeDomainData(pcm);
        return { finite: pcm.every(Number.isFinite), energy: pcm.reduce((sum, value) => sum + value ** 2, 0), peak: Math.max(...pcm.map(Math.abs)) }; });
      const profiles = nodes.map(node => (node as any).parameters.size), playing = capture.state(), tracks = capture.stream.getAudioTracks().map((track: MediaStreamTrack) => track.readyState);
      await engine.pause(); const paused = capture.state(), frozenAt = context.currentTime;
      await new Promise(resolve => setTimeout(resolve, 60)); const frozen = context.currentTime === frozenAt;
      await engine.resume(); await waitForAudioTime(context, context.currentTime + .25);
      const resumed = capture.state(); capture.dispose(); capture.dispose(); splitter.disconnect(); taps.forEach(tap => tap.disconnect());
      await engine.stop(); const stopped = capture.state(), failed = engine.failure;
      const source = structuredClone(session), previewEngine: any = new AudioEngine(); let inherited: string | undefined;
      preview = new AsmrPreview(() => {}, () => ({ get remaining() { return previewEngine.remaining; }, get failure() { return previewEngine.failure; },
        start: async (isolated: any) => { inherited = isolated.asmr.layers[0].spatial.profile; await previewEngine.start(isolated); },
        stop: () => previewEngine.stop() }));
      await preview.start(source, source.asmr.layers[0].id); await preview.stop();
      return { readings, profiles, playing, tracks, clockProgress, elapsed, paused, frozen, resumed, stopped, failed, inherited, totalNodes: nodes.length };
    } finally { window.AudioWorkletNode = NativeWorklet; await preview?.stop(); await engine.stop(); }
  });
  await testInfo.attach('six-layer-hrtf-capture.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.profiles).toHaveLength(6); expect(result.profiles).toEqual(Array(6).fill(3));
  for (const ear of result.readings) { expect(ear.finite).toBe(true); expect(ear.energy).toBeGreaterThan(.001); expect(ear.peak).toBeLessThan(1); }
  expect(result.clockProgress).toBeGreaterThanOrEqual(2); expect(result.elapsed).toBeLessThan(10);
  expect(result.tracks).toEqual(['live']); expect(result.playing).toBe('playing'); expect(result.paused).toBe('paused');
  expect(result.frozen).toBe(true); expect(result.resumed).toBe('playing'); expect(result.stopped).toBe('stopped');
  expect(result.failed).toBeUndefined(); expect(result.inherited).toBe('sadie-d1'); expect(result.totalNodes).toBe(7);
});

test('actual offline HRTF processor errors reject WAV and FLAC exports instead of saving missing ASMR', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', exportPath = '/src/audio/export.ts';
    const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath), { renderWav, renderFlac } = await import(exportPath);
    const session = initialSession(); session.mode = 'asmr'; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: .5, layers: [{ ...makeAsmrLayer('air'),
      spatial: { azimuth: 0, elevation: 0, distance: .6, motion: 'still', profile: 'sadie-d1' } }] };
    const NativeWorklet = window.AudioWorkletNode, nativeAddModule = AudioWorklet.prototype.addModule;
    const module = URL.createObjectURL(new Blob([`registerProcessor('hrtf-test-failure', class extends AudioWorkletProcessor {
      static get parameterDescriptors() { return ['positionX','positionY','positionZ'].map(name => ({name,defaultValue:0})); }
      process() { throw new Error('Injected native processor failure'); }
    });`], { type: 'application/javascript' }));
    const registered = new WeakSet<AudioWorklet>();
    AudioWorklet.prototype.addModule = async function (url: string | URL, options?: WorkletOptions) {
      await nativeAddModule.call(this, url, options);
      if (!registered.has(this)) { await nativeAddModule.call(this, module); registered.add(this); }
    };
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name === 'asmr-hrtf' ? 'hrtf-test-failure' : name, options);
      }
    };
    const errors = [];
    try {
      for (const render of [renderWav, renderFlac]) {
        try { await render(session, .25); errors.push('Unexpected successful export'); }
        catch (error) { errors.push((error as Error).message); }
      }
      return errors;
    } finally { window.AudioWorkletNode = NativeWorklet; AudioWorklet.prototype.addModule = nativeAddModule; URL.revokeObjectURL(module); }
  });
  expect(result).toEqual(Array(2).fill('An ASMR audio processor failed during export. Please try again.'));
});

test('@live stopping a pending HRTF preview prevents late adoption and failed loads can retry', async ({ page }) => {
  test.setTimeout(60000);
  let release!: () => void, seen = false;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/audio/hrtf/sadie-d1-*.bin', async route => { seen = true; await blocked; await route.continue(); });
  await page.goto('/'); await page.locator('h1').click();
  await page.evaluate(async () => {
    const previewPath = '/src/audio/asmr-preview.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const { AsmrPreview } = await import(previewPath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const session = initialSession(); session.mode = 'asmr'; session.minutes = 0;
    session.asmr = { level: .5, layers: [{ ...makeAsmrLayer('air'),
      spatial: { azimuth: -75, elevation: 0, distance: .6, motion: 'still', profile: 'sadie-d1' } }] };
    const state = window as any; state.hrtfSession = session; state.hrtfPreview = new AsmrPreview(() => {});
    state.hrtfPending = state.hrtfPreview.start(session, session.asmr.layers[0].id);
  });
  try {
    await expect.poll(() => seen).toBe(true);
    await page.evaluate(async () => (window as any).hrtfPreview.stop());
    release(); await page.evaluate(async () => (window as any).hrtfPending);
    expect(await page.evaluate(() => (window as any).hrtfPreview.state.phase)).toBe('idle');
    await page.evaluate(async () => { const state = window as any; await state.hrtfPreview.start(state.hrtfSession, state.hrtfSession.asmr.layers[0].id); });
    expect(await page.evaluate(() => (window as any).hrtfPreview.state.phase)).toBe('playing');
    await page.evaluate(async () => (window as any).hrtfPreview.stop());
  } finally { release(); await page.evaluate(async () => (window as any).hrtfPreview?.stop()); }
  await page.unroute('**/audio/hrtf/sadie-d1-*.bin');
  let fail = true;
  await page.route('**/audio/hrtf/sadie-h10-*.bin', route => fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
  await page.evaluate(async () => { const state = window as any; state.hrtfSession.asmr.layers[0].spatial.profile = 'sadie-h10';
    await state.hrtfPreview.start(state.hrtfSession, state.hrtfSession.asmr.layers[0].id); });
  expect(await page.evaluate(() => (window as any).hrtfPreview.state.error)).toContain('HRTF profile could not be loaded');
  fail = false;
  await page.evaluate(async () => { const state = window as any; await state.hrtfPreview.start(state.hrtfSession, state.hrtfSession.asmr.layers[0].id); });
  expect(await page.evaluate(() => (window as any).hrtfPreview.state.phase)).toBe('playing');
  await page.evaluate(async () => (window as any).hrtfPreview.stop());
});
