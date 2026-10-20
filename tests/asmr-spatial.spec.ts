import { expect, test } from '@playwright/test';

test('spatial ASMR validates every bound, preserves legacy stereo and round-trips JSON/share state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const spatialPath = '/src/asmr-spatial.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', sharePath = '/src/share.ts';
    const { defaultSpatial, parseAsmrSpatial, spatialPosition } = await import(spatialPath);
    const { makeAsmrLayer, parseAsmr } = await import(statePath), { initialSession, parseSession } = await import(modelPath);
    const { sessionLink, readSharedSession } = await import(sharePath);
    const base = defaultSpatial(), bad: unknown[] = [undefined, null, [], false, 1, 'spatial', {}];
    for (const [field, values] of Object.entries({ azimuth: [-181, 181, NaN, Infinity, '-90', null], elevation: [-61, 61],
      distance: [.149, 3.001, 0], motion: ['sweep', 'ORBIT', null, ['still']] })) {
      for (const value of values) bad.push({ ...base, [field]: value });
    }
    const rejected = bad.every(value => { try { parseAsmrSpatial(value); return false; } catch { return true; } });
    const missing = Object.keys(base).every(key => {
      const value = { ...base }; delete value[key];
      try { parseAsmrSpatial(value); return false; } catch { return true; }
    });
    const boundaries = [-180, 180].flatMap(azimuth => [-60, 60].flatMap(elevation => [.15, 3].flatMap(distance =>
      ['still', 'orbit'].map(motion => parseAsmrSpatial({ azimuth, elevation, distance, motion })))));
    const legacy = makeAsmrLayer('air'); legacy.pan = -1; legacy.motion = 'still';
    const spatial = { azimuth: -85, elevation: 35, distance: .3, motion: 'orbit' };
    const session = initialSession(); session.asmr = { level: .6, layers: [{ ...legacy, spatial }] };
    const json = parseSession(JSON.parse(JSON.stringify(session))), shared = readSharedSession(new URL(sessionLink(session)).hash);
    const invalidLayer = bad.every(spatial => {
      if (spatial === undefined) return true;
      try { parseAsmr({ level: .6, layers: [{ ...legacy, spatial }] }); return false; } catch { return true; }
    });
    return { rejected, missing, invalidLayer, boundaries: boundaries.length,
      legacy: parseAsmr({ level: .6, layers: [legacy] }).layers[0].spatial === undefined,
      json: json.asmr.layers[0].spatial, shared: shared.asmr.layers[0].spatial,
      positions: [0, 90, -90, 180].map(azimuth => spatialPosition({ ...base, azimuth, distance: 1 })),
      elevated: spatialPosition({ ...base, elevation: 60, distance: 2 }) };
  });
  expect(result.rejected).toBe(true); expect(result.missing).toBe(true); expect(result.invalidLayer).toBe(true);
  expect(result.boundaries).toBe(16); expect(result.legacy).toBe(true);
  expect(result.json).toEqual({ azimuth: -85, elevation: 35, distance: .3, motion: 'orbit' }); expect(result.shared).toEqual(result.json);
  for (const [index, expected] of [[0, [0, 0, -1]], [1, [1, 0, 0]], [2, [-1, 0, 0]], [3, [0, 0, 1]]] as const) {
    const value = result.positions[index]; [value.x, value.y, value.z].forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(expected[axis], 10));
  }
  expect(result.elevated.y).toBeCloseTo(Math.sqrt(3), 10); expect(result.elevated.z).toBeCloseTo(-1, 10);
});

test('actual HRTF graph resolves direction, elevation and distance with finite bounded stereo PCM', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const positionPath = '/src/audio/asmr-position.ts', spatialPath = '/src/asmr-spatial.ts';
    const { AsmrPosition } = await import(positionPath), { defaultSpatial } = await import(spatialPath);
    async function render(values = {}, oppositeStereo = false) {
      const context = new OfflineAudioContext(2, 44100 * 2, 44100), source = context.createBufferSource();
      const buffer = context.createBuffer(oppositeStereo ? 2 : 1, 44100 * 2, 44100); let seed = 8421;
      for (let i = 0; i < buffer.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const value = (seed / 2147483648) * .06;
        buffer.getChannelData(0)[i] = value; if (oppositeStereo) buffer.getChannelData(1)[i] = -value;
      }
      source.buffer = buffer;
      const position = new AsmrPosition(context, source, context.destination, { ...defaultSpatial(), distance: .6, ...values }, 2);
      source.start(); const output = await context.startRendering();
      const channels = [output.getChannelData(0).slice(), output.getChannelData(1).slice()]; position.dispose(); source.disconnect();
      return channels;
    }
    const power = (channels: Float32Array[], start = .4, end = 1.8) => channels.map(channel => {
      let sum = 0; for (let i = Math.round(start * 44100); i < end * 44100; i++) sum += channel[i] ** 2;
      return sum / Math.round((end - start) * 44100);
    });
    const difference = (a: Float32Array[], b: Float32Array[]) => {
      let sum = 0; for (let ear = 0; ear < 2; ear++) for (let i = 22050; i < 79380; i++) sum += Math.abs(a[ear][i] - b[ear][i]);
      return sum / (2 * (79380 - 22050));
    };
    const left = await render({ azimuth: -70 }), right = await render({ azimuth: 70 });
    const front = await render({ azimuth: 30 }), back = await render({ azimuth: 150 });
    const above = await render({ azimuth: 30, elevation: 45 }), below = await render({ azimuth: 30, elevation: -45 });
    const near = await render({ distance: .15 }), far = await render({ distance: 3 });
    const cancelled = await render({}, true), cancelledOrbit = await render({ motion: 'orbit' }, true), orbit = await render({ motion: 'orbit' });
    const fixed = await render({ motion: 'still' });
    let peak = 0, finite = true;
    for (const channels of [left, right, front, back, above, below, near, far, cancelled, cancelledOrbit, orbit, fixed]) {
      for (const channel of channels) for (const sample of channel) { finite &&= Number.isFinite(sample); peak = Math.max(peak, Math.abs(sample)); }
    }
    return { left: power(left), right: power(right), frontBack: difference(front, back), elevation: difference(above, below),
      distance: power(far).reduce((a, b) => a + b) / power(near).reduce((a, b) => a + b), cancelled: power(cancelled), cancelledOrbit: power(cancelledOrbit),
      orbitRight: power(orbit, .35, .65), orbitLeft: power(orbit, 1.35, 1.65), orbitDifference: difference(orbit, fixed), finite, peak };
  });
  expect(result.finite).toBe(true); expect(result.peak).toBeGreaterThan(.005); expect(result.peak).toBeLessThan(.3);
  expect(result.left[0]).toBeGreaterThan(result.left[1] * 1.2); expect(result.right[1]).toBeGreaterThan(result.right[0] * 1.2);
  expect(result.frontBack).toBeGreaterThan(.000001); expect(result.elevation).toBeGreaterThan(.000001);
  expect(result.distance).toBeGreaterThan(.02); expect(result.distance).toBeLessThan(.1);
  expect(Math.max(...result.cancelled, ...result.cancelledOrbit)).toBeLessThan(1e-12);
  expect(result.orbitRight[1]).toBeGreaterThan(result.orbitRight[0] * 1.2);
  expect(result.orbitLeft[0]).toBeGreaterThan(result.orbitLeft[1] * 1.2); expect(result.orbitDifference).toBeGreaterThan(.000001);
});

test('spatial edits stay bounded and disposal preserves unrelated source connections', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const positionPath = '/src/audio/asmr-position.ts', spatialPath = '/src/asmr-spatial.ts';
    const { AsmrPosition } = await import(positionPath), { defaultSpatial } = await import(spatialPath);
    async function render(stage: 'initial' | 'edited' | 'disposed' | 'scheduled') {
      const context = new OfflineAudioContext(2, 44100 * 2, 44100), source = context.createOscillator(), level = context.createGain();
      source.frequency.value = 700; level.gain.value = .04; source.connect(level);
      const destination = context.createChannelMerger(2), dry = context.createGain(); dry.gain.value = .25;
      level.connect(dry).connect(destination, 0, 1); destination.connect(context.destination);
      const spatial = context.createGain(); spatial.channelCount = 1; spatial.channelCountMode = 'explicit'; spatial.connect(destination, 0, 0);
      const position = new AsmrPosition(context, level, spatial, defaultSpatial(), 2);
      const edit = () => position.update({ azimuth: 180, elevation: 60, distance: .15, motion: 'orbit' }, 60);
      const dispose = () => { position.dispose(); position.dispose(); position.update(defaultSpatial(), 2); };
      const actions: Promise<void>[] = [];
      if (stage === 'scheduled') {
        actions.push(context.suspend(.5).then(async () => { edit(); await context.resume(); }));
        actions.push(context.suspend(1).then(async () => { dispose(); await context.resume(); }));
      } else {
        if (stage !== 'initial') edit();
        if (stage === 'disposed') dispose();
      }
      source.start();
      const buffer = await context.startRendering(); await Promise.all(actions);
      dispose(); source.disconnect();
      return [buffer.getChannelData(0), buffer.getChannelData(1)];
    }
    const peak = (channel: Float32Array, start: number, end: number) => {
      let value = 0; for (let i = Math.round(start * 44100); i < end * 44100; i++) value = Math.max(value, Math.abs(channel[i])); return value;
    };
    const scheduled = typeof OfflineAudioContext.prototype.suspend === 'function';
    const initial = await render(scheduled ? 'scheduled' : 'initial');
    // Firefox lacks offline suspension; exercise the same edits and ownership on fresh renders.
    const edited = scheduled ? initial : await render('edited'), disposed = scheduled ? initial : await render('disposed');
    const channels = [...initial, ...edited, ...disposed];
    return { finite: channels.every(channel => channel.every(Number.isFinite)), initial: peak(initial[0], .2, .4),
      edited: peak(edited[0], .7, .9), disposed: peak(disposed[0], 1.3, 1.9),
      unrelated: peak(disposed[1], 1.3, 1.9), peak: Math.max(...channels.map(channel => peak(channel, 0, 2))) };
  });
  expect(result.finite).toBe(true); expect(result.initial).toBeGreaterThan(.001); expect(result.edited).toBeGreaterThan(.001);
  expect(result.disposed).toBe(0); expect(result.unrelated).toBeGreaterThan(.005); expect(result.peak).toBeLessThan(.1);
});

test('spatial mixer keeps stereo legacy routing and uses HRTF in WAV with the scheduled end gate', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', exportPath = '/src/audio/export.ts';
    const { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath), { renderWav } = await import(exportPath);
    const session = initialSession(); session.mode = 'asmr'; session.minutes = .025; session.master = .7; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1, pan: -1, motion: 'still' }] };
    const measure = async () => {
      const blob = await renderWav(session, 2), view = new DataView(await blob.arrayBuffer());
      const energy = [0, 0], tail = [0, 0]; let peak = 0;
      for (let frame = 0; frame < 88200; frame++) for (let ear = 0; ear < 2; ear++) {
        const value = view.getInt16(44 + frame * 4 + ear * 2, true) / 32768;
        peak = Math.max(peak, Math.abs(value));
        if (frame > .3 * 44100 && frame < 1 * 44100) energy[ear] += value ** 2;
        if (frame > 1.7 * 44100) tail[ear] += value ** 2;
      }
      return { energy, tail, peak, bytes: blob.size, channels: view.getUint16(22, true) };
    };
    const legacy = await measure();
    session.asmr.layers[0].spatial = { azimuth: 70, elevation: 20, distance: .4, motion: 'still' };
    const spatial = await measure();
    return { legacy, spatial };
  });
  expect(result.legacy.energy[0]).toBeGreaterThan(.01); expect(result.legacy.energy[1]).toBe(0);
  expect(result.spatial.energy[1]).toBeGreaterThan(result.spatial.energy[0] * 1.2);
  expect(Math.min(...result.spatial.energy)).toBeGreaterThan(.0001); expect(result.spatial.peak).toBeLessThan(.7);
  expect(result.spatial.tail).toEqual([0, 0]); expect(result.spatial.channels).toBe(2); expect(result.spatial.bytes).toBe(44 + 88200 * 4);
});

test('@live spatial orbit shares live pause, end and voice replacement ownership', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession();
    session.mode = 'asmr'; session.minutes = .035; session.master = .7; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1,
      spatial: { azimuth: -90, elevation: 15, distance: .3, motion: 'orbit' }, period: 2 }] };
    await engine.start(session);
    const context: AudioContext = engine.context, analyzer = context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
    const read = () => { const data = new Float32Array(2048); analyzer.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
    await waitForAudioTime(context, .55); const before = read();
    const first = engine.asmr.voices.get(session.asmr.layers[0].id);
    await engine.pause(); const time = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 160)); const frozen = context.currentTime === time;
    session.asmr.layers[0].spatial.azimuth = 60; session.asmr.layers[0].spatial.elevation = -30; engine.update(session);
    const updatedSameVoice = first === engine.asmr.voices.get(session.asmr.layers[0].id);
    await engine.resume(); await waitForAudioTime(context, context.currentTime + .15);
    delete session.asmr.layers[0].spatial; engine.update(session);
    const stereoVoice = engine.asmr.voices.get(session.asmr.layers[0].id), replaced = stereoVoice !== first;
    session.asmr.layers[0].spatial = { azimuth: 60, elevation: 0, distance: .5, motion: 'still' }; engine.update(session);
    const spatialReplaced = engine.asmr.voices.get(session.asmr.layers[0].id) !== stereoVoice;
    await waitForAudioTime(context, 2.3); const ended = read();
    session.asmr.layers[0].spatial.motion = 'orbit'; engine.update(session);
    await waitForAudioTime(context, context.currentTime + .2); const expired = read(), voices = engine.asmr.voices.size;
    await engine.stop();
    return { before, frozen, updatedSameVoice, replaced, spatialReplaced, ended, expired, voices, stopped: !engine.playing };
  });
  expect(result.before).toBeGreaterThan(.0001); expect(result.frozen).toBe(true); expect(result.updatedSameVoice).toBe(true);
  expect(result.replaced).toBe(true); expect(result.spatialReplaced).toBe(true);
  expect(result.ended).toBe(0); expect(result.expired).toBe(0); expect(result.voices).toBe(0); expect(result.stopped).toBe(true);
});
