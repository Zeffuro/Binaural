import { expect, test } from '@playwright/test';
import type { AsmrLayer, AsmrSettings } from '../src/asmr-state';
import type { AsmrSpaceSettings } from '../src/asmr-space';

function stereoRecording(): Buffer {
  const rate = 24000, frames = rate * 2, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(3600 * Math.sin(frame * 2 * Math.PI * 200 / rate)), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(1200 * Math.sin(frame * 2 * Math.PI * 700 / rate)), 46 + frame * 4);
  }
  return bytes;
}

test('room state validates every bound, preserves omitted legacy shape and round-trips each room', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const roomPath = '/src/asmr-space.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', sharePath = '/src/share.ts';
    const { defaultAsmrSpace, parseAsmrSpace, asmrSpacePresets } = await import(roomPath);
    const { defaultAsmr, parseAsmr } = await import(statePath), { initialSession, parseSession } = await import(modelPath);
    const { sessionLink, readSharedSession } = await import(sharePath);
    const base = defaultAsmrSpace(), bad: unknown[] = [undefined, null, [], false, 1, 'room', {}];
    for (const [field, values] of Object.entries({ amount: [-.001, .351, NaN, Infinity, '.1', null], size: [.499, 1.501], warmth: [-.001, 1.001] })) {
      for (const value of values) bad.push({ ...base, [field]: value });
      const missing = { ...base }; delete missing[field]; bad.push(missing);
    }
    const rejects = (value: unknown) => { try { parseAsmrSpace(value); return false; } catch { return true; } };
    const layerRejects = bad.filter(value => value !== undefined).every(space => {
      try { parseAsmr({ level: .6, layers: [], space }); return false; } catch { return true; }
    });
    const boundaries = [0, .35].flatMap(amount => [.5, 1.5].flatMap(size => [0, 1].map(warmth => parseAsmrSpace({ amount, size, warmth }))));
    const presets: { id: string; settings: AsmrSpaceSettings }[] = asmrSpacePresets;
    const rooms = presets.map(preset => {
      const session = initialSession(); session.asmr = { ...defaultAsmr(), space: preset.settings };
      return { id: preset.id, settings: preset.settings, json: parseSession(JSON.parse(JSON.stringify(session))).asmr.space,
        share: readSharedSession(new URL(sessionLink(session)).hash).asmr.space };
    });
    return { defaults: base, legacy: parseAsmr({ level: .6, layers: [] }), rejected: bad.every(rejects), layerRejects, boundaries: boundaries.length, rooms };
  });
  expect(result.defaults).toEqual({ amount: 0, size: 1, warmth: .5 });
  expect(result.legacy).toEqual({ level: .6, layers: [], focus: false });
  expect(result.rejected).toBe(true); expect(result.layerRejects).toBe(true); expect(result.boundaries).toBe(8);
  expect(result.rooms.map(room => room.id)).toEqual(['dry', 'close', 'soft']);
  for (const room of result.rooms) { expect(room.json).toEqual(room.settings); expect(room.share).toEqual(room.settings); }
});

test('room impulse keeps zero-latency direct sound, three scaled arrivals, damping, isolated ears and a bounded tail', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/asmr-space.ts', { AsmrSpace } = await import(path);
    async function impulse(size: number, warmth: number, rate = 48000) {
      const onset = rate / 2;
      const context = new OfflineAudioContext(2, rate, rate), source = context.createBufferSource();
      const buffer = context.createBuffer(2, rate, rate); buffer.getChannelData(0)[onset] = 1;
      source.buffer = buffer;
      const room = new AsmrSpace(context, source, context.destination); room.update({ amount: .35, size, warmth });
      const initial = { delays: room.bank.delays.map((delay: DelayNode) => delay.delayTime.value), cutoff: room.bank.damping.frequency.value, q: room.bank.damping.Q.value };
      source.start(); const output = await context.startRendering(); room.dispose(); room.dispose();
      const left = output.getChannelData(0), right = output.getChannelData(1);
      const arrivals = [.011, .023, .037].map(delay => {
        const expected = onset + Math.round(delay * size * rate);
        let first = -1, energy = 0, variation = 0;
        for (let frame = expected - 2; frame < expected + 100; frame++) {
          if (frame >= expected - 2 && first === -1 && Math.abs(left[frame]) > 1e-7) first = frame;
          if (frame >= expected) { energy += left[frame] ** 2; variation += Math.abs(left[frame] - left[frame - 1]); }
        }
        return { offset: first - onset, expected: expected - onset, energy, variation };
      });
      let before = 0, tail = 0, sum = 0, rightPeak = 0;
      for (let frame = 0; frame < rate; frame++) {
        if (frame < onset || (frame > onset && frame < onset + Math.floor(.011 * size * rate))) before = Math.max(before, Math.abs(left[frame]));
        if (frame > onset + rate * .1) tail = Math.max(tail, Math.abs(left[frame]));
        sum += Math.abs(left[frame]); rightPeak = Math.max(rightPeak, Math.abs(right[frame]));
      }
      return { rate, size, warmth, initial, arrivals, direct: left[onset], before, tail, sum, rightPeak, finite: left.every(Number.isFinite) && right.every(Number.isFinite) };
    }
    return { small: await impulse(.5, 0), large: await impulse(1.5, 1), bright: await impulse(1.5, 0),
      rates: await Promise.all([8000, 24000, 44100].map(rate => impulse(1.5, 0, rate))) };
  });
  for (const room of [result.small, result.large, result.bright, ...result.rates]) {
    expect(room.direct, JSON.stringify(result)).toBeCloseTo(.65, 5); expect(room.before, JSON.stringify(result)).toBe(0); expect(room.tail).toBeLessThan(1e-8);
    expect(room.rightPeak).toBe(0); expect(room.sum).toBeLessThan(1.00001); expect(room.finite).toBe(true);
    for (const arrival of room.arrivals) { expect(Math.abs(arrival.offset - arrival.expected)).toBeLessThanOrEqual(1); expect(arrival.energy).toBeGreaterThan(1e-7); }
  }
  expect(result.large.arrivals[0].energy).toBeLessThan(result.bright.arrivals[0].energy / 3);
  expect(result.large.arrivals[0].variation).toBeLessThan(result.bright.arrivals[0].variation / 3);
});

test('dry room is exact PCM with no wet allocation and normalized wet summing retains stereo headroom', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/asmr-space.ts', { AsmrSpace } = await import(path);
    async function render(stage: 'reference' | 'dry' | 'wet' | 'disposed', rate = 48000, start = 0) {
      const context = new OfflineAudioContext(2, rate, rate), source = context.createBufferSource();
      const buffer = context.createBuffer(2, rate, rate), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      for (let frame = 0; frame < rate; frame++) {
        const sample = frame >= rate / 4 ? .8 : .6 * Math.sin(frame * .27);
        left[frame] = sample; right[frame] = -sample;
      }
      source.buffer = buffer;
      let delays = 0, filters = 0;
      const createDelay = context.createDelay.bind(context), createFilter = context.createBiquadFilter.bind(context);
      context.createDelay = (...args) => { delays++; return createDelay(...args); };
      context.createBiquadFilter = () => { filters++; return createFilter(); };
      let room;
      if (stage === 'reference') source.connect(context.destination);
      else {
        if (stage === 'disposed') source.connect(context.createGain()).connect(context.destination);
        room = new AsmrSpace(context, source, context.destination); room.update(stage === 'dry' ? undefined : { amount: .35, size: 1.5, warmth: 1 });
        if (stage === 'disposed') { room.dispose(); room.dispose(); room.update({ amount: .35, size: .5, warmth: 0 }); }
      }
      source.start(start); const output = await context.startRendering(); room?.dispose();
      const channels = [output.getChannelData(0), output.getChannelData(1)]; let peak = 0, peakFrame = 0;
      channels[0].forEach((value, frame) => { if (Math.abs(value) > peak) { peak = Math.abs(value); peakFrame = frame; } });
      return { channels, delays, filters, peak: { rate, start, peak, peakFrame, samples: [...channels[0].slice(Math.max(0, peakFrame - 3), peakFrame + 4)] } };
    }
    const reference = await render('reference'), dry = await render('dry'), wet = await render('wet'), disposed = await render('disposed');
    const lowerRate = await render('wet', 24000), delayed = await render('wet', 48000, .1);
    let dryError = 0, disposedError = 0, oppositeError = 0, peak = 0, referenceEnergy = 0, retainedEnergy = 0;
    for (let frame = 0; frame < 48000; frame++) {
      for (let ear = 0; ear < 2; ear++) {
        dryError = Math.max(dryError, Math.abs(reference.channels[ear][frame] - dry.channels[ear][frame]));
        disposedError = Math.max(disposedError, Math.abs(reference.channels[ear][frame] - disposed.channels[ear][frame]));
        referenceEnergy += reference.channels[ear][frame] ** 2; retainedEnergy += disposed.channels[ear][frame] ** 2;
        peak = Math.max(peak, Math.abs(wet.channels[ear][frame]));
      }
      oppositeError = Math.max(oppositeError, Math.abs(wet.channels[0][frame] + wet.channels[1][frame]));
    }
    for (const channel of [...lowerRate.channels, ...delayed.channels]) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    return { dryError, disposedError, oppositeError, peak, referenceEnergy, retainedEnergy, dryDelays: dry.delays, dryFilters: dry.filters, wetDelays: wet.delays,
      settled: wet.channels[0][47000], lowerRateSettled: lowerRate.channels[0][23500], delayedSettled: delayed.channels[0][47000],
      peaks: [wet.peak, lowerRate.peak, delayed.peak], finite: [...wet.channels, ...lowerRate.channels, ...delayed.channels].every(channel => channel.every(Number.isFinite)) };
  });
  expect(result.dryError).toBe(0); expect(result.disposedError).toBe(0); expect(result.dryDelays).toBe(0); expect(result.dryFilters).toBe(0); expect(result.wetDelays).toBe(3);
  expect(result.referenceEnergy).toBeGreaterThan(1000); expect(result.retainedEnergy).toBeGreaterThan(1000); expect(result.lowerRateSettled).toBeCloseTo(.8, 5);
  expect(result.delayedSettled).toBeCloseTo(.8, 5);
  expect(result.oppositeError).toBe(0); expect(result.peak, JSON.stringify(result)).toBeLessThanOrEqual(.80001); expect(result.settled).toBeCloseTo(.8, 5); expect(result.finite).toBe(true);
});

test('actual ASMR mixer applies room to generated, recorded stereo and native HRTF while explicit Dry stays exact', async ({ page }) => {
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', statePath = '/src/asmr-state.ts', assetsPath = '/src/audio/asmr-assets.ts';
    const { AsmrMixer } = await import(mixerPath), { makeAsmrLayer } = await import(statePath), { prepareAsmrRecordings } = await import(assetsPath);
    const results = [];
    for (const kind of ['generated', 'stereo', 'hrtf']) {
      const layer = { ...makeAsmrLayer(kind === 'generated' ? 'air' : 'recorded-hair'), level: .6, motion: 'still', pan: kind === 'generated' ? -1 : 0 };
      if (kind === 'hrtf') layer.spatial = { azimuth: 75, elevation: 25, distance: .6, motion: 'still' };
      const settings: AsmrSettings = { level: .8, layers: [layer] }; await prepareAsmrRecordings(settings);
      async function render(space?: AsmrSettings['space'], endAt?: number) {
        const context = new OfflineAudioContext(2, 88200, 44100), mixer = new AsmrMixer(context, context.destination, endAt);
        mixer.update({ ...settings, ...(space ? { space } : {}) });
        const output = await context.startRendering(); mixer.dispose(); mixer.dispose();
        return [output.getChannelData(0), output.getChannelData(1)];
      }
      const legacy = await render(), dry = await render({ amount: 0, size: .5, warmth: 1 }), wet = await render({ amount: .35, size: 1.5, warmth: .9 });
      const ended = await render({ amount: .35, size: 1.5, warmth: 1 }, 1);
      let dryError = 0, difference = 0, peak = 0, endedTail = 0; const energy = [0, 0];
      for (let ear = 0; ear < 2; ear++) for (let frame = 22050; frame < 88200; frame++) {
        dryError = Math.max(dryError, Math.abs(legacy[ear][frame] - dry[ear][frame]));
        difference += Math.abs(wet[ear][frame] - dry[ear][frame]); energy[ear] += wet[ear][frame] ** 2;
        peak = Math.max(peak, Math.abs(wet[ear][frame]));
        if (frame > 52920) endedTail = Math.max(endedTail, Math.abs(ended[ear][frame]));
      }
      results.push({ kind, dryError, difference: difference / 132300, energy, peak, endedTail, finite: wet.every(channel => channel.every(Number.isFinite)) });
    }
    return results;
  });
  for (const item of result) {
    expect(item.dryError).toBe(0); expect(item.difference).toBeGreaterThan(.00001); expect(item.peak).toBeLessThan(1);
    expect(item.endedTail).toBeLessThan(1e-8); expect(item.finite).toBe(true);
  }
  expect(result[0]!.energy[0]).toBeGreaterThan(.001); expect(result[0]!.energy[1]).toBe(0);
  expect(result[1]!.energy[0]).toBeGreaterThan(result[1]!.energy[1]! * 2); expect(result[1]!.energy[1]).toBeGreaterThan(.001);
  expect(result[2]!.energy[1]).toBeGreaterThan(result[2]!.energy[0]! * 1.1);
});

test('actual room WAV keeps full-render parity across the 30-second section boundary and leaves tone-only export exact', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const graphPath = '/src/audio/export-graph.ts', exportPath = '/src/audio/export.ts', statePath = '/src/asmr-state.ts';
    const modelPath = '/src/model.ts', assetsPath = '/src/audio/asmr-assets.ts';
    const { exportGraph } = await import(graphPath), { renderWav } = await import(exportPath), { makeAsmrLayer } = await import(statePath);
    const { initialSession } = await import(modelPath), { prepareAsmrRecordings } = await import(assetsPath);
    const session = initialSession(); session.mode = 'asmr'; session.master = .4; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: .7, space: { amount: .35, size: 1.5, warmth: 1 },
      variation: { mode: 'natural', seed: 731, amount: .55, phraseSeconds: 7.3, turnSeconds: 90 }, layers: [
        { ...makeAsmrLayer('air'), rate: .73, motion: 'still', pan: -.6 },
        { ...makeAsmrLayer('recorded-hair'), rate: 1.1, motion: 'still', spatial: { azimuth: 60, elevation: 25, distance: .5, motion: 'sweep' } },
      ] };
    await prepareAsmrRecordings(session.asmr);
    const frames = 31 * 44100, context = new OfflineAudioContext(2, frames, 44100), cleanup = exportGraph(context, session, 0, undefined);
    const full = await context.startRendering(); cleanup();
    const wav = await renderWav(session, 31), bytes = new DataView(await wav.arrayBuffer());
    let error = 0, boundaryError = 0, energy = 0, peak = 0;
    for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < 2; ear++) {
      const actual = bytes.getInt16(44 + frame * 4 + ear * 2, true) / 32768, expected = full.getChannelData(ear)[frame];
      error = Math.max(error, Math.abs(actual - expected)); energy += actual ** 2; peak = Math.max(peak, Math.abs(actual));
      if (Math.abs(frame / 44100 - 30) < .1) boundaryError = Math.max(boundaryError, Math.abs(actual - expected));
    }
    session.mode = 'binaural'; const toneWet = new Uint8Array(await (await renderWav(session, .2)).arrayBuffer());
    delete session.asmr.space; const toneDry = new Uint8Array(await (await renderWav(session, .2)).arrayBuffer());
    session.mode = 'asmr'; session.timelineDuration = .6; session.asmr.space = { amount: .35, size: 1.5, warmth: 1 };
    const ended = new DataView(await (await renderWav(session, 1)).arrayBuffer()); let endedTail = 0;
    for (let frame = 30870; frame < 44100; frame++) for (let ear = 0; ear < 2; ear++) endedTail = Math.max(endedTail, Math.abs(ended.getInt16(44 + frame * 4 + ear * 2, true)));
    return { bytes: wav.size, error, boundaryError, energy, peak, endedTail, toneExact: toneWet.every((value, index) => value === toneDry[index]) };
  });
  expect(result.bytes).toBe(44 + 31 * 44100 * 4); expect(result.error).toBeLessThan(.00015); expect(result.boundaryError).toBeLessThan(.00015);
  expect(result.energy).toBeGreaterThan(1); expect(result.peak).toBeLessThan(1); expect(result.endedTail).toBe(0); expect(result.toneExact).toBe(true);
});

test('@live room edits, mute, pause and disposal retain direct-source cues and bounded audio', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const spacePath = '/src/audio/asmr-space.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath), { AsmrSpace } = await import(spacePath);
    const { waitForAudioTime } = await import(clockPath);
    const session = initialSession(); session.mode = 'asmr'; session.master = .5; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: .8, layers: [{ ...makeAsmrLayer('air'), motion: 'still', pan: -1 },
      { ...makeAsmrLayer('recorded-hair'), motion: 'still', spatial: { azimuth: 70, elevation: 20, distance: .5, motion: 'still' } }] };
    const engine = new AudioEngine(); await engine.start(session);
    const context: AudioContext = engine.context, mixer = engine.asmr, dryUnallocated = mixer.space.bank === undefined;
    const constant = context.createConstantSource(), transitionTap = context.createAnalyser();
    constant.offset.value = .4; transitionTap.fftSize = 8192;
    const transitionRoom = new AsmrSpace(context, constant, transitionTap); constant.start();
    const analyser = context.createAnalyser(); analyser.fftSize = 2048; mixer.bus.connect(analyser);
    const samples = new Float32Array(2048);
    const measure = () => {
      analyser.getFloatTimeDomainData(samples); let energy = 0, peak = 0;
      for (const value of samples) { energy += value ** 2; peak = Math.max(peak, Math.abs(value)); }
      return { rms: Math.sqrt(energy / samples.length), peak, finite: samples.every(Number.isFinite) };
    };
    await waitForAudioTime(context, context.currentTime + .4); const dry = measure();
    const transitionSamples = new Float32Array(8192);
    let transitionJump = 0, transitionPeak = 0;
    for (const settings of [{ amount: .35, size: 1.5, warmth: 1 }, { amount: .12, size: .5, warmth: 0 },
      { amount: .35, size: 1.5, warmth: 1 }, { amount: 0, size: 1, warmth: .5 }]) {
      transitionRoom.update(settings);
      await waitForAudioTime(context, context.currentTime + .08); transitionTap.getFloatTimeDomainData(transitionSamples);
      for (let index = 1; index < transitionSamples.length; index++) {
        transitionJump = Math.max(transitionJump, Math.abs(transitionSamples[index] - transitionSamples[index - 1]));
        transitionPeak = Math.max(transitionPeak, Math.abs(transitionSamples[index]));
      }
    }
    transitionRoom.dispose(); constant.stop(); constant.disconnect(); transitionTap.disconnect();
    session.asmr.space = { amount: .35, size: 1.5, warmth: 1 }; engine.update(session);
    const bank = mixer.space.bank, bankReused = [];
    const outputTap = context.createAnalyser(); outputTap.fftSize = 2048;
    bank.direct.connect(outputTap); bank.wet.connect(outputTap);
    await waitForAudioTime(context, context.currentTime + .4);
    engine.visualFrame(); await waitForAudioTime(context, context.currentTime + .05); const cues = engine.visualFrame().asmr;
    const directCues = [...mixer.voices.values()].every(voice => voice.cueTap && voice.cueTap.output === (voice.position?.outputNode ?? voice.panner));
    const wetMeasures = [];
    for (const space of [{ amount: .12, size: .5, warmth: 0 }, { amount: .35, size: 1.5, warmth: 1 }, { amount: 0, size: 1, warmth: .5 }]) {
      session.asmr.space = space; engine.update(session); bankReused.push(mixer.space.bank === bank);
      await waitForAudioTime(context, context.currentTime + .2);
      outputTap.getFloatTimeDomainData(samples);
      wetMeasures.push({ finite: samples.every(Number.isFinite), peak: Math.max(...samples.map(Math.abs)) });
    }
    session.asmr.space.amount = .35; session.asmr.layers.forEach((layer: AsmrLayer) => layer.muted = true); engine.update(session);
    const mutedCues = engine.visualFrame().asmr.length;
    await waitForAudioTime(context, context.currentTime + .55); outputTap.getFloatTimeDomainData(samples);
    const mutedPeak = Math.max(...samples.map(Math.abs));
    session.asmr.layers.forEach((layer: AsmrLayer) => layer.muted = false); engine.update(session);
    await waitForAudioTime(context, context.currentTime + .25);
    await engine.pause(); const pausedAt = context.currentTime, pausedCues = engine.visualFrame().asmr.length;
    await new Promise(resolve => setTimeout(resolve, 100)); const frozen = context.currentTime === pausedAt;
    await engine.resume(); await waitForAudioTime(context, context.currentTime + .25);
    outputTap.getFloatTimeDomainData(samples); const resumedPeak = Math.max(...samples.map(Math.abs));
    analyser.disconnect(); outputTap.disconnect(); await engine.stop(); mixer.dispose(); mixer.update(session.asmr);
    return { dryUnallocated, dry, transitionJump, transitionPeak, directCues, cueCount: cues.length, bankReused, wetMeasures, mutedCues, mutedPeak, pausedCues, frozen, resumedPeak,
      disposed: mixer.voices.size === 0 && mixer.space.bank === undefined && context.state === 'closed' };
  });
  expect(result.dryUnallocated).toBe(true); expect(result.dry.rms).toBeGreaterThan(.001); expect(result.dry.finite).toBe(true);
  expect(result.transitionJump).toBeLessThan(.01); expect(result.transitionPeak).toBeGreaterThan(.25); expect(result.transitionPeak).toBeLessThanOrEqual(.40001);
  expect(result.directCues).toBe(true); expect(result.cueCount).toBe(2); expect(result.bankReused).toEqual([true, true, true]);
  for (const reading of result.wetMeasures) { expect(reading.finite).toBe(true); expect(reading.peak).toBeLessThan(1); expect(reading.peak).toBeGreaterThan(.001); }
  expect(result.mutedCues).toBe(0); expect(result.mutedPeak).toBeLessThan(.00001); expect(result.pausedCues).toBe(0);
  expect(result.frozen).toBe(true); expect(result.resumedPeak).toBeGreaterThan(.001); expect(result.disposed).toBe(true);
});
