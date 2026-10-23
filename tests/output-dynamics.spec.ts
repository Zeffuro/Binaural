import { expect, test, type Page } from '@playwright/test';
import type { OutputDynamicsProfile } from '../src/output-dynamics';
import type { Session } from '../src/model';

async function installOriginalGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).originalDynamicsGraph = async (context: OfflineAudioContext, session: Session, music: AudioBuffer) => {
      if (session.ambient !== 'none' || session.minutes !== 0 || session.asmr?.focus || !['asmr', 'mixed'].includes(session.mode!)) {
        throw new Error('Original dynamics reference expects untimed ASMR/mixed input without ambience or focus ducking.');
      }
      const tonePath = '/src/audio/offline-tone.ts', mixerPath = '/src/audio/asmr-mixer.ts', graphPath = '/src/audio/graph.ts';
      const { offlineTone } = await import(tonePath), { AsmrMixer } = await import(mixerPath), { smooth } = await import(graphPath);
      const master = context.createGain(); master.gain.value = session.master;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = ({ balanced: -10, open: -4, soft: -18 })[session.dynamics ?? 'balanced'];
      compressor.knee.value = 6; compressor.ratio.value = 12; compressor.attack.value = .003; compressor.release.value = .25;
      const gate = context.createGain(); gate.gain.setValueAtTime(0, 0); gate.gain.linearRampToValueAtTime(1, .5);
      master.connect(compressor).connect(gate).connect(context.destination);
      const tones = context.createGain(); tones.gain.value = session.mode === 'mixed' ? 1 : 0; tones.connect(master);
      for (const layer of session.layers) offlineTone(context, layer, tones, session.layers.length, undefined, 0);
      const source = context.createBufferSource(), level = context.createGain(); source.buffer = music; source.loop = true;
      level.gain.value = 0; smooth(level.gain, session.musicLevel * .4, 0); source.connect(level).connect(master); source.start();
      const asmr = new AsmrMixer(context, master, undefined, 0); asmr.update(session.asmr, true);
      return () => { asmr.dispose(); compressor.disconnect(); };
    };
  });
}

function recording(): Buffer {
  const rate = 24000, bytes = Buffer.alloc(44 + rate * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(rate * 4, 40);
  for (let frame = 0; frame < rate; frame++) {
    bytes.writeInt16LE(Math.round(18000 * Math.sin(2 * Math.PI * 200 * frame / rate)), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 700 * frame / rate)), 46 + frame * 4);
  }
  return bytes;
}

test('dynamics validates all profiles and preserves legacy, JSON and shared session shapes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/model.ts', sharePath = '/src/share.ts', profilesPath = '/src/output-dynamics.ts';
    const { initialSession, parseSession } = await import(modelPath), { sessionLink, readSharedSession } = await import(sharePath);
    const { outputDynamicsProfiles: profiles } = await import(profilesPath), legacy = initialSession();
    const outputDynamicsProfiles: { id: OutputDynamicsProfile; name: string; threshold: number }[] = profiles;
    const invalid = [null, false, 0, {}, [], 'Balanced', 'loud', ''];
    const errors = invalid.map(dynamics => { try { parseSession({ ...legacy, dynamics }); return ''; } catch (error) { return (error as Error).message; } });
    return { errors, omitted: Object.hasOwn(parseSession(legacy), 'dynamics'), original: Object.hasOwn(legacy, 'dynamics'),
      profiles: outputDynamicsProfiles.map(profile => {
        const session = { ...legacy, dynamics: profile.id };
        return { ...profile, json: parseSession(JSON.parse(JSON.stringify(session))).dynamics,
          shared: readSharedSession(new URL(sessionLink(session)).hash).dynamics };
      }) };
  });
  expect(result.omitted).toBe(false); expect(result.original).toBe(false);
  expect(result.errors).toEqual(Array(8).fill('Invalid output dynamics profile.'));
  expect(result.profiles.map(profile => [profile.id, profile.name, profile.threshold])).toEqual([
    ['balanced', 'Balanced', -10], ['open', 'More contrast', -4], ['soft', 'Soft peaks', -18],
  ]);
  for (const profile of result.profiles) { expect(profile.json).toBe(profile.id); expect(profile.shared).toBe(profile.id); }
});

test('omitted and explicit Balanced produce exact legacy native compressor PCM with no initial ramp', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/output-dynamics.ts', { OutputDynamics } = await import(path);
    async function render(kind: 'legacy' | 'omitted' | 'balanced') {
      const context = new OfflineAudioContext(2, 96000, 48000), buffer = context.createBuffer(2, 96000, 48000);
      for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < buffer.length; frame++) {
        buffer.getChannelData(ear)[frame] = (frame < 48000 ? .04 : .9) * Math.sin(frame * (ear ? .07 : .05));
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const wrapper = kind === 'legacy' ? undefined : new OutputDynamics(context, kind === 'balanced' ? 'balanced' : undefined);
      const node: DynamicsCompressorNode = wrapper?.node ?? context.createDynamicsCompressor();
      if (!wrapper) { node.threshold.value = -10; node.knee.value = 6; node.ratio.value = 12; node.attack.value = .003; node.release.value = .25; }
      let targets = 0;
      const target = node.threshold.setTargetAtTime.bind(node.threshold);
      node.threshold.setTargetAtTime = (...args) => { targets++; return target(...args); };
      wrapper?.update(); wrapper?.update('balanced');
      source.connect(node).connect(context.destination); source.start();
      const output = await context.startRendering(); wrapper?.dispose(); wrapper?.dispose();
      return { pcm: [output.getChannelData(0), output.getChannelData(1)], targets,
        config: [node.threshold.value, node.knee.value, node.ratio.value, node.attack.value, node.release.value] };
    }
    const legacy = await render('legacy'), omitted = await render('omitted'), balanced = await render('balanced');
    let error = 0, energy = 0;
    for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < 96000; frame++) {
      error = Math.max(error, Math.abs(legacy.pcm[ear][frame] - omitted.pcm[ear][frame]), Math.abs(legacy.pcm[ear][frame] - balanced.pcm[ear][frame]));
      energy += legacy.pcm[ear][frame] ** 2;
    }
    return { error, energy, targets: [omitted.targets, balanced.targets], config: balanced.config };
  });
  expect(result.error).toBe(0); expect(result.energy).toBeGreaterThan(1); expect(result.targets).toEqual([0, 0]);
  expect(result.config[0]).toBe(-10); expect(result.config[1]).toBe(6); expect(result.config[2]).toBe(12);
  expect(result.config[3]).toBeCloseTo(.003, 7); expect(result.config[4]).toBe(.25);
});

test('native quiet/loud bursts measure original compression and ordered profile contrast', async ({ page }, testInfo) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/output-dynamics.ts', { OutputDynamics } = await import(path);
    const results = [];
    for (const profile of ['open', 'balanced', 'soft'] as const) {
      const rate = 48000, context = new OfflineAudioContext(2, rate * 6, rate), buffer = context.createBuffer(2, rate * 6, rate);
      for (let frame = 0; frame < buffer.length; frame++) {
        const amplitude = frame >= rate * 2 && frame < rate * 4 ? .8 : .02;
        buffer.getChannelData(0)[frame] = buffer.getChannelData(1)[frame] = amplitude * Math.sin(2 * Math.PI * 400 * frame / rate);
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const dynamics = new OutputDynamics(context, profile); source.connect(dynamics.node).connect(context.destination); source.start();
      const suspended = context.suspend(3.5), rendering = context.startRendering();
      await suspended;
      await new Promise(resolve => setTimeout(resolve, 0));
      const reduction = dynamics.node.reduction; await context.resume();
      const output = await rendering, left = output.getChannelData(0);
      const rms = (start: number, end: number) => {
        let energy = 0; for (let frame = start * rate; frame < end * rate; frame++) energy += left[frame] ** 2;
        return Math.sqrt(energy / ((end - start) * rate));
      };
      const quiet = rms(1, 1.8), loud = rms(3, 3.8);
      results.push({ profile, quiet, loud, contrastDb: 20 * Math.log10(loud / quiet), reduction, finite: left.every(Number.isFinite) });
      dynamics.dispose();
    }
    return { inputContrastDb: 20 * Math.log10(40), results };
  });
  await testInfo.attach('native-dynamics-measurements.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const [open, balanced, soft] = result.results, diagnostic = JSON.stringify(result);
  for (const item of result.results) {
    expect(item.finite, diagnostic).toBe(true); expect(item.quiet, diagnostic).toBeGreaterThan(0);
    expect(item.loud, diagnostic).toBeGreaterThan(item.quiet); expect(item.reduction, diagnostic).toBeLessThan(0);
  }
  expect(balanced!.contrastDb, diagnostic).toBeLessThan(result.inputContrastDb);
  expect(open!.contrastDb, diagnostic).toBeGreaterThan(balanced!.contrastDb);
  expect(balanced!.contrastDb, diagnostic).toBeGreaterThan(soft!.contrastDb);
  expect(open!.reduction, diagnostic).toBeGreaterThan(balanced!.reduction);
  expect(balanced!.reduction, diagnostic).toBeGreaterThan(soft!.reduction);
});

test('all profiles retain native lookahead, isolated ears and matched stereo phase', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/output-dynamics.ts', { OutputDynamics } = await import(path), results = [];
    for (const profile of ['balanced', 'open', 'soft'] as const) for (const stereo of [false, true]) {
      const rate = 48000, context = new OfflineAudioContext(2, rate, rate), buffer = context.createBuffer(2, rate, rate);
      for (let frame = rate / 4; frame < rate; frame++) {
        buffer.getChannelData(0)[frame] = .5 * Math.cos((frame - rate / 4) * .04);
        if (stereo) buffer.getChannelData(1)[frame] = -buffer.getChannelData(0)[frame];
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const dynamics = new OutputDynamics(context, profile); source.connect(dynamics.node).connect(context.destination); source.start();
      const output = await context.startRendering(), left = output.getChannelData(0), right = output.getChannelData(1);
      const first = left.findIndex(value => Math.abs(value) > 1e-7); let oppositeError = 0, rightPeak = 0, energy = 0;
      for (let frame = 0; frame < rate; frame++) {
        oppositeError = Math.max(oppositeError, Math.abs(left[frame] + right[frame])); rightPeak = Math.max(rightPeak, Math.abs(right[frame])); energy += left[frame] ** 2;
      }
      results.push({ profile, stereo, delay: first - rate / 4, oppositeError, rightPeak, energy,
        finite: left.every(Number.isFinite) && right.every(Number.isFinite) }); dynamics.dispose();
    }
    return results;
  });
  for (const item of result) {
    const diagnostic = JSON.stringify(item);
    expect(item.delay, diagnostic).toBe(288); expect(item.energy, diagnostic).toBeGreaterThan(1); expect(item.finite, diagnostic).toBe(true);
    if (item.stereo) expect(item.oppositeError, diagnostic).toBe(0); else expect(item.rightPeak, diagnostic).toBe(0);
  }
});

test('changed thresholds ramp from a positive origin and disposal leaves unrelated output connected', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/output-dynamics.ts', { OutputDynamics } = await import(path);
    const context = new OfflineAudioContext(1, 48000, 48000), source = context.createConstantSource(), dynamics = new OutputDynamics(context);
    source.offset.value = .2; source.connect(context.destination); source.connect(dynamics.node); dynamics.node.connect(context.destination);
    const calls: number[][] = [], target = dynamics.node.threshold.setTargetAtTime.bind(dynamics.node.threshold);
    dynamics.node.threshold.setTargetAtTime = (value: number, time: number, constant: number) => { calls.push([value, time, constant]); return target(value, time, constant); };
    dynamics.update('open'); dynamics.update('open'); dynamics.update('soft');
    dynamics.dispose(); dynamics.dispose(); dynamics.update('balanced'); source.start();
    const output = await context.startRendering(), data = output.getChannelData(0);
    return { calls, error: data.reduce((maximum, value) => Math.max(maximum, Math.abs(value - .2)), 0), energy: data.reduce((sum, value) => sum + value ** 2, 0) };
  });
  expect(result.calls).toEqual([[-4, 1 / 48000, .035], [-18, 1 / 48000, .035]]);
  expect(result.error).toBeLessThan(1e-8); expect(result.energy).toBeGreaterThan(1);
});

test('all profiles retain finite native generated and recorded ASMR with music at normal and 2x master', async ({ page }, testInfo) => {
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: recording() }));
  await page.goto('/');
  await installOriginalGraph(page);
  const result = await page.evaluate(async () => {
    const graphPath = '/src/audio/export-graph.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', assetsPath = '/src/audio/asmr-assets.ts';
    const { exportGraph } = await import(graphPath), { makeAsmrLayer } = await import(statePath);
    const { initialSession } = await import(modelPath), { prepareAsmrRecordings } = await import(assetsPath), results = [];
    for (const profile of ['balanced', 'open', 'soft'] as const) for (const master of [1, 2]) {
      const session = initialSession(); session.dynamics = profile; session.master = master; session.volumeBoost = master === 2;
      session.mode = 'asmr'; session.minutes = 0; session.ambient = 'none'; session.musicLevel = 1;
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1, motion: 'still', pan: -1 },
        { ...makeAsmrLayer('recorded-hair'), level: 1, motion: 'still' }] };
      await prepareAsmrRecordings(session.asmr);
      const context = new OfflineAudioContext(2, 88200, 44100), music = context.createBuffer(2, 44100, 44100), nodes: DynamicsCompressorNode[] = [];
      for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < music.length; frame++) music.getChannelData(ear)[frame] = .8 * Math.sin(frame * .06);
      const native = context.createDynamicsCompressor.bind(context);
      context.createDynamicsCompressor = () => { const node = native(); nodes.push(node); return node; };
      const cleanup = exportGraph(context, session, 0, undefined, undefined, music);
      const suspended = context.suspend(1.5), rendering = context.startRendering();
      await suspended;
      await new Promise(resolve => setTimeout(resolve, 0));
      const reduction = nodes[0]!.reduction; await context.resume();
      const output = await rendering, channels = [output.getChannelData(0), output.getChannelData(1)];
      const referenceContext = new OfflineAudioContext(2, 88200, 44100);
      const referenceCleanup = await (window as any).originalDynamicsGraph(referenceContext, session, music);
      const reference = await referenceContext.startRendering(); referenceCleanup();
      let peak = 0, referencePeak = 0, overRange = 0, referenceOverRange = 0, pcmError = 0; const energy = [0, 0];
      for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < output.length; frame++) {
        const value = channels[ear]![frame]!, original = reference.getChannelData(ear)[frame]!;
        peak = Math.max(peak, Math.abs(value)); referencePeak = Math.max(referencePeak, Math.abs(original)); energy[ear]! += value ** 2;
        overRange += Number(Math.abs(value) > 1); referenceOverRange += Number(Math.abs(original) > 1); pcmError = Math.max(pcmError, Math.abs(value - original));
      }
      cleanup(); cleanup();
      results.push({ profile, master, count: nodes.length, threshold: nodes[0]!.threshold.value, reduction, peak, referencePeak, overRange, referenceOverRange, pcmError, energy,
        finite: channels.every(channel => channel.every(Number.isFinite)) });
    }
    return results;
  });
  await testInfo.attach('generated-recorded-music-native-output.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const item of result) {
    const diagnostic = JSON.stringify(item);
    expect(item.count).toBe(1); expect(item.finite, diagnostic).toBe(true); expect(item.peak, diagnostic).toBeGreaterThan(.001);
    expect(item.energy[0], diagnostic).toBeGreaterThan(1); expect(item.energy[1], diagnostic).toBeGreaterThan(1);
    expect(item.pcmError, diagnostic).toBe(0); expect(item.peak, diagnostic).toBe(item.referencePeak); expect(item.overRange, diagnostic).toBe(item.referenceOverRange);
    expect(item.threshold).toBe(({ balanced: -10, open: -4, soft: -18 })[item.profile]); expect(Number.isFinite(item.reduction)).toBe(true);
  }
});

test('all profiles keep boosted ASMR/music WAV parity across actual 30-second section rendering', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await installOriginalGraph(page);
  const result = await page.evaluate(async () => {
    const graphPath = '/src/audio/export-graph.ts', exportPath = '/src/audio/export.ts', pcmPath = '/src/audio/pcm-export.ts';
    const statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const { exportGraph } = await import(graphPath), { renderWav } = await import(exportPath);
    const { renderPcm } = await import(pcmPath);
    const { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const rate = 44100, musicBytes = new ArrayBuffer(44 + rate * 4), wav = new DataView(musicBytes);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); wav.setUint32(4, musicBytes.byteLength - 8, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 4, true);
    wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, rate * 4, true);
    for (let frame = 0; frame < rate; frame++) for (let ear = 0; ear < 2; ear++) wav.setInt16(44 + frame * 4 + ear * 2, Math.round(18000 * Math.sin(2 * Math.PI * (ear ? 300 : 200) * frame / rate)), true);
    const musicFile = new File([musicBytes], 'dynamics.wav', { type: 'audio/wav' }), results = [];
    for (const profile of ['balanced', 'open', 'soft'] as const) {
      const session = initialSession(); session.dynamics = profile; session.master = 2; session.volumeBoost = true;
      session.mode = 'mixed'; session.ambient = 'none'; session.minutes = 0; session.musicLevel = 1;
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1, motion: 'still', pan: -.4 }],
        space: { amount: .25, size: 1.3, warmth: .7 } };
      const frames = 31 * rate, context = new OfflineAudioContext(2, frames, rate), music = await context.decodeAudioData(musicBytes.slice(0));
      const cleanup = exportGraph(context, session, 0, undefined, undefined, music);
      const full = await context.startRendering(); cleanup();
      const referenceContext = new OfflineAudioContext(2, frames, rate);
      const referenceCleanup = await (window as any).originalDynamicsGraph(referenceContext, session, music);
      const reference = await referenceContext.startRendering(); referenceCleanup();
      let sectionPeak = 0, sectionOverRange = 0, sectionPcmError = 0, sectionFrames = 0;
      await renderPcm(session, 31, 3600, {
        start(total: number) { if (total !== frames) throw new Error(`Expected ${frames} pre-encoding frames, got ${total}.`); },
        write(left: Float32Array, right: Float32Array, first: number, count: number) {
          for (let frame = 0; frame < count; frame++) for (let ear = 0; ear < 2; ear++) {
            const value = (ear ? right : left)[first + frame]!, original = reference.getChannelData(ear)[sectionFrames + frame]!;
            sectionPeak = Math.max(sectionPeak, Math.abs(value)); sectionOverRange += Number(Math.abs(value) > 1);
            sectionPcmError = Math.max(sectionPcmError, Math.abs(value - original));
          }
          sectionFrames += count;
        },
      }, { music: musicFile });
      const rendered = await renderWav(session, 31, undefined, undefined, musicFile), encoded = new DataView(await rendered.arrayBuffer());
      let error = 0, boundaryError = 0, energy = 0, peak = 0, referencePeak = 0, overRange = 0, referenceOverRange = 0, pcmError = 0, finite = true;
      let minimumSectionOverRange = 0, maximumSectionOverRange = 0;
      for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < 2; ear++) {
        const actual = encoded.getInt16(44 + frame * 4 + ear * 2, true) / 32768, expected = full.getChannelData(ear)[frame];
        const original = reference.getChannelData(ear)[frame];
        referencePeak = Math.max(referencePeak, Math.abs(original)); overRange += Number(Math.abs(expected) > 1); referenceOverRange += Number(Math.abs(original) > 1);
        pcmError = Math.max(pcmError, Math.abs(expected - original));
        minimumSectionOverRange += Number(Math.abs(original) > 1 + sectionPcmError); maximumSectionOverRange += Number(Math.abs(original) > 1 - sectionPcmError);
        const limited = Math.max(-1, Math.min(1, expected));
        error = Math.max(error, Math.abs(actual - limited)); energy += actual ** 2; peak = Math.max(peak, Math.abs(expected)); finite &&= Number.isFinite(expected);
        if (Math.abs(frame / rate - 30) < .1) boundaryError = Math.max(boundaryError, Math.abs(actual - limited));
      }
      results.push({ profile, bytes: rendered.size, error, boundaryError, energy, peak, referencePeak, overRange, referenceOverRange, pcmError, finite,
        sectionPeak, sectionOverRange, sectionPcmError, sectionFrames, minimumSectionOverRange, maximumSectionOverRange });
    }
    return results;
  });
  await testInfo.attach('boosted-full-and-section-dynamics.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const item of result) {
    const diagnostic = JSON.stringify(item);
    expect(item.bytes).toBe(44 + 31 * 44100 * 4); expect(item.finite, diagnostic).toBe(true); expect(item.energy, diagnostic).toBeGreaterThan(1);
    expect(item.pcmError, diagnostic).toBe(0); expect(item.peak, diagnostic).toBe(item.referencePeak); expect(item.overRange, diagnostic).toBe(item.referenceOverRange);
    expect(item.sectionFrames).toBe(31 * 44100); expect(item.sectionPcmError, diagnostic).toBeLessThan(.00015);
    expect(Math.abs(item.sectionPeak - item.referencePeak), diagnostic).toBeLessThanOrEqual(item.sectionPcmError + Number.EPSILON);
    expect(item.sectionOverRange, diagnostic).toBeGreaterThanOrEqual(item.minimumSectionOverRange);
    expect(item.sectionOverRange, diagnostic).toBeLessThanOrEqual(item.maximumSectionOverRange);
    expect(item.error, diagnostic).toBeLessThan(.00015); expect(item.boundaryError, diagnostic).toBeLessThan(.00015);
  }
});

test('@live engine profile edits reuse one compressor, preserve capture/pause and preview inherits More contrast', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const statePath = '/src/asmr-state.ts', previewPath = '/src/audio/asmr-preview.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath), { waitForAudioTime } = await import(clockPath);
    const { makeAsmrLayer } = await import(statePath), { AsmrPreview } = await import(previewPath);
    const session = initialSession(); session.mode = 'asmr'; session.master = 2; session.volumeBoost = true; session.dynamics = 'open'; session.minutes = 0;
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1, motion: 'still', pan: -1 }] };
    const engine: any = new AudioEngine(), nodes: DynamicsCompressorNode[] = [], native = AudioContext.prototype.createDynamicsCompressor;
    AudioContext.prototype.createDynamicsCompressor = function () { const node = native.call(this); nodes.push(node); return node; };
    let preview: any;
    try {
      await engine.start(session);
      const context: AudioContext = engine.context, wrapper = engine.dynamics, node = wrapper.node, capture = engine.captureAudio();
      const tap = context.createAnalyser(); tap.fftSize = 8192; engine.transport.connect(tap);
      const samples = new Float32Array(8192), readings = [], targets: number[] = [], target = node.threshold.setTargetAtTime.bind(node.threshold);
      node.threshold.setTargetAtTime = (value: number, time: number, constant: number) => { targets.push(value); return target(value, time, constant); };
      const initial = node.threshold.value;
      const profileOrder = ['soft', 'balanced', 'open'] as const;
      for (const dynamics of profileOrder) {
        session.dynamics = dynamics; engine.update(session); engine.update(session);
        await waitForAudioTime(context, context.currentTime + .04); const moving = node.threshold.value;
        await waitForAudioTime(context, context.currentTime + .35); tap.getFloatTimeDomainData(samples);
        readings.push({ dynamics, moving, settled: node.threshold.value, peak: Math.max(...samples.map(Math.abs)),
          finite: samples.every(Number.isFinite), same: engine.dynamics === wrapper && wrapper.node === node });
      }
      const playing = capture.state(); await engine.pause(); const paused = capture.state(), frozenAt = context.currentTime;
      await new Promise(resolve => setTimeout(resolve, 60)); const frozen = context.currentTime === frozenAt;
      await engine.resume(); await waitForAudioTime(context, context.currentTime + .25); tap.getFloatTimeDomainData(samples);
      const resumed = capture.state(), resumedEnergy = samples.reduce((sum, value) => sum + value ** 2, 0), activeNodes = nodes.length;
      const config = [node.knee.value, node.ratio.value, node.attack.value, node.release.value];
      capture.dispose(); capture.dispose(); tap.disconnect(); await engine.stop();
      const stopped = capture.state(), cleared = engine.dynamics === undefined;
      const previewEngine: any = new AudioEngine(); preview = new AsmrPreview(() => {}, () => previewEngine);
      await preview.start(session, session.asmr.layers[0].id);
      const inherited = previewEngine.dynamics.node.threshold.value, previewCount = nodes.length;
      await preview.stop();
      return { initial, readings, targets, playing, paused, frozen, resumed, resumedEnergy, activeNodes, config, stopped, cleared, inherited, previewCount };
    } finally { AudioContext.prototype.createDynamicsCompressor = native; await preview?.stop(); await engine.stop(); }
  });
  expect(result.initial).toBe(-4); expect(result.activeNodes).toBe(1); expect(result.targets).toEqual([-18, -10, -4]);
  const thresholds = { soft: -18, balanced: -10, open: -4 };
  for (const reading of result.readings) {
    const diagnostic = JSON.stringify(reading);
    expect(reading.same).toBe(true); expect(reading.finite, diagnostic).toBe(true); expect(reading.peak, diagnostic).toBeGreaterThan(.001);
    expect(reading.moving, diagnostic).toBeGreaterThanOrEqual(-18); expect(reading.moving, diagnostic).toBeLessThanOrEqual(-4);
    expect(reading.settled, diagnostic).toBeCloseTo(thresholds[reading.dynamics], 2);
  }
  expect(result.config[0]).toBe(6); expect(result.config[1]).toBe(12); expect(result.config[2]).toBeCloseTo(.003, 7); expect(result.config[3]).toBe(.25);
  expect(result.playing).toBe('playing'); expect(result.paused).toBe('paused'); expect(result.frozen).toBe(true); expect(result.resumed).toBe('playing');
  expect(result.resumedEnergy).toBeGreaterThan(.001); expect(result.stopped).toBe('stopped'); expect(result.cleared).toBe(true);
  expect(result.inherited).toBe(-4); expect(result.previewCount).toBe(2);
});
