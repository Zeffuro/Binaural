import { expect, test } from '@playwright/test';

test('source contacts follow actual events without replacing measured strength, side or audibility', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/asmr-cues.ts', { AsmrCueDetector } = await import(path);
    const measured = new AsmrCueDetector('tap', 'wood'), authored = new AsmrCueDetector('tap', 'wood');
    let error = 0;
    const contacts = [];
    for (let index = 0; index < 20; index++) {
      const time = index / 60, pose = { progress: index / 20, contact: index % 3 ? .2 : .8 };
      const baseline = measured.read(time, .03, .09), cue = authored.read(time, .03, .09, pose);
      error = Math.max(error, Math.abs(cue.strength - baseline.strength), Math.abs(cue.pan - baseline.pan));
      contacts.push([cue.progress, cue.contact]);
    }
    const quiet = authored.read(.34, .03, .09, null);
    const unavailable = authored.read(.35, .03, .09);
    const inaudible = authored.read(.36, 0, 0, { progress: .5, contact: .8 });
    const bounded = authored.read(.37, .03, .09, { progress: 7, contact: 8 });
    const invalid = new AsmrCueDetector('invalid', 'glass'), fallback = new AsmrCueDetector('invalid', 'glass');
    const malformed = invalid.read(0, .1, .04, { progress: NaN, contact: Infinity });
    return { error, contacts, quiet, unavailable: !!unavailable, inaudible, bounded,
      malformedMatches: JSON.stringify(malformed) === JSON.stringify(fallback.read(0, .1, .04)) };
  });
  expect(result.error).toBe(0);
  expect(result.contacts).toEqual(Array.from({ length: 20 }, (_, index) => [index / 20, index % 3 ? .2 : .8]));
  expect(result.quiet.contact).toBe(0); expect(result.quiet.progress).toBe(.95);
  expect(result.quiet.strength).toBeGreaterThan(0); expect(result.unavailable).toBe(true); expect(result.inaudible).toBeUndefined();
  expect(result.bounded.progress).toBe(1); expect(result.bounded.contact).toBe(.85); expect(result.malformedMatches).toBe(true);
});

test('@live authored contacts use analyser midpoint time and measured ears, with mute, pause and replacement cleanup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
    const clockPath = '/tests/helpers/audio-clock.ts', cuePath = '/src/audio/asmr-cues.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
    const { makeAsmrLayer } = await import(statePath), { waitForAudioTime } = await import(clockPath), { earRms } = await import(cuePath);
    const engine = new AudioEngine(), session = initialSession();
    session.mode = 'asmr'; session.master = .7; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('wood'), level: .8, motion: 'still', pan: .65 }],
      variation: { mode: 'natural', seed: 731, amount: .35, phraseSeconds: 4, turnSeconds: 30 } };
    await engine.start(session);
    try {
      const context = engine.context, layer = session.asmr.layers[0], voice = engine.asmr.voices.get(layer.id), source = voice.source;
      let queried = 0, matched = 0, silence = 0, queryError = 0, poseError = 0, noSignal = 0, clears = 0;
      const observed: { marker: { progress: number; contact: number } | null | undefined } = { marker: undefined };
      const read = source.readMarker.bind(source), clear = source.clearMarkers.bind(source);
      source.readMarker = (time: number) => { queried = time; observed.marker = read(time); return observed.marker; };
      source.clearMarkers = () => { clears++; clear(); };
      engine.visualFrame();
      await waitForAudioTime(context, context.currentTime + .7);
      for (let index = 0; index < 200; index++) {
        await waitForAudioTime(context, context.currentTime + .02);
        if (index === 60) { layer.rate = 1.2; engine.update(session); }
        const frame = engine.visualFrame(), cue = frame.asmr.find((cue: { id: string }) => cue.id === layer.id);
        const marker = observed.marker;
        queryError = Math.max(queryError, Math.abs(queried - (frame.time - 512 / context.sampleRate)));
        if (marker === null) { silence++; if (cue?.contact) noSignal++; }
        if (cue && marker) {
          matched++; poseError = Math.max(poseError, Math.abs(cue.progress - marker.progress), Math.abs(cue.contact - Math.min(.85, marker.contact)));
          const samples = voice.cueTap.samples;
          if (!(earRms(samples[0]) > 0 || earRms(samples[1]) > 0)) noSignal++;
        }
      }
      const beforeMute = clears;
      layer.muted = true; engine.update(session); const muted = engine.visualFrame().asmr.length;
      const muteCleared = clears > beforeMute; layer.muted = false; engine.update(session);
      engine.visualFrame(); const beforePause = clears;
      await engine.pause(); const paused = engine.visualFrame('output').asmr.length, pauseCleared = clears > beforePause;
      await engine.resume(); const capture = engine.visualFrame('capture');
      session.master = 0; engine.update(session); const zero = engine.visualFrame().asmr.length;
      session.master = .7; layer.sound = 'glass'; engine.update(session);
      const replaced = engine.asmr.voices.get(layer.id) !== voice;
      const disposedMarker = source.readMarker(context.currentTime - 512 / context.sampleRate);
      return { matched, silence, queryError, poseError, noSignal, muted, muteCleared, paused, pauseCleared,
        captureFinite: Number.isFinite(capture.time), zero, replaced, disposedMarker };
    } finally { await engine.stop(); }
  });
  expect(result.matched, JSON.stringify(result)).toBeGreaterThan(3); expect(result.silence).toBeGreaterThan(0);
  expect(result.queryError).toBeLessThan(1e-9); expect(result.poseError).toBeLessThan(1e-9); expect(result.noSignal).toBe(0);
  expect(result.muted).toBe(0); expect(result.muteCleared).toBe(true); expect(result.paused).toBe(0); expect(result.pauseCleared).toBe(true);
  expect(result.captureFinite).toBe(true); expect(result.zero).toBe(0); expect(result.replaced).toBe(true); expect(result.disposedMarker).toBeUndefined();
});
