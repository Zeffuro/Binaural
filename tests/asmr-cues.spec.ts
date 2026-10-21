import { expect, test } from '@playwright/test';
import type { AsmrLayer } from '../src/asmr-state';
import type { AsmrCue } from '../src/audio/asmr-cues';

function stereoRecording(): Buffer {
  const rate = 24000, frames = rate * 4, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(1800 * Math.sin(frame * .08)), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(600 * Math.sin(frame * .13)), 46 + frame * 4);
  }
  return bytes;
}

test('ASMR cue families, quiet decay, audio-clock progress and onset limits stay bounded', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const cuePath = '/src/audio/asmr-cues.ts', statePath = '/src/asmr-state.ts';
    const { AsmrCueDetector, asmrCueKind, earRms } = await import(cuePath), { asmrSounds } = await import(statePath);
    const detector = new AsmrCueDetector('stroke', 'recorded-hair'), cues = [];
    for (let frame = 0; frame < 180; frame++) {
      const cue = detector.read(frame / 60, .04, .01); if (cue) cues.push(cue);
    }
    const frozen = detector.read(179 / 60, .04, .01);
    const before = cues.at(-1), gap = detector.read(4, 0, 0), reversed = detector.read(1, 0, 0);
    const tap = new AsmrCueDetector('contact', 'wood'), contacts = []; let previous = 0;
    for (let frame = 0; frame < 240; frame++) {
      const value = frame % 8 === 0 ? .1 : 0, cue = tap.read(frame / 60, value, value);
      if (cue && cue.contact > previous + .01) contacts.push(cue.time);
      previous = cue?.contact ?? 0;
    }
    const ended = tap.read(4.5, 0, 0);
    detector.read(5, .04, .01); detector.reset(); const resetQuiet = detector.read(5.01, 0, 0);
    const malformed = [NaN, Infinity, -Infinity].map(value => detector.read(value, .1, .1));
    return { families: asmrSounds.map((sound: { id: string }) => [sound.id, asmrCueKind(sound.id)]),
      bounded: cues.every(cue => cue.id === 'stroke' && cue.kind === 'brush' && cue.pan >= -1 && cue.pan <= 1 &&
        cue.strength > 0 && cue.strength <= 1 && cue.progress >= 0 && cue.progress <= 1 && cue.contact >= 0 && cue.contact <= .85),
      moved: cues.at(-1).progress - cues[0].progress, pan: before.pan,
      frozen: frozen.progress === before.progress && frozen.contact === before.contact, gap, reversed, ended, resetQuiet,
      malformed: malformed.every(value => value === undefined), contacts,
      rms: earRms(new Float32Array([.5, -.5, .5, -.5])), emptyRms: earRms(new Float32Array()) };
  });
  expect(result.families).toHaveLength(24);
  expect(new Set(result.families.map((pair: string[]) => pair[1]))).toEqual(new Set(['brush', 'tap', 'inspect', 'trace', 'follow', 'drop', 'ear']));
  expect(result.bounded).toBe(true); expect(result.moved).toBeGreaterThan(.5); expect(result.pan).toBeLessThan(-.8);
  expect(result.frozen).toBe(true); expect(result.gap).toBeUndefined(); expect(result.reversed).toBeUndefined();
  expect(result.ended).toBeUndefined(); expect(result.resetQuiet).toBeUndefined(); expect(result.malformed).toBe(true);
  expect(result.contacts.length).toBeGreaterThan(3); expect(result.contacts.length).toBeLessThanOrEqual(8);
  for (let index = 1; index < result.contacts.length; index++) expect(result.contacts[index] - result.contacts[index - 1]).toBeGreaterThanOrEqual(.5);
  expect(result.rms).toBe(.5); expect(result.emptyRms).toBe(0);
});

test('cue side taps preserve exact offline mono, native stereo, HRTF and phrase PCM', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', statePath = '/src/asmr-state.ts', assetsPath = '/src/audio/asmr-assets.ts';
    const { AsmrMixer } = await import(mixerPath), { makeAsmrLayer } = await import(statePath);
    const { prepareAsmrRecordings } = await import(assetsPath);
    const recording = { level: .8, layers: [{ ...makeAsmrLayer('recorded-hair'), motion: 'still', pan: 0 }] };
    await prepareAsmrRecordings(recording);
    const results = [];
    for (const settings of [
      { level: .8, layers: [{ ...makeAsmrLayer('air'), motion: 'still', pan: -.7 }] }, recording,
      { level: .8, layers: [{ ...makeAsmrLayer('air'), spatial: { azimuth: 70, elevation: 20, distance: .4, motion: 'still' } }] },
      { level: .8, layers: [{ ...makeAsmrLayer('brush'), motion: 'still', rate: .7 }],
        variation: { mode: 'natural', seed: 731, amount: .55, phraseSeconds: 4, turnSeconds: 90 } },
    ]) {
      const render = async (sense: boolean) => {
        const context = new OfflineAudioContext(2, 24000 * 3, 24000), mixer = new AsmrMixer(context, context.destination, 2.5);
        mixer.update(settings); if (sense) mixer.readCues();
        const taps = [...mixer.voices.values()].filter(voice => !!voice.cueTap).length;
        const output = await context.startRendering(), channels = [output.getChannelData(0).slice(), output.getChannelData(1).slice()];
        mixer.dispose(); mixer.dispose();
        return { channels, taps, cleared: mixer.voices.size === 0 && mixer.readCues().length === 0 };
      };
      const plain = await render(false), sensed = await render(true); let error = 0, energy = 0;
      for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < plain.channels[ear].length; frame++) {
        error = Math.max(error, Math.abs(plain.channels[ear][frame] - sensed.channels[ear][frame])); energy += plain.channels[ear][frame] ** 2;
      }
      results.push({ error, energy, lazy: plain.taps === 0, tapped: sensed.taps === 1, cleared: sensed.cleared && plain.cleared });
    }
    return results;
  });
  expect(result).toHaveLength(4);
  for (const value of result) {
    expect(value.error).toBe(0); expect(value.energy).toBeGreaterThan(.001);
    expect(value.lazy).toBe(true); expect(value.tapped).toBe(true); expect(value.cleared).toBe(true);
  }
});

test('@live cue sensing follows actual individual stereo and HRTF ears and preserves all audibility gates', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
    const cuePath = '/src/audio/asmr-cues.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const { AsmrCueDetector, earRms } = await import(cuePath), { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession(); session.mode = 'asmr'; session.master = .7; session.minutes = 0; session.ambient = 'none';
    session.asmr = { level: 1, layers: [
      { ...makeAsmrLayer('air'), motion: 'still', level: .8, pan: -1 },
      { ...makeAsmrLayer('air'), motion: 'still', level: .8, spatial: { azimuth: 75, elevation: 0, distance: .4, motion: 'still' } },
      { ...makeAsmrLayer('recorded-hair'), motion: 'still', level: .8, pan: 0 },
    ] };
    const [left, spatial, recording] = session.asmr.layers;
    await engine.start(session); const context: AudioContext = engine.context;
    await waitForAudioTime(context, .65); const firstFrame = engine.visualFrame();
    const reference = new AsmrCueDetector(recording.id, recording.sound); let referenceError = 0, nativeDifference = 0, nativeReadings = 0;
    const firstTap = engine.asmr.voices.get(recording.id).cueTap;
    reference.read(firstFrame.time, earRms(firstTap.samples[0]) * session.master, earRms(firstTap.samples[1]) * session.master);
    let frame;
    for (let index = 0; index < 14; index++) {
      await waitForAudioTime(context, context.currentTime + .045);
      frame = engine.visualFrame();
      const voice = engine.asmr.voices.get(recording.id), tap = voice.cueTap;
      const l = earRms(tap.samples[0]), r = earRms(tap.samples[1]); nativeDifference += Math.abs(l - r);
      const expected = reference.read(frame.time, l * session.master, r * session.master);
      const cue = frame.asmr.find((cue: AsmrCue) => cue.id === recording.id);
      if (cue && expected) { referenceError = Math.max(referenceError, Math.abs(cue.pan - expected.pan)); nativeReadings++; }
    }
    const direction = frame.asmr.map((cue: AsmrCue) => ({ id: cue.id, pan: cue.pan, time: cue.time, kind: cue.kind }));
    const directionTime = frame.time;
    const gate = () => engine.visualFrame().asmr.length;
    const gates = [];
    session.asmr.layers.forEach((layer: AsmrLayer) => layer.muted = true); engine.update(session); gates.push(gate() === 0);
    left.muted = false; recording.muted = false; spatial.muted = false; recording.solo = true; recording.level = 0;
    engine.update(session); gates.push(gate() === 0);
    recording.solo = false; left.level = recording.level = spatial.level = 0; engine.update(session); gates.push(gate() === 0);
    left.level = .8; session.asmr.level = 0; engine.update(session); gates.push(gate() === 0);
    session.asmr.level = 1; session.master = 0; engine.update(session); gates.push(gate() === 0);
    session.master = .7; session.mode = 'binaural'; engine.update(session); gates.push(gate() === 0);
    session.mode = 'asmr'; engine.update(session);
    await waitForAudioTime(context, context.currentTime + .15); engine.visualFrame();
    await waitForAudioTime(context, context.currentTime + .05); const resumed = gate() > 0;
    const oldVoice = engine.asmr.voices.get(left.id); left.sound = 'brush'; engine.update(session);
    const replaced = engine.asmr.voices.get(left.id) !== oldVoice && !oldVoice.cueTap;
    const replacementQuiet = !engine.visualFrame().asmr.some((cue: AsmrCue) => cue.id === left.id);
    await engine.pause(); const pausedTime = context.currentTime, paused = gate() === 0;
    await new Promise(resolve => setTimeout(resolve, 100)); const frozen = context.currentTime === pausedTime;
    await engine.resume(); await waitForAudioTime(context, context.currentTime + .1); engine.visualFrame();
    await waitForAudioTime(context, context.currentTime + .05); const afterResume = gate() > 0;
    const voices = [...engine.asmr.voices.values()]; await engine.stop();
    const disposed = voices.every(voice => !voice.cueTap) && engine.visualFrame() === undefined;
    session.timelineDuration = .55; await engine.start(session);
    await waitForAudioTime(engine.context, .7); const ended = gate() === 0;
    engine.update(session); const expiredVoices = engine.asmr.voices.size; await engine.stop();
    return { direction, time: directionTime, referenceError, nativeDifference, nativeReadings, gates, resumed, replaced,
      replacementQuiet, paused, frozen, afterResume, disposed, ended, expiredVoices };
  });
  expect(result.direction).toHaveLength(3); expect(result.direction[0].pan).toBeLessThan(-.9);
  expect(result.direction[1].pan).toBeGreaterThan(.05); expect(result.direction[2].kind).toBe('brush');
  expect(result.direction.every((cue: { time: number }) => cue.time === result.time)).toBe(true);
  expect(result.referenceError).toBeLessThan(.04); expect(result.nativeDifference).toBeGreaterThan(.00001); expect(result.nativeReadings).toBeGreaterThan(5);
  expect(result.gates).toEqual([true, true, true, true, true, true]); expect(result.resumed).toBe(true);
  expect(result.replaced).toBe(true); expect(result.replacementQuiet).toBe(true); expect(result.paused).toBe(true); expect(result.frozen).toBe(true);
  expect(result.afterResume).toBe(true); expect(result.disposed).toBe(true); expect(result.ended).toBe(true); expect(result.expiredVoices).toBe(0);
});

test('@live pending replacement clears old cues and late readiness cannot restore a disabled source', async ({ page }) => {
  test.setTimeout(45_000);
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), request = new Promise<void>(resolve => requested = resolve);
  await page.route('**/audio/asmr/page-turning.mp3', async route => { requested(); await gate; await route.continue(); });
  await page.goto('/'); await page.locator('h1').click();
  try {
    const pending = page.evaluate(async () => {
      const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
      const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
      const { waitForAudioTime } = await import(clockPath);
      const engine = new AudioEngine(), session = initialSession(); session.mode = 'asmr'; session.master = .7; session.minutes = 0; session.ambient = 'none';
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), motion: 'still', level: .8 }] };
      await engine.start(session); await waitForAudioTime(engine.context, .6); engine.visualFrame();
      await waitForAudioTime(engine.context, .7); const before = engine.visualFrame().asmr.length;
      session.asmr.layers[0].sound = 'recorded-pages'; engine.update(session);
      const pending = engine.loadingAsmr, hidden = engine.visualFrame().asmr.length;
      session.mode = 'binaural'; engine.update(session);
      (window as any).cuePending = { engine, session };
      return { before, pending, hidden, disabled: engine.visualFrame().asmr.length };
    });
    await request; const result = await pending; release();
    const after = await page.evaluate(async () => {
      const { engine, session } = (window as any).cuePending;
      await new Promise(resolve => setTimeout(resolve, 200));
      const disabled = engine.visualFrame().asmr.length, voices = engine.asmr.voices.size;
      session.mode = 'asmr'; engine.update(session);
      const deadline = performance.now() + 10000;
      while (engine.loadingAsmr) { if (performance.now() > deadline) throw new Error('Recording never became ready.'); await new Promise(resolve => setTimeout(resolve, 20)); }
      const restored = engine.asmr.voices.size; await engine.stop(); delete (window as any).cuePending;
      return { disabled, voices, restored };
    });
    expect(result.before).toBeGreaterThan(0); expect(result.pending).toBe(true); expect(result.hidden).toBe(0); expect(result.disabled).toBe(0);
    expect(after.disabled).toBe(0); expect(after.voices).toBe(0); expect(after.restored).toBe(1);
  } finally { release(); }
});
