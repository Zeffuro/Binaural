import { expect, test } from '@playwright/test';
import type { AsmrMarkerPose, AsmrMarkerSample } from '../src/audio/asmr-markers';

test('all nine authored generators preserve every legacy sample and evict variant markers with their PCM', async ({ page }) => {
  test.setTimeout(90_000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/asmr-synthesis.ts';
    const { synthesizeAsmrSample, asmrGeneratedSample } = await import(path);
    const sounds = ['wood', 'glass', 'paper', 'water', 'chimes', 'fingertip-taps', 'keyboard', 'soft-clicks', 'comb'];
    let error = 0, bounded = true, total = 0;
    for (const sound of sounds) for (const variant of [0, 1, 2]) {
      const marked = synthesizeAsmrSample(sound, variant), plain = synthesizeAsmrSample(sound, variant, false);
      for (let frame = 0; frame < plain.samples.length; frame++) error = Math.max(error, Math.abs(marked.samples[frame] - plain.samples[frame]));
      bounded &&= marked.events.length > 0 && marked.events.length < 256 && marked.events.every((event: { start: number; length: number }, index: number) =>
        Number.isInteger(event.start) && Number.isInteger(event.length) && event.start >= 0 && event.start < marked.samples.length &&
        event.length > 0 && event.length <= marked.samples.length && (!index || event.start >= marked.events[index - 1].start));
      total++;
    }
    const first = asmrGeneratedSample('wood', 1), reused = first === asmrGeneratedSample('wood', 1);
    for (const sound of sounds.slice(1)) for (const variant of [1, 2]) asmrGeneratedSample(sound, variant);
    const regenerated = asmrGeneratedSample('wood', 1);
    let regeneratedError = 0;
    for (let frame = 0; frame < first.samples.length; frame++) regeneratedError = Math.max(regeneratedError, Math.abs(first.samples[frame] - regenerated.samples[frame]));
    return { total, error, bounded, reused, evicted: first !== regenerated && first.events !== regenerated.events,
      regeneratedError, eventsReproduced: JSON.stringify(first.events) === JSON.stringify(regenerated.events),
      unsupported: ['brush', 'air', 'scratch', 'cupping', 'fabric', 'rain-stick'].every(sound => asmrGeneratedSample(sound).events === undefined) };
  });
  expect(result.total).toBe(27); expect(result.error).toBe(0); expect(result.bounded).toBe(true);
  expect(result.reused).toBe(true); expect(result.evicted).toBe(true); expect(result.regeneratedError).toBe(0);
  expect(result.eventsReproduced).toBe(true); expect(result.unsupported).toBe(true);
});

test('authored event windows preserve source silence, pulse boundaries, modular tails and bounded historical queries', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/asmr-markers.ts';
    const { sourceMarker, AsmrMarkerHistory } = await import(path);
    const events = [{ start: 10, length: 8 }, { start: 95, length: 10 }];
    const history = new AsmrMarkerHistory();
    history.push({ time: 1, pose: { progress: 0, contact: .8 }, event: 'one' });
    history.push({ time: 1.05, pose: { progress: .5, contact: .4 }, event: 'one' });
    const middle = history.read(1.025), stale = history.read(1.2), earlier = history.read(.9);
    history.push({ time: 1.06, pose: null, event: 'quiet' }); const quiet = history.read(1.061);
    history.push({ time: 1.07, pose: undefined, event: 'transition' }); const unavailable = history.read(1.071);
    history.clear(); const cleared = history.read(1.05);
    for (let index = 0; index < 2000; index++) history.push({ time: index / 120, pose: null, event: 'quiet' });
    const samples = history.samples;
    const count = samples.length, span = samples.at(-1).time - samples[0].time;
    history.push({ time: 0, pose: null, event: 'reset' });
    return { onset: sourceMarker(events, 10, 100, 100), inside: sourceMarker(events, 14, 100, 100),
      wrapped: sourceMarker(events, 2, 100, 100), ended: sourceMarker(events, 18, 100, 100),
      seamEnd: sourceMarker(events, 5, 100, 100), middle, stale, earlier, quiet, unavailable, cleared,
      count, span, reversed: history.samples.length === 1, malformed: history.read(NaN) };
  });
  expect(result.onset.pose).toEqual({ progress: 0, contact: .85 }); expect(result.inside.pose.progress).toBe(.5);
  expect(result.wrapped.index).toBe(1); expect(result.wrapped.pose.progress).toBe(.7);
  expect(result.ended).toBeUndefined(); expect(result.seamEnd).toBeUndefined();
  expect(result.middle.progress).toBeCloseTo(.25, 12); expect(result.middle.contact).toBeCloseTo(.6, 12);
  expect(result.stale).toBeUndefined(); expect(result.earlier).toBeUndefined(); expect(result.quiet).toBeNull();
  expect(result.unavailable).toBeUndefined(); expect(result.cleared).toBeUndefined(); expect(result.malformed).toBeUndefined();
  expect(result.count).toBeLessThanOrEqual(512); expect(result.span).toBeGreaterThanOrEqual(2.99); expect(result.reversed).toBe(true);
});

test('marker observers follow actual PCM source positions through variants, fractional rates, seeks, turns and a-rate changes', async ({ page }) => {
  test.setTimeout(90_000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const phrasePath = '/src/audio/asmr-phrases.ts', markerPath = '/src/audio/asmr-markers.ts';
    const { AsmrPhraseRenderer, planAsmrPhrase } = await import(phrasePath), { sourceMarker } = await import(markerPath);
    const sourceRate = 1200, length = 2400, outputRate = 2400;
    const sentinel = new Float32Array(length); sentinel[length - 1] = 1;
    const channels = [Float32Array.from({ length }, (_, index) => .05 + index / (length - 1) * .5), sentinel];
    const variants = [1, 2].map(variant => [Float32Array.from(channels[0], value => value + variant * .1), sentinel]);
    const events = [0, 1, 2].map(variant => [{ start: 90 + variant * 180, length: 110 }, { start: 1000 + variant * 150, length: 400 }, { start: 2340, length: 140 }]);
    const pcm = { sampleRate: sourceRate, channels, variants, events };
    let pcmError = 0, poseError = 0, wrongQuiet = 0, checked = 0, changedRate = 0, variantsSeen = new Set<number>();
    for (const mode of ['natural', 'turns']) for (const first of [0, 33 * outputRate + 17, 10800 * outputRate + 13]) {
      const config = { variation: { mode, seed: 731, amount: .7, phraseSeconds: 3.7, turnSeconds: 5.3 }, ordinal: 0, eligible: [0, 1] };
      const count = outputRate * 9, rates = Float32Array.from({ length: count }, (_, index) => .7 + .7 * (index / count));
      const output = channels.map(() => new Float32Array(count)), plain = channels.map(() => new Float32Array(count)), samples: AsmrMarkerSample[] = [];
      new AsmrPhraseRenderer(pcm, config).render(output, outputRate, first, rates, (sample: AsmrMarkerSample) => samples.push(sample));
      new AsmrPhraseRenderer(pcm, config).render(plain, outputRate, first, rates);
      for (let ear = 0; ear < output.length; ear++) for (let index = 0; index < count; index++) pcmError = Math.max(pcmError, Math.abs(output[ear][index] - plain[ear][index]));
      for (const sample of samples) {
        const frame = Math.round(sample.time * outputRate) - first;
        if (output[1][frame] !== 0) continue;
        const cell = Math.floor(sample.time / config.variation.phraseSeconds), turn = Math.floor(sample.time / config.variation.turnSeconds);
        const phrase = planAsmrPhrase(config, cell, length / sourceRate, turn), elapsed = sample.time - phrase.start;
        if (!phrase.active || elapsed <= .02 || elapsed >= phrase.duration - .02) continue;
        const turnFade = mode === 'turns' ? Math.min(1, (sample.time - turn * 5.3) / .35, ((turn + 1) * 5.3 - sample.time) / .35) : 1;
        const fade = Math.min(turnFade, elapsed / phrase.fade, (phrase.duration - elapsed) / phrase.fade);
        const envelope = Math.sin(fade * Math.PI / 2) ** 2 * phrase.gain;
        if (envelope < .02) continue;
        const position = ((output[0][frame] / envelope - .05 - phrase.variant * .1) / .5) * (length - 1);
        if (position < 1 || position > length - 2) continue;
        const expected = sourceMarker(events[phrase.variant], position, length, sourceRate);
        variantsSeen.add(phrase.variant); changedRate += rates[frame] > 1 ? 1 : 0;
        if (!expected) { if (sample.pose !== null) wrongQuiet++; continue; }
        if (!sample.pose) { wrongQuiet++; continue; }
        poseError = Math.max(poseError, Math.abs(expected.pose.progress - sample.pose.progress), Math.abs(expected.pose.contact - sample.pose.contact)); checked++;
      }
    }
    return { pcmError, poseError, wrongQuiet, checked, changedRate, variantsSeen: variantsSeen.size };
  });
  expect(result.pcmError).toBe(0); expect(result.poseError).toBeLessThan(.00002); expect(result.wrongQuiet).toBe(0);
  expect(result.checked).toBeGreaterThan(50); expect(result.changedRate).toBeGreaterThan(50); expect(result.variantsSeen).toBe(3);
});

test('maximum-rate keyboard event crossings retain three seconds within the 512 snapshot limit', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const synthPath = '/src/audio/asmr-synthesis.ts', phrasePath = '/src/audio/asmr-phrases.ts', markerPath = '/src/audio/asmr-markers.ts';
    const { asmrGeneratedSample } = await import(synthPath), { AsmrPhraseRenderer } = await import(phrasePath), { AsmrMarkerHistory } = await import(markerPath);
    const samples = [0, 1, 2].map(variant => asmrGeneratedSample('keyboard', variant));
    const pcm = { sampleRate: 24000, channels: [samples[0].samples], variants: samples.slice(1).map(sample => [sample.samples]), events: samples.map(sample => sample.events) };
    const config = { variation: { mode: 'natural', seed: 731, amount: 1, phraseSeconds: 30, turnSeconds: 90 }, ordinal: 0, eligible: [0] };
    const history = new AsmrMarkerHistory(); let crossings = 0, lastEvent = '';
    new AsmrPhraseRenderer(pcm, config).render([new Float32Array(24000 * 9)], 24000, 24000 * 8, 2, (sample: AsmrMarkerSample) => {
      if (sample.event !== lastEvent) { crossings++; lastEvent = sample.event; } history.push(sample);
    });
    const retained = history.samples;
    return { count: retained.length, span: retained.at(-1).time - retained[0].time, crossings };
  });
  expect(result.count).toBeLessThanOrEqual(512); expect(result.span).toBeGreaterThanOrEqual(2.95); expect(result.crossings).toBeGreaterThan(100);
});

test('fractional-rate marker and PCM section starts reproduce the full timeline at three-hour offsets', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const synthPath = '/src/audio/asmr-synthesis.ts', phrasePath = '/src/audio/asmr-phrases.ts';
    const { asmrGeneratedSample } = await import(synthPath), { AsmrPhraseRenderer } = await import(phrasePath);
    let error = 0, mismatches = 0, sections = 0;
    const rate = 1200, first = 10800 * rate + 17;
    for (const sound of ['wood', 'keyboard', 'comb']) for (const mode of ['natural', 'turns']) for (const pace of [.7, 1.1]) {
      const samples = [0, 1, 2].map(variant => asmrGeneratedSample(sound, variant));
      const pcm = { channels: [samples[0].samples], sampleRate: 24000, variants: samples.slice(1).map(sample => [sample.samples]),
        events: samples.map(sample => sample.events) };
      const config = { variation: { mode, seed: 731, amount: .8, phraseSeconds: 3.7, turnSeconds: 5.3 }, ordinal: 0, eligible: [0, 1] };
      const full = [new Float32Array(rate * 12)], observed: AsmrMarkerSample[] = [];
      new AsmrPhraseRenderer(pcm, config).render(full, rate, first, pace, (sample: AsmrMarkerSample) => observed.push(sample));
      for (let index = 0; index < observed.length; index += 7) {
        const sample = observed[index], frame = Math.round(sample.time * rate), output = [new Float32Array(1)];
        const reference: { sample?: AsmrMarkerSample } = {};
        new AsmrPhraseRenderer(pcm, config).render(output, rate, frame, pace, (marker: AsmrMarkerSample) => reference.sample = marker);
        if (JSON.stringify(reference.sample) !== JSON.stringify(sample)) mismatches++;
        error = Math.max(error, Math.abs(output[0][0] - full[0][frame - first])); sections++;
      }
    }
    return { error, mismatches, sections };
  });
  expect(result.error).toBe(0); expect(result.mismatches).toBe(0); expect(result.sections).toBeGreaterThan(500);
});

test('@live actual phrase marker transport is lazy, timestamped, epoch-safe and unavailable through configuration crossfades', async ({ page }) => {
  test.setTimeout(45_000); await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const sourcePath = '/src/audio/asmr-phrase-source.ts', statePath = '/src/asmr-state.ts', synthPath = '/src/audio/asmr-synthesis.ts';
    const phrasePath = '/src/audio/asmr-phrases.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { prepareAsmrAudio, createAsmrPhraseSource, phraseConfig } = await import(sourcePath), { makeAsmrLayer } = await import(statePath);
    const { asmrGeneratedSample } = await import(synthPath), { AsmrPhraseRenderer } = await import(phrasePath), { waitForAudioTime } = await import(clockPath);
    const context = new AudioContext(); await context.suspend();
    const layer = { ...makeAsmrLayer('wood'), rate: .7 }, settings = { level: 1, layers: [layer],
      variation: { mode: 'natural', seed: 731, amount: .7, phraseSeconds: 4, turnSeconds: 90 } };
    await prepareAsmrAudio(context, settings);
    const OriginalNode = window.AudioWorkletNode; let node!: AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(OriginalNode, { construct(target, args) { node = Reflect.construct(target, args); return node; } });
    const offset = 30.75, origin = Math.round((context.currentTime - offset) * context.sampleRate), config = phraseConfig(settings, 0);
    const source = createAsmrPhraseSource(context, layer, config, offset); window.AudioWorkletNode = OriginalNode;
    const batches: { markerEpoch: number; markers: AsmrMarkerSample[]; frame: number }[] = [];
    node.port.addEventListener('message', event => { if (event.data.markers) batches.push(event.data); });
    source.connect(context.destination); source.start();
    try {
      await context.resume(); await waitForAudioTime(context, context.currentTime + .15);
      const lazy = batches.length === 0, first = source.readMarker(context.currentTime);
      await waitForAudioTime(context, context.currentTime + 2.5);
      const initial = batches.flatMap(batch => batch.markers), beforeConfig = batches.length;
      const generated = [0, 1, 2].map(variant => asmrGeneratedSample('wood', variant));
      const pcm = { channels: [generated[0].samples], variants: generated.slice(1).map(sample => [sample.samples]),
        sampleRate: 24000, events: generated.map(sample => sample.events) };
      let error = 0, mismatch = 0, active = 0;
      for (const sample of initial) {
        const reference: { pose?: AsmrMarkerPose | null } = {};
        new AsmrPhraseRenderer(pcm, config).render([new Float32Array(1)], context.sampleRate,
          Math.round(sample.time * context.sampleRate) - origin, layer.rate, (marker: AsmrMarkerSample) => reference.pose = marker.pose);
        const expected = reference.pose;
        if (sample.pose && expected) {
          error = Math.max(error, Math.abs(sample.pose.progress - expected.progress), Math.abs(sample.pose.contact - expected.contact)); active++;
        } else if (sample.pose !== expected) mismatch++;
      }
      source.configure({ ...config, variation: { ...config.variation, seed: 912 } });
      const reset = source.readMarker(context.currentTime - .02);
      await waitForAudioTime(context, context.currentTime + .2);
      const changed = batches.slice(beforeConfig).flatMap(batch => batch.markers);
      const transition = changed.some(sample => sample.pose === undefined), recovered = changed.some(sample => sample.pose !== undefined && sample.event !== 'transition');
      source.clearMarkers(); source.clearMarkers();
      const cleared = source.readMarker(context.currentTime - .02), epochBefore = batches.at(-1)!.markerEpoch;
      await waitForAudioTime(context, context.currentTime + .15);
      const newEpoch = batches.at(-1)!.markerEpoch > epochBefore;
      source.stop(); source.disconnect(); source.disconnect(); const disposed = source.readMarker(context.currentTime);
      const rateBounded = batches.every((batch, index) => !index || batch.markerEpoch !== batches[index - 1].markerEpoch ||
        batch.frame - batches[index - 1].frame >= Math.ceil(context.sampleRate / 30));
      const unsupportedSource = createAsmrPhraseSource(context, { ...layer, sound: 'air' }, config, 0);
      const unsupported = !unsupportedSource.readMarker; unsupportedSource.stop(); unsupportedSource.disconnect();
      return { lazy, first, initial: initial.length, active, error, mismatch, reset, transition, recovered, cleared, newEpoch, disposed, rateBounded,
        unsupported };
    } finally { window.AudioWorkletNode = OriginalNode; await context.close(); }
  });
  expect(result.lazy).toBe(true); expect(result.first).toBeUndefined(); expect(result.initial).toBeGreaterThan(15);
  expect(result.active).toBeGreaterThan(0); expect(result.error).toBeLessThan(.000001); expect(result.mismatch).toBe(0);
  expect(result.reset).toBeUndefined(); expect(result.transition).toBe(true); expect(result.recovered).toBe(true);
  expect(result.cleared).toBeUndefined(); expect(result.newEpoch).toBe(true); expect(result.disposed).toBeUndefined();
  expect(result.rateBounded).toBe(true); expect(result.unsupported).toBe(true);
});
