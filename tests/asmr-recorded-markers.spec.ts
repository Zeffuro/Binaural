import { expect, test } from '@playwright/test';
import type { AsmrMarkerPose, AsmrMarkerSample } from '../src/audio/asmr-markers';

test('recorded actions follow stereo energy, real gaps and sustained contact without changing source samples', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const recordedPath = '/src/audio/asmr-recorded-markers.ts', markerPath = '/src/audio/asmr-markers.ts';
    const { analyzeRecordedActions, recordedMarkerEvents } = await import(recordedPath), { sourceMarker } = await import(markerPath);
    const signal = new Float32Array(1200);
    signal.fill(.4, 100, 180); signal.fill(.2, 260, 340); signal.fill(.8, 500, 560); signal.fill(.8, 800, 830);
    const opposite = Float32Array.from(signal, value => -value), before = signal.slice(), oppositeBefore = opposite.slice();
    const events = analyzeRecordedActions([signal, opposite], 1000);
    const reference = events.map((event: { start: number; length: number; contact: { values: Float32Array } }) =>
      ({ start: event.start, length: event.length, values: Array.from(event.contact.values) }));
    let invariantError = 0;
    const alternatives = [[signal], [opposite, signal], [signal, Float32Array.from(signal, value => value * .3)],
      [Float32Array.from(signal, value => value * .25), Float32Array.from(opposite, value => value * .25)]];
    const invariantWindows = alternatives.every(channels => {
      const actual = analyzeRecordedActions(channels, 1000);
      if (actual.length !== events.length) return false;
      return actual.every((event: { start: number; length: number; contact: { values: Float32Array } }, index: number) => {
        const expected = reference[index];
        for (let item = 0; item < event.contact.values.length; item++) invariantError = Math.max(invariantError, Math.abs(event.contact.values[item] - expected.values[item]));
        return event.start === expected.start && event.length === expected.length && event.contact.values.length === expected.values.length;
      });
    });
    const hysteresis = new Float32Array(500);
    hysteresis.fill(.06, 50, 100); hysteresis.fill(.8, 100, 140); hysteresis.fill(.06, 140, 180);
    hysteresis.fill(.02, 180, 300); hysteresis.fill(.8, 340, 380);
    const continuous = analyzeRecordedActions([new Float32Array(1003).fill(.4)], 1000);
    const bridge = (gap: number) => {
      const samples = new Float32Array(500); samples.fill(.4, 100, 160); samples.fill(.4, 160 + gap, 220 + gap);
      return analyzeRecordedActions([samples], 1000).map((event: { start: number; length: number }) => [event.start, event.length]);
    };
    const context = new OfflineAudioContext(2, 1, 44100), buffer = context.createBuffer(2, signal.length, 44100);
    buffer.copyToChannel(signal, 0); buffer.copyToChannel(opposite, 1);
    const cached = recordedMarkerEvents(buffer), clone = context.createBuffer(2, signal.length, 44100);
    clone.copyToChannel(signal, 0); clone.copyToChannel(opposite, 1);
    return { windows: events.map((event: { start: number; length: number }) => [event.start, event.length]),
      invariantWindows, invariantError, unchanged: signal.every((value, index) => value === before[index]) &&
        opposite.every((value, index) => value === oppositeBefore[index]) && buffer.getChannelData(0).every((value, index) => value === before[index]),
      hysteresis: analyzeRecordedActions([hysteresis], 1000).map((event: { start: number; length: number }) => [event.start, event.length]),
      bridged: bridge(120), separated: bridge(130),
      continuous: continuous.map((event: { start: number; length: number; contact: { values: Float32Array } }) =>
        [event.start, event.length, event.contact.values.length]),
      silent: analyzeRecordedActions([new Float32Array(1000)], 1000).length,
      invalid: [analyzeRecordedActions([], 1000), analyzeRecordedActions([signal], NaN),
        analyzeRecordedActions([signal, new Float32Array(5)], 1000), analyzeRecordedActions([Float32Array.of(NaN)], 1000)].every(events => !events.length),
      onset: sourceMarker(events, 100, 1200, 1000), middle: sourceMarker(events, 220, 1200, 1000),
      peak: sourceMarker(events, 505, 1200, 1000),
      edge: sourceMarker(events, 180, 1200, 1000), quietContact: sourceMarker(events, 185, 1200, 1000),
      ended: sourceMarker(events, 340, 1200, 1000), seam: sourceMarker(events, 0, 1200, 1000),
      generated: sourceMarker([{ start: 100, length: 240 }], 220, 1200, 1000),
      bounded: events.every((event: { contact: { values: Float32Array } }) => event.contact.values.every(value => Number.isFinite(value) && value >= 0 && value <= .850001)),
      cache: cached === recordedMarkerEvents(buffer), separate: cached !== recordedMarkerEvents(clone) };
  });
  expect(result.windows).toEqual([[100, 240], [500, 60]]); expect(result.hysteresis).toEqual([[100, 80], [340, 40]]);
  expect(result.bridged).toEqual([[100, 240]]); expect(result.separated).toEqual([[100, 60], [290, 60]]);
  expect(result.invariantWindows).toBe(true); expect(result.invariantError).toBeLessThan(1e-6); expect(result.unchanged).toBe(true);
  expect(result.continuous).toEqual([[0, 1003, 101]]); expect(result.silent).toBe(0); expect(result.invalid).toBe(true);
  expect(result.onset.pose.progress).toBe(0); expect(result.onset.pose.contact).toBeCloseTo(.425, 6);
  expect(result.middle.pose.progress).toBe(.5); expect(result.middle.pose.contact).toBe(0);
  expect(result.edge.pose.contact).toBeCloseTo(.2125, 6); expect(result.quietContact.pose.contact).toBe(0);
  expect(result.peak.pose.contact).toBe(.85);
  expect(result.ended).toBeUndefined(); expect(result.seam).toBeUndefined();
  expect(result.generated.pose.contact).toBeCloseTo(.85 * Math.exp(-.12 / .065), 12);
  expect(result.bounded).toBe(true); expect(result.cache).toBe(true); expect(result.separate).toBe(true);
});

test('@live recorded contacts reach engine visual cues with measured ears, midpoint timing and transport cleanup', async ({ page }) => {
  test.setTimeout(90_000); await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
    const clockPath = '/tests/helpers/audio-clock.ts', cuePath = '/src/audio/asmr-cues.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { waitForAudioTime } = await import(clockPath), { AsmrCueDetector, earRms } = await import(cuePath);
    const engine = new AudioEngine(), session = initialSession();
    session.mode = 'asmr'; session.master = .7; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('recorded-sketching'), level: .8, motion: 'still', pan: .65 }],
      variation: { mode: 'natural', seed: 731, amount: .35, phraseSeconds: 4, turnSeconds: 30 } };
    await engine.start(session);
    try {
      const context = engine.context, started = context.currentTime, layer = session.asmr.layers[0], voice = engine.asmr.voices.get(layer.id), source = voice.source;
      const baseline = new AsmrCueDetector(layer.id, layer.sound), read = source.readMarker.bind(source), clear = source.clearMarkers.bind(source);
      let queried = 0, queryError = 0, poseError = 0, measuredError = 0, earError = 0, matched = 0, quiet = 0, noSignal = 0, clears = 0;
      let outputCues = 0, captureCues = 0, analysisCues = 0, side = 0;
      const observed: { marker: AsmrMarkerPose | null | undefined } = { marker: undefined };
      source.readMarker = (time: number) => { queried = time; observed.marker = read(time); return observed.marker; };
      source.clearMarkers = () => { clears++; baseline.reset(); clear(); };
      const detectorRead = voice.cue.read.bind(voice.cue);
      voice.cue.read = (time: number, left: number, right: number, marker: AsmrMarkerPose | null | undefined) => {
        const expected = baseline.read(time, left, right), actual = detectorRead(time, left, right, marker);
        if (expected && actual) measuredError = Math.max(measuredError, Math.abs(expected.strength - actual.strength), Math.abs(expected.pan - actual.pan));
        if (time > started + .6) earError = Math.max(earError, Math.abs(left - earRms(voice.cueTap.samples[0]) * .7), Math.abs(right - earRms(voice.cueTap.samples[1]) * .7));
        if (marker === null) { quiet++; if (actual?.contact) noSignal++; }
        if (marker && actual) {
          matched++; side = Math.max(side, actual.pan);
          poseError = Math.max(poseError, Math.abs(marker.progress - actual.progress), Math.abs(marker.contact - actual.contact));
          if (!(left > 0 || right > 0)) noSignal++;
        }
        return actual;
      };
      engine.visualFrame(); await waitForAudioTime(context, context.currentTime + .7);
      for (let index = 0; index < 220; index++) {
        await waitForAudioTime(context, context.currentTime + .02);
        if (index === 60) { layer.rate = 1.2; engine.update(session); }
        const timeline = index % 3 === 0 ? 'output' : index % 3 === 1 ? 'capture' : 'analysis';
        const frame = engine.visualFrame(timeline);
        queryError = Math.max(queryError, Math.abs(queried - (frame.time - 512 / context.sampleRate)));
        const cue = frame.asmr.find((cue: { id: string }) => cue.id === layer.id);
        if (cue) { if (timeline === 'output') outputCues++; else if (timeline === 'capture') captureCues++; else analysisCues++; }
        if (timeline === 'analysis' && cue && observed.marker) poseError = Math.max(poseError,
          Math.abs(cue.progress - observed.marker.progress), Math.abs(cue.contact - observed.marker.contact));
      }
      voice.cue.read = detectorRead;
      const beforeMute = clears; layer.muted = true; engine.update(session);
      const muted = engine.visualFrame().asmr.length, muteCleared = clears > beforeMute;
      layer.muted = false; engine.update(session); engine.visualFrame(); const beforePause = clears;
      await engine.pause(); const paused = engine.visualFrame('output').asmr.length, pauseCleared = clears > beforePause;
      await engine.resume(); session.master = 0; engine.update(session); const zero = engine.visualFrame('capture').asmr.length;
      session.master = .7; layer.sound = 'wood'; engine.update(session);
      const replaced = engine.asmr.voices.get(layer.id) !== voice, disposedMarker = source.readMarker(context.currentTime - 512 / context.sampleRate);
      return { matched, quiet, queryError, poseError, measuredError, earError, noSignal, side, outputCues, captureCues, analysisCues,
        muted, muteCleared, paused, pauseCleared, zero, replaced, disposedMarker };
    } finally { await engine.stop(); }
  });
  const diagnostic = JSON.stringify(result);
  expect(result.matched, diagnostic).toBeGreaterThan(3); expect(result.quiet, diagnostic).toBeGreaterThan(0);
  expect(result.queryError).toBeLessThan(1e-9); expect(result.poseError).toBeLessThan(1e-9); expect(result.measuredError).toBe(0);
  expect(result.earError).toBeLessThan(1e-9); expect(result.noSignal).toBe(0); expect(result.side, diagnostic).toBeGreaterThan(.1);
  expect(result.outputCues, diagnostic).toBeGreaterThan(0); expect(result.captureCues, diagnostic).toBeGreaterThan(0); expect(result.analysisCues).toBeGreaterThan(0);
  expect(result.muted).toBe(0); expect(result.muteCleared).toBe(true); expect(result.paused).toBe(0); expect(result.pauseCleared).toBe(true);
  expect(result.zero).toBe(0); expect(result.replaced).toBe(true); expect(result.disposedMarker).toBeUndefined();
});

test('all fifteen actual recordings have bounded native-frame action envelopes and retain exact paired PCM', async ({ page }, testInfo) => {
  test.setTimeout(120_000); await page.goto('/');
  const results = await page.evaluate(async () => {
    const assetsPath = '/src/audio/asmr-assets.ts', statePath = '/src/asmr-state.ts', recordedPath = '/src/audio/asmr-recorded-markers.ts';
    const { prepareAsmrRecordings, recordedAsmrBuffer } = await import(assetsPath), { recordedAsmrSounds, makeAsmrLayer } = await import(statePath);
    const { recordedMarkerEvents } = await import(recordedPath), results = [];
    for (const { id } of recordedAsmrSounds) {
      await prepareAsmrRecordings({ level: 1, layers: [makeAsmrLayer(id)] });
      const buffer: AudioBuffer = recordedAsmrBuffer(id), channels = Array.from({ length: buffer.numberOfChannels }, (_, ear) => buffer.getChannelData(ear));
      const before = channels.map(channel => channel.slice());
      const events = recordedMarkerEvents(buffer), stride = Math.round(buffer.sampleRate * .01);
      let envelopeError = 0, peak = 0, finite = true, unchanged = true;
      const rms = new Float32Array(Math.ceil(buffer.length / stride));
      for (let window = 0; window < rms.length; window++) {
        const start = window * stride, end = Math.min(buffer.length, start + stride); let energy = 0;
        for (let ear = 0; ear < before.length; ear++) for (let frame = start; frame < end; frame++) {
          const value = channels[ear][frame]; finite &&= Number.isFinite(value);
          unchanged &&= value === before[ear][frame]; energy += value ** 2;
        }
        rms[window] = Math.sqrt(energy / ((end - start) * before.length)); peak = Math.max(peak, rms[window]);
      }
      const bounded = events.every((event: { start: number; length: number; contact: { stride: number; values: Float32Array } }, index: number) => {
        const { contact } = event;
        if (!contact) return false;
        for (let item = 0; item < contact.values.length; item++) envelopeError = Math.max(envelopeError,
          Math.abs(contact.values[item] - Math.min(.85, rms[event.start / stride + item] / peak * .85)));
        return Number.isInteger(event.start) && event.start % stride === 0 && event.length >= buffer.sampleRate * .04 &&
          event.start + event.length <= buffer.length && event.length > 0 && contact.stride === stride &&
          contact.values.length === Math.ceil(event.length / stride) && (!index || events[index - 1].start + events[index - 1].length < event.start) &&
          contact.values.every(value => Number.isFinite(value) && value >= 0 && value <= .850001);
      });
      results.push({ id, channels: buffer.numberOfChannels, rate: buffer.sampleRate, frames: buffer.length, duration: buffer.duration,
        events: events.length, bounds: events.map((event: { start: number; length: number }) => [event.start, event.length]),
        bounded, finite, unchanged, envelopeError, cached: events === recordedMarkerEvents(buffer) });
    }
    return results;
  });
  await testInfo.attach('recorded-action-coverage.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results).toHaveLength(15); expect(new Set(results.map(item => item.id)).size).toBe(15);
  for (const item of results) {
    const diagnostic = JSON.stringify(item);
    expect(item.channels, diagnostic).toBeGreaterThanOrEqual(1); expect(item.channels).toBeLessThanOrEqual(2); expect(item.rate).toBe(44100);
    expect(item.frames).toBeGreaterThan(0); expect(item.duration).toBeLessThanOrEqual(60);
    expect(item.events, diagnostic).toBeGreaterThan(0); expect(item.events).toBeLessThanOrEqual(Math.floor(item.duration / .04));
    expect(item.bounded, diagnostic).toBe(true); expect(item.finite).toBe(true); expect(item.unchanged).toBe(true);
    expect(item.envelopeError, diagnostic).toBeLessThan(1e-7); expect(item.cached).toBe(true);
  }
});

test('actual recorded markers follow independent source positions through fractional pace, a-rate changes, seeks, turns and seams', async ({ page }, testInfo) => {
  test.setTimeout(180_000); await page.goto('/');
  const results = await page.evaluate(async () => {
    const assetsPath = '/src/audio/asmr-assets.ts', statePath = '/src/asmr-state.ts', recordedPath = '/src/audio/asmr-recorded-markers.ts';
    const phrasePath = '/src/audio/asmr-phrases.ts', markerPath = '/src/audio/asmr-markers.ts';
    const { prepareAsmrRecordings, recordedAsmrBuffer } = await import(assetsPath), { recordedAsmrSounds, makeAsmrLayer } = await import(statePath);
    const { recordedMarkerEvents } = await import(recordedPath), { AsmrPhraseRenderer, planAsmrPhrase } = await import(phrasePath), { sourceMarker } = await import(markerPath);
    const outputRate = 1200, count = 24 * outputRate, results = [];
    for (const { id } of recordedAsmrSounds) {
      await prepareAsmrRecordings({ level: 1, layers: [makeAsmrLayer(id)] });
      const buffer: AudioBuffer = recordedAsmrBuffer(id), channels = Array.from({ length: buffer.numberOfChannels }, (_, ear) => buffer.getChannelData(ear));
      const events = recordedMarkerEvents(buffer), pcm = { sampleRate: buffer.sampleRate, channels, events: [events, events, events] };
      let error = 0, poseError = 0, markerMismatch = 0, observed = 0, active = 0, quiet = 0, seams = 0, sectionError = 0, sections = 0;
      const variants = new Set<number>();
      for (const mode of ['natural', 'turns']) for (const first of [0, 33 * outputRate + 17, 10800 * outputRate + 13]) {
        const config = { variation: { mode, seed: 731, amount: .4, phraseSeconds: 40, turnSeconds: 5.3 }, ordinal: 0, eligible: [0, 1] };
        const rates = Float32Array.from({ length: count }, (_, frame) => first ? .7 : 1.2 + frame / count * .6);
        const output = channels.map(() => new Float32Array(count)), plain = channels.map(() => new Float32Array(count)), samples: AsmrMarkerSample[] = [];
        new AsmrPhraseRenderer(pcm, config).render(output, outputRate, first, rates, (sample: AsmrMarkerSample) => samples.push(sample));
        new AsmrPhraseRenderer({ sampleRate: buffer.sampleRate, channels }, config).render(plain, outputRate, first, rates);
        const observations = new Map(samples.map(sample => [Math.round(sample.time * outputRate), sample]));
        let previousKey = '', previousElapsed = -1, previousCycle = -1, phase = 0;
        for (let frame = 0; frame < count; frame++) {
          const time = (first + frame) / outputRate, cell = Math.floor(time / 40), turn = mode === 'turns' ? Math.floor(time / 5.3) : 0;
          const phrase = planAsmrPhrase(config, cell, buffer.duration, turn), elapsed = time - phrase.start, key = `${cell}:${turn}`;
          if (key !== previousKey || previousElapsed < 0 || elapsed < 0) phase = elapsed * rates[frame];
          else phase += rates[frame] / outputRate;
          previousKey = key; previousElapsed = elapsed;
          const sounding = phrase.active && elapsed >= 0 && elapsed < phrase.duration;
          const unwrapped = (phrase.offset + phase * phrase.rate) * buffer.sampleRate, cycle = Math.floor(unwrapped / buffer.length);
          const position = (unwrapped % buffer.length + buffer.length) % buffer.length;
          if (sounding && previousCycle >= 0 && cycle !== previousCycle) seams++;
          previousCycle = sounding ? cycle : -1;
          const turnFade = mode === 'turns' ? Math.min(1, (time - turn * 5.3) / .35, ((turn + 1) * 5.3 - time) / .35) : 1;
          const fade = Math.min(turnFade, elapsed / phrase.fade, (phrase.duration - elapsed) / phrase.fade);
          const envelope = sounding ? Math.sin(fade * Math.PI / 2) ** 2 * phrase.gain : 0;
          const index = Math.floor(position), fraction = position - index;
          for (let ear = 0; ear < channels.length; ear++) {
            const input = channels[ear], expected = (input[index] + (input[(index + 1) % buffer.length] - input[index]) * fraction) * envelope;
            error = Math.max(error, Math.abs(output[ear][frame] - expected), Math.abs(output[ear][frame] - plain[ear][frame]));
          }
          const sample = observations.get(first + frame);
          if (!sample) continue;
          observed++; variants.add(phrase.variant);
          const expected = sounding ? sourceMarker(events, position, buffer.length, buffer.sampleRate)?.pose ?? null : null;
          if (expected && sample.pose) { active++; poseError = Math.max(poseError, Math.abs(expected.progress - sample.pose.progress), Math.abs(expected.contact - sample.pose.contact)); }
          else if (expected !== sample.pose) markerMismatch++;
          else quiet++;
        }
        if (first) for (let index = 0; index < samples.length; index += 23) {
          const sample = samples[index], frame = Math.round(sample.time * outputRate), section = channels.map(() => new Float32Array(1));
          const reference: { sample?: AsmrMarkerSample } = {};
          new AsmrPhraseRenderer(pcm, config).render(section, outputRate, frame, .7, (marker: AsmrMarkerSample) => reference.sample = marker);
          if (JSON.stringify(reference.sample) !== JSON.stringify(sample)) markerMismatch++;
          for (let ear = 0; ear < channels.length; ear++) sectionError = Math.max(sectionError, Math.abs(section[ear][0] - output[ear][frame - first]));
          sections++;
        }
      }
      results.push({ id, error, poseError, markerMismatch, observed, active, quiet, seams, sectionError, sections, variants: variants.size });
    }
    return results;
  });
  await testInfo.attach('recorded-source-position-parity.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results).toHaveLength(15);
  for (const item of results) {
    const diagnostic = JSON.stringify(item);
    expect(item.error, diagnostic).toBeLessThan(1e-6); expect(item.poseError, diagnostic).toBeLessThan(1e-7);
    expect(item.markerMismatch, diagnostic).toBe(0); expect(item.observed).toBeGreaterThan(100); expect(item.active, diagnostic).toBeGreaterThan(0);
    expect(item.quiet, diagnostic).toBeGreaterThan(0); expect(item.seams, diagnostic).toBeGreaterThan(0);
    expect(item.sectionError).toBe(0); expect(item.sections).toBeGreaterThan(20); expect(item.variants).toBeGreaterThan(1);
  }
});

test('@live actual recorded phrase transport is lazy, epoch-safe, paused and reset with exact recording poses', async ({ page }) => {
  test.setTimeout(45_000); await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const sourcePath = '/src/audio/asmr-phrase-source.ts', statePath = '/src/asmr-state.ts', assetPath = '/src/audio/asmr-assets.ts';
    const recordedPath = '/src/audio/asmr-recorded-markers.ts', phrasePath = '/src/audio/asmr-phrases.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { prepareAsmrAudio, createAsmrPhraseSource, phraseConfig } = await import(sourcePath), { makeAsmrLayer } = await import(statePath);
    const { recordedAsmrBuffer } = await import(assetPath), { recordedMarkerEvents } = await import(recordedPath);
    const { AsmrPhraseRenderer } = await import(phrasePath), { waitForAudioTime } = await import(clockPath);
    const context = new AudioContext(); await context.suspend();
    const layer = { ...makeAsmrLayer('recorded-running-water'), rate: .7 }, settings = { level: 1, layers: [layer],
      variation: { mode: 'natural', seed: 731, amount: .7, phraseSeconds: 4, turnSeconds: 90 } };
    await prepareAsmrAudio(context, settings);
    const buffer: AudioBuffer = recordedAsmrBuffer(layer.sound), events = recordedMarkerEvents(buffer);
    const pcm = { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, ear) => buffer.getChannelData(ear)), events: [events, events, events] };
    const OriginalNode = window.AudioWorkletNode; let node!: AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(OriginalNode, { construct(target, args) { node = Reflect.construct(target, args); return node; } });
    const offset = 30.75, origin = Math.round((context.currentTime - offset) * context.sampleRate), config = phraseConfig(settings, 0);
    const source = createAsmrPhraseSource(context, layer, config, offset); window.AudioWorkletNode = OriginalNode;
    const batches: { markerEpoch: number; markers: AsmrMarkerSample[]; frame: number }[] = [];
    node.port.addEventListener('message', event => { if (event.data.markers && Number.isFinite(event.data.frame)) batches.push(event.data); });
    source.connect(context.destination); source.start();
    try {
      await context.resume(); await waitForAudioTime(context, context.currentTime + .15);
      const lazy = batches.length === 0, first = source.readMarker(context.currentTime);
      await waitForAudioTime(context, context.currentTime + 2.5);
      const initial = batches.flatMap(batch => batch.markers), beforeConfig = batches.length;
      let error = 0, mismatch = 0, active = 0;
      for (const sample of initial) {
        const reference: { pose?: AsmrMarkerPose | null } = {};
        new AsmrPhraseRenderer(pcm, config).render(pcm.channels.map(() => new Float32Array(1)), context.sampleRate,
          Math.round(sample.time * context.sampleRate) - origin, layer.rate, (marker: AsmrMarkerSample) => reference.pose = marker.pose);
        if (sample.pose && reference.pose) { active++; error = Math.max(error, Math.abs(sample.pose.progress - reference.pose.progress), Math.abs(sample.pose.contact - reference.pose.contact)); }
        else if (sample.pose !== reference.pose) mismatch++;
      }
      source.configure({ ...config, variation: { ...config.variation, seed: 912 } });
      const reset = source.readMarker(context.currentTime - .02);
      await waitForAudioTime(context, context.currentTime + .2);
      const changed = batches.slice(beforeConfig).flatMap(batch => batch.markers);
      const transition = changed.some(sample => sample.pose === undefined), recovered = changed.some(sample => sample.pose !== undefined && sample.event !== 'transition');
      await context.suspend(); const pausedTime = context.currentTime;
      source.clearMarkers(); source.clearMarkers(); const oldEpoch = batches.at(-1)!.markerEpoch;
      const cleared = source.readMarker(context.currentTime - .02);
      node.port.dispatchEvent(new MessageEvent('message', { data: { markerEpoch: oldEpoch,
        markers: [{ time: context.currentTime - .02, pose: { progress: .5, contact: .85 }, event: 'stale' }] } }));
      const staleRejected = source.readMarker(context.currentTime - .02) === undefined;
      await new Promise(resolve => setTimeout(resolve, 100)); const paused = context.currentTime === pausedTime;
      await context.resume(); await waitForAudioTime(context, context.currentTime + .2);
      const newEpoch = batches.at(-1)!.markerEpoch > oldEpoch;
      source.stop(); source.disconnect(); source.disconnect(); const disposed = source.readMarker(context.currentTime);
      const rateBounded = batches.every((batch, index) => !index || batch.markerEpoch !== batches[index - 1].markerEpoch ||
        batch.frame - batches[index - 1].frame >= Math.ceil(context.sampleRate / 30));
      return { lazy, first, initial: initial.length, active, error, mismatch, reset, transition, recovered, cleared, staleRejected, paused, newEpoch, disposed, rateBounded };
    } finally { window.AudioWorkletNode = OriginalNode; await context.close(); }
  });
  expect(result.lazy).toBe(true); expect(result.first).toBeUndefined(); expect(result.initial).toBeGreaterThan(15);
  expect(result.active, JSON.stringify(result)).toBeGreaterThan(0); expect(result.error).toBeLessThan(1e-6); expect(result.mismatch).toBe(0);
  expect(result.reset).toBeUndefined(); expect(result.transition).toBe(true); expect(result.recovered).toBe(true);
  expect(result.cleared).toBeUndefined(); expect(result.staleRejected).toBe(true); expect(result.paused).toBe(true);
  expect(result.newEpoch).toBe(true); expect(result.disposed).toBeUndefined(); expect(result.rateBounded).toBe(true);
});
