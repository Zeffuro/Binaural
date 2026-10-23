import { expect, test } from '@playwright/test';

test('native spatial audio retains its original PCM and needs no custom profile requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/audio/hrtf/')) requests.push(request.url()); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const positionPath = '/src/audio/asmr-position.ts', loaderPath = '/src/audio/hrtf-audio.ts';
    const { AsmrPosition } = await import(positionPath), { prepareHrtfAudio, hrtfAudioReady } = await import(loaderPath);
    async function render(original: boolean) {
      const context = new OfflineAudioContext(2, 12000, 48000), source = context.createBufferSource();
      const buffer = context.createBuffer(1, 12000, 48000); let seed = 741;
      for (let i = 0; i < buffer.length; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; buffer.getChannelData(0)[i] = seed / 2147483648 * .03; }
      source.buffer = buffer;
      await prepareHrtfAudio(context, { level: .6, layers: [] });
      let dispose = () => {};
      if (original) {
        const mono = context.createGain(), panner = context.createPanner();
        mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = .15;
        panner.maxDistance = 3; panner.rolloffFactor = .2;
        panner.coneInnerAngle = panner.coneOuterAngle = 360; panner.coneOuterGain = 1;
        panner.positionX.value = .6; panner.positionY.value = 0; panner.positionZ.value = 0;
        source.connect(mono).connect(panner).connect(context.destination);
      } else {
        const node = new AsmrPosition(context, source, context.destination, { azimuth: 90, elevation: 0, distance: .6, motion: 'still' }, 12);
        dispose = () => node.dispose();
      }
      source.start(); const output = await context.startRendering(); dispose();
      return { ready: hrtfAudioReady(context), channels: [output.getChannelData(0), output.getChannelData(1)] };
    }
    const before = await render(true), after = await render(false); let error = 0, power = 0;
    for (let ear = 0; ear < 2; ear++) for (let i = 1024; i < 12000; i++) {
      error = Math.max(error, Math.abs(before.channels[ear][i] - after.channels[ear][i])); power += after.channels[ear][i] ** 2;
    }
    return { error, power, ready: before.ready && after.ready };
  });
  expect(result.ready).toBe(true); expect(result.error).toBeLessThan(1e-8); expect(result.power).toBeGreaterThan(.01);
  expect(requests).toEqual([]);
});

test('selected measured profiles reproduce paired impulse PCM and ear timing at native and converted sample rates', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', positionPath = '/src/audio/asmr-position.ts';
    const { prepareHrtfAudio, preparedHrtfPack } = await import(loaderPath), { AsmrPosition } = await import(positionPath);
    const results = [];
    for (const profile of ['sadie-d1', 'sadie-h10']) for (const rate of [44100, 48000, 96000, 32000]) {
      const context = new OfflineAudioContext(2, Math.round(rate * .08), rate);
      const spatial = { azimuth: 90, elevation: 0, distance: .15, motion: 'still', profile };
      await prepareHrtfAudio(context, { level: .6, layers: [{ spatial }] });
      const pack = preparedHrtfPack(context, profile); let direction = 0;
      for (let i = 1; i < pack.directions.length / 3; i++) if (pack.directions[i * 3] > pack.directions[direction * 3]) direction = i;
      const x = pack.directions[direction * 3], y = pack.directions[direction * 3 + 1], z = pack.directions[direction * 3 + 2];
      spatial.azimuth = Math.atan2(x, -z) * 180 / Math.PI; spatial.elevation = Math.asin(y) * 180 / Math.PI;
      const source = context.createBufferSource(), buffer = context.createBuffer(1, context.length, rate);
      buffer.getChannelData(0)[256] = 1; source.buffer = buffer;
      const position = new AsmrPosition(context, source, context.destination, spatial, 12);
      source.start(); const output = await context.startRendering(); position.dispose();
      let error = 0, finite = true; const peaks = [], energy = [], times = [];
      for (let ear = 0; ear < 2; ear++) {
        const values = output.getChannelData(ear); let power = 0, peak = 0, time = 0;
        for (let frame = 0; frame < values.length; frame++) {
          const expected = frame >= 256 && frame < 256 + pack.taps ? pack.impulses[(direction * 2 + ear) * pack.taps + frame - 256] : 0;
          error = Math.max(error, Math.abs(values[frame] - expected)); finite &&= Number.isFinite(values[frame]);
          power += values[frame] ** 2;
          if (Math.abs(values[frame]) > peak) { peak = Math.abs(values[frame]); time = frame - 256; }
        }
        peaks.push(peak); energy.push(power); times.push(time / rate);
      }
      results.push({ profile, rate, error, finite, peaks, energy, times, taps: pack.taps });
    }
    return results;
  });
  expect(result).toHaveLength(8);
  for (const row of result) {
    expect(row.finite).toBe(true); expect(row.error).toBeLessThan(2e-6);
    expect(row.peaks[1]).toBeGreaterThan(.005); expect(Math.max(...row.peaks)).toBeLessThan(16);
    expect(row.energy[1]).toBeGreaterThan(row.energy[0] * 1.2);
    expect(row.times[0] - row.times[1]).toBeGreaterThan(.0001);
    expect(row.taps).toBeGreaterThanOrEqual(row.rate === 32000 ? 128 : 256);
  }
  await test.info().attach('paired-profile-impulses.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('profile preparation deduplicates fetches and module registration and retries integrity and module failures', async ({ page }) => {
  await page.goto('/');
  let corrupt = true, binaryRequests = 0, manifests = 0;
  await page.route('**/audio/hrtf/sadie-d1-48000.bin', async route => {
    binaryRequests++;
    const response = await route.fetch(), body = await response.body();
    if (corrupt) { corrupt = false; body[body.length - 1] ^= 1; }
    await route.fulfill({ response, body });
  });
  page.on('request', request => { if (request.url().endsWith('/audio/hrtf/sadie-d1-48000.json')) manifests++; });
  const result = await page.evaluate(async () => {
    const path = '/src/audio/hrtf-audio.ts', { prepareHrtfAudio, hrtfAudioReady } = await import(path);
    const context = new OfflineAudioContext(2, 1024, 48000), settings = { level: .6, layers: [{ spatial: { profile: 'sadie-d1' } }] };
    const real = context.audioWorklet.addModule.bind(context.audioWorklet); let modules = 0;
    context.audioWorklet.addModule = async (...args: Parameters<typeof real>) => { modules++; if (modules === 1) throw new Error('Injected module failure'); await real(...args); };
    const before = hrtfAudioReady(context, settings);
    let integrity = '', moduleFailure = '';
    try { await Promise.all([prepareHrtfAudio(context, settings), prepareHrtfAudio(context, settings)]); } catch (error) { integrity = String(error); }
    const failedReady = hrtfAudioReady(context, settings);
    try { await prepareHrtfAudio(context, settings); } catch (error) { moduleFailure = String(error); }
    await Promise.all(Array.from({ length: 6 }, () => prepareHrtfAudio(context, settings)));
    const another = new OfflineAudioContext(2, 1024, 48000);
    await prepareHrtfAudio(another, settings);
    return { before, failedReady, integrity, moduleFailure, modules, ready: hrtfAudioReady(context, settings) && hrtfAudioReady(another, settings) };
  });
  expect(result.before).toBe(false); expect(result.failedReady).toBe(false);
  expect(result.integrity).toContain('integrity'); expect(result.moduleFailure).toContain('Injected module failure');
  expect(result.modules).toBe(2); expect(result.ready).toBe(true); expect(binaryRequests).toBe(2); expect(manifests).toBe(2);
});

test('HTTP profile failures stay unprepared and a retry loads the original requested profile', async ({ page }) => {
  await page.goto('/');
  let attempts = 0;
  await page.route('**/audio/hrtf/sadie-h10-44100.bin', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
    else await route.continue();
  });
  const result = await page.evaluate(async () => {
    const path = '/src/audio/hrtf-audio.ts', { prepareHrtfAudio, hrtfAudioReady, preparedHrtfPack } = await import(path);
    const context = new OfflineAudioContext(2, 1024, 44100), settings = { layers: [{ spatial: { profile: 'sadie-h10' } }] };
    let failed = false, adopted = false;
    try { await prepareHrtfAudio(context, settings); } catch { failed = true; }
    try { preparedHrtfPack(context, 'sadie-h10'); adopted = true; } catch { /* Failed requests cannot create a renderer. */ }
    const readyAfterFailure = hrtfAudioReady(context, settings);
    await prepareHrtfAudio(context, settings);
    return { failed, adopted, readyAfterFailure, ready: hrtfAudioReady(context, settings), profile: preparedHrtfPack(context, 'sadie-h10').profile };
  });
  expect(attempts).toBe(2); expect(result.failed).toBe(true); expect(result.adopted).toBe(false);
  expect(result.readyAfterFailure).toBe(false); expect(result.ready).toBe(true); expect(result.profile).toBe('sadie-h10');
});

test('sample-rate conversion preserves the measured paired complex response in the shared passband', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', packPath = '/src/audio/hrtf-pack.ts';
    const { prepareHrtfAudio, preparedHrtfPack } = await import(loaderPath), { resampleHrtfPack } = await import(packPath);
    const context = new OfflineAudioContext(2, 1024, 48000), results = [];
    for (const profile of ['sadie-d1', 'sadie-h10']) {
      await prepareHrtfAudio(context, { layers: [{ spatial: { profile } }] });
      const original = preparedHrtfPack(context, profile);
      for (const rate of [32000, 96000]) {
        const converted = resampleHrtfPack(original, rate); let error = 0;
        for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
          let direction = 0;
          for (let i = 1; i < original.directions.length / 3; i++) if (sign * original.directions[i * 3 + axis] > sign * original.directions[direction * 3 + axis]) direction = i;
          for (let ear = 0; ear < 2; ear++) for (const frequency of [0, 200, 1000, 4000, 7000]) {
            const response = (pack: any) => {
              let real = 0, imaginary = 0;
              for (let tap = 0; tap < pack.taps; tap++) {
                const sample = pack.impulses[(direction * 2 + ear) * pack.taps + tap], phase = 2 * Math.PI * frequency * tap / pack.sampleRate;
                real += sample * Math.cos(phase); imaginary -= sample * Math.sin(phase);
              }
              return { real, imaginary };
            };
            const a = response(original), b = response(converted);
            error = Math.max(error, Math.hypot(a.real - b.real, a.imaginary - b.imaginary) / Math.max(.01, Math.hypot(a.real, a.imaginary)));
          }
        }
        results.push({ profile, rate, error });
      }
    }
    return results;
  });
  for (const row of result) expect(row.error, JSON.stringify(row)).toBeLessThan(.01);
  await test.info().attach('paired-resampling-complex-response.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('profile pack validation rejects malformed dimensions, topology, coordinates and non-finite PCM', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/hrtf-pack.ts', { decodeHrtfPack, resampleHrtfPack } = await import(path);
    const response = await fetch('/audio/hrtf/sadie-d1-48000.json'), metadata = await response.json();
    const buffer = await (await fetch('/audio/hrtf/sadie-d1-48000.bin')).arrayBuffer();
    const valid = decodeHrtfPack('sadie-d1', 48000, metadata, buffer);
    const cases: [any, ArrayBuffer][] = [
      [{ ...metadata, taps: 255 }, buffer], [{ ...metadata, directions: 2 ** 30 }, buffer],
      [{ ...metadata, sha256: 'x' }, buffer], [{ ...metadata, profile: 'sadie-h10' }, buffer],
      [{ ...metadata, triangleIndices: metadata.triangleIndices.slice(3) }, buffer],
      [{ ...metadata, triangleIndices: metadata.triangleIndices.map(() => 0) }, buffer],
      [metadata, buffer.slice(0, buffer.byteLength - 4)],
    ];
    for (const [offset, value] of [[24, NaN], [24, 2], [36, Infinity], [36, 20]] as const) {
      const changed = buffer.slice(0); new DataView(changed).setFloat32(offset, value, true); cases.push([metadata, changed]);
    }
    let rejected = 0;
    for (const [manifest, bytes] of cases) try { decodeHrtfPack('sadie-d1', 48000, manifest, bytes); } catch { rejected++; }
    let unsupported = 0;
    for (const rate of [8000, 192000, NaN]) try { resampleHrtfPack(valid, rate); } catch { unsupported++; }
    return { rejected, count: cases.length, unsupported, taps: valid.taps, vertices: valid.directions.length / 3 };
  });
  expect(result.rejected).toBe(result.count); expect(result.unsupported).toBe(3);
  expect(result.taps).toBe(256); expect(result.vertices).toBeGreaterThan(300);
});

test('spherical interpolation stays continuous at azimuth wrap and both poles and retains inverse distance', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', rendererPath = '/src/audio/hrtf-renderer.ts';
    const { prepareHrtfAudio, preparedHrtfPack } = await import(loaderPath), { HrtfRenderer } = await import(rendererPath);
    const context = new OfflineAudioContext(2, 1024, 48000);
    const results = [];
    for (const profile of ['sadie-d1', 'sadie-h10']) {
      await prepareHrtfAudio(context, { layers: [{ spatial: { profile } }] });
      const pack = preparedHrtfPack(context, profile), source = new Float32Array(512); source[0] = 1;
      const render = (azimuth: number, elevation: number, radius = .15) => {
        const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180, renderer = new HrtfRenderer(pack);
        const channels = [new Float32Array(512), new Float32Array(512)];
        renderer.render(source, channels[0], channels[1], {
          positionX: new Float32Array([radius * Math.sin(az) * Math.cos(el)]),
          positionY: new Float32Array([radius * Math.sin(el)]),
          positionZ: new Float32Array([-radius * Math.cos(az) * Math.cos(el)]),
        });
        return channels;
      };
      const error = (a: Float32Array[], b: Float32Array[]) => {
        let max = 0; for (let ear = 0; ear < 2; ear++) for (let i = 0; i < a[ear].length; i++) max = Math.max(max, Math.abs(a[ear][i] - b[ear][i])); return max;
      };
      let poleError = 0, wrapError = 0, finite = true, peak = 0, edgeJump = 0;
      for (const elevation of [-90, -60, 0, 60, 90]) {
        let previous = render(-180, elevation);
        for (let azimuth = -170; azimuth <= 180; azimuth += 10) {
          const current = render(azimuth, elevation);
          for (const ear of current) for (const value of ear) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); }
          if (Math.abs(elevation) === 90) poleError = Math.max(poleError, error(current, previous));
          previous = current;
        }
        wrapError = Math.max(wrapError, error(render(-180, elevation), render(180, elevation)));
        edgeJump = Math.max(edgeJump, error(render(-179.999, elevation), render(179.999, elevation)));
      }
      const near = render(35, 20), far = render(35, 20, 3); let distanceError = 0;
      const gain = .15 / (.15 + .2 * (3 - .15));
      for (let ear = 0; ear < 2; ear++) for (let i = 0; i < 512; i++) distanceError = Math.max(distanceError, Math.abs(far[ear][i] - near[ear][i] * gain));
      results.push({ profile, finite, peak, poleError, wrapError, edgeJump, distanceError });
    }
    return results;
  });
  for (const row of result) {
    expect(row.finite).toBe(true); expect(row.peak).toBeGreaterThan(.01); expect(row.peak).toBeLessThan(16);
    expect(row.poleError).toBeLessThan(1e-6); expect(row.wrapError).toBeLessThan(1e-6);
    expect(row.edgeJump).toBeLessThan(.001); expect(row.distanceError).toBeLessThan(2e-6);
  }
});

test('all custom trajectories preserve oscillator phase and FIR history across offset render contexts', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', positionPath = '/src/audio/asmr-position.ts', spatialPath = '/src/asmr-spatial.ts';
    const { prepareHrtfAudio } = await import(loaderPath), { AsmrPosition } = await import(positionPath);
    const { sampleSpatialPosition } = await import(spatialPath);
    const results = [], rate = 48000, offset = 1.28, count = rate * 3;
    const samples = new Float32Array(count); let seed = 617;
    for (let i = 0; i < count; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; samples[i] = seed / 2147483648 * .02; }
    for (const motion of ['still', 'orbit', 'sweep', 'approach', 'rise', 'figure-eight']) {
      const spatial = { profile: 'sadie-d1', azimuth: 170, elevation: 50, distance: .7, motion };
      const render = async (start: number, custom = true) => {
        const length = start < 3 ? count - Math.round(start * rate) : Math.round(rate * .1), context = new OfflineAudioContext(5, length, rate);
        const renderSpatial = custom ? spatial : { ...spatial, profile: undefined };
        await prepareHrtfAudio(context, { layers: [{ spatial: renderSpatial }] });
        const source = context.createBufferSource(), buffer = context.createBuffer(1, count, rate);
        buffer.getChannelData(0).set(samples); source.buffer = buffer;
        const sink = context.createGain(), merger = context.createChannelMerger(5), splitter = context.createChannelSplitter(2);
        const position = new AsmrPosition(context, source, sink, renderSpatial, 2, undefined, start);
        sink.connect(splitter); splitter.connect(merger, 0, 0); splitter.connect(merger, 1, 1);
        const parameters = custom ? ['positionX', 'positionY', 'positionZ'].map(name => position.custom.parameters.get(name)) :
          [position.panner.positionX, position.panner.positionY, position.panner.positionZ];
        const centers = parameters.map((parameter: AudioParam, axis: number) => {
          const constant = context.createConstantSource(); constant.offset.value = parameter.value;
          constant.connect(merger, 0, axis + 2); constant.start(); return constant;
        });
        (custom ? position.customMatrix : position.matrix).forEach((coefficient: GainNode, index: number) => coefficient.connect(merger, 0, Math.floor(index / 3) + 2));
        merger.connect(context.destination);
        const types = custom ? Array(3).fill(position.customMotion ? 'worklet' : 'missing') : [position.sine.type, position.cosine.type, position.harmonic.type];
        source.start(0, start < 3 ? start : 0); const output = await context.startRendering(); position.dispose();
        centers.forEach(constant => { constant.stop(); constant.disconnect(); }); merger.disconnect();
        return { audio: [output.getChannelData(0), output.getChannelData(1)],
          coordinates: [output.getChannelData(2), output.getChannelData(3), output.getChannelData(4)], types };
      };
      const full = await render(0), section = await render(offset); let max = 0, finite = true, power = 0, squaredError = 0;
      let maxFrame = 0, maxEar = 0, actual = 0, expected = 0;
      const coordinateError = [0, 0, 0], fullAnalyticError = [0, 0, 0], sectionAnalyticError = [0, 0, 0];
      for (let ear = 0; ear < 2; ear++) for (let i = 1024; i < section.audio[ear].length; i++) {
        const reference = full.audio[ear][i + Math.round(offset * rate)], value = section.audio[ear][i], error = Math.abs(value - reference);
        if (error > max) { max = error; maxFrame = i; maxEar = ear; actual = value; expected = reference; }
        finite &&= Number.isFinite(value); power += value ** 2; squaredError += error ** 2;
      }
      for (let frame = 1024; frame < section.audio[0].length; frame++) {
        for (let axis = 0; axis < 3; axis++) coordinateError[axis] = Math.max(coordinateError[axis],
          Math.abs(section.coordinates[axis][frame] - full.coordinates[axis][frame + Math.round(offset * rate)]));
        if (frame % 32 === 0) {
          const reference = sampleSpatialPosition(spatial, offset + frame / rate, 2);
          (['x', 'y', 'z'] as const).forEach((axis, index) => {
            fullAnalyticError[index] = Math.max(fullAnalyticError[index], Math.abs(full.coordinates[index][frame + Math.round(offset * rate)] - reference[axis]));
            sectionAnalyticError[index] = Math.max(sectionAnalyticError[index], Math.abs(section.coordinates[index][frame] - reference[axis]));
          });
        }
      }
      const longOffset = 10800, longSection = await render(longOffset), longAnalyticError = [0, 0, 0];
      for (let frame = 0; frame < longSection.coordinates[0].length; frame += 32) {
        const reference = sampleSpatialPosition(spatial, longOffset + frame / rate, 2);
        (['x', 'y', 'z'] as const).forEach((axis, index) => {
          longAnalyticError[index] = Math.max(longAnalyticError[index], Math.abs(longSection.coordinates[index][frame] - reference[axis]));
        });
      }
      let nativeControlBaseline;
      if (motion === 'orbit') {
        const originalFull = await render(0, false), originalSection = await render(offset, false), error = [0, 0, 0];
        for (let frame = 1024; frame < originalSection.coordinates[0].length; frame++) for (let axis = 0; axis < 3; axis++) {
          error[axis] = Math.max(error[axis], Math.abs(originalSection.coordinates[axis][frame] - originalFull.coordinates[axis][frame + Math.round(offset * rate)]));
        }
        nativeControlBaseline = { coordinateError: error, fullTypes: originalFull.types, sectionTypes: originalSection.types };
      }
      results.push({ motion, max, finite, power, relativeRms: Math.sqrt(squaredError / power), maxFrame, maxEar, actual, expected,
        absoluteMaxFrame: maxFrame + Math.round(offset * rate), coordinateError, fullAnalyticError, sectionAnalyticError,
        fullTypes: full.types, sectionTypes: section.types, longAnalyticError, nativeControlBaseline });
    }
    return results;
  });
  await test.info().attach('trajectory-offset-pcm.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  for (const row of result) {
    const diagnostic = JSON.stringify(row);
    expect(row.finite, diagnostic).toBe(true); expect(row.power, diagnostic).toBeGreaterThan(.01); expect(row.max, diagnostic).toBeLessThan(.00002);
    expect(row.fullTypes).toEqual(['worklet', 'worklet', 'worklet']); expect(row.sectionTypes).toEqual(row.fullTypes);
    expect(Math.max(...row.coordinateError), diagnostic).toBeLessThan(.000002);
    expect(Math.max(...row.fullAnalyticError, ...row.sectionAnalyticError, ...row.longAnalyticError), diagnostic).toBeLessThan(.000002);
  }
});

test('profile changes crossfade paired filters while retaining the same input history', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', rendererPath = '/src/audio/hrtf-renderer.ts';
    const { prepareHrtfAudio, preparedHrtfPack } = await import(loaderPath), { HrtfRenderer } = await import(rendererPath);
    const context = new OfflineAudioContext(2, 1024, 48000);
    await prepareHrtfAudio(context, { layers: ['sadie-d1', 'sadie-h10'].map(profile => ({ spatial: { profile } })) });
    const a = preparedHrtfPack(context, 'sadie-d1'), b = preparedHrtfPack(context, 'sadie-h10');
    const params = { positionX: new Float32Array([0]), positionY: new Float32Array([0]), positionZ: new Float32Array([-.15]) };
    const impulse = new Float32Array(4096); impulse[0] = 1; impulse[3500] = 1;
    const response = (pack: any) => {
      const renderer = new HrtfRenderer(pack), channels = [new Float32Array(4096), new Float32Array(4096)];
      renderer.render(impulse, channels[0], channels[1], params); return channels;
    };
    const aa = response(a), bb = response(b), renderer = new HrtfRenderer(a);
    const output = [new Float32Array(4096), new Float32Array(4096)];
    renderer.render(impulse.subarray(0, 16), output[0].subarray(0, 16), output[1].subarray(0, 16), params);
    renderer.changeProfile(b);
    renderer.render(impulse.subarray(16), output[0].subarray(16), output[1].subarray(16), params);
    let error = 0, retained = 0, finalError = 0, profileDifference = 0;
    for (let ear = 0; ear < 2; ear++) for (let i = 16; i < 4096; i++) {
      const blend = Math.min(1, (i - 16) / Math.round(48000 * .06));
      const expected = aa[ear][i] * (1 - blend) + bb[ear][i] * blend;
      error = Math.max(error, Math.abs(output[ear][i] - expected));
      if (i < 256) retained += output[ear][i] ** 2;
      if (i >= 3500) finalError = Math.max(finalError, Math.abs(output[ear][i] - bb[ear][i]));
      profileDifference = Math.max(profileDifference, Math.abs(aa[ear][i] - bb[ear][i]));
    }
    return { error, retained, finalError, profileDifference };
  });
  expect(result.profileDifference).toBeGreaterThan(.001); expect(result.retained).toBeGreaterThan(.001);
  expect(result.error).toBeLessThan(2e-6); expect(result.finalError).toBeLessThan(2e-6);
});

test('@live custom profile edits reuse bounded nodes and a processor failure silences and disposes the graph', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', positionPath = '/src/audio/asmr-position.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { prepareHrtfAudio, preparedHrtfPack } = await import(loaderPath), { AsmrPosition } = await import(positionPath);
    const { waitForAudioTime } = await import(clockPath);
    const context = new AudioContext(), original = window.AudioWorkletNode;
    const worklets: AudioWorkletNode[] = [], workletNames: string[] = [], errors: string[] = [];
    const errorEvents: { name: string; type: string; targetMatches: boolean; time: number; message: string }[] = [];
    let panners = 0, failures = 0, onFault: ((node: AudioWorkletNode) => void) | undefined;
    const realPanner = context.createPanner.bind(context);
    context.createPanner = () => { panners++; return realPanner(); };
    window.AudioWorkletNode = class extends original {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args); worklets.push(this); workletNames.push(args[1]);
      }
    };
    let position: any, source: OscillatorNode | undefined;
    try {
      await prepareHrtfAudio(context, { layers: ['sadie-d1', 'sadie-h10'].map(profile => ({ spatial: { profile } })) });
      await context.resume();
      source = context.createOscillator(); source.frequency.value = 400;
      const level = context.createGain(); level.gain.value = .03; source.connect(level);
      const base = { azimuth: 70, elevation: 25, distance: .6, motion: 'orbit' };
      position = new AsmrPosition(context, level, context.destination, base, 2, undefined, 0, () => { failures++; });
      const output = position.outputNode, splitter = context.createChannelSplitter(2), analysers = [context.createAnalyser(), context.createAnalyser()];
      output.connect(splitter); analysers.forEach((analyser, ear) => { analyser.fftSize = 1024; splitter.connect(analyser, ear); });
      source.start(); const sourceStartedAt = context.currentTime;
      position.update({ ...base, profile: 'sadie-d1' }, 2);
      worklets.forEach((processor, index) => {
        const productionHandler = processor.onprocessorerror;
        if (!productionHandler) throw new Error('Missing production HRTF processor failure handler.');
        processor.onprocessorerror = function (event) {
          errors.push(workletNames[index]!); errorEvents.push({ name: workletNames[index]!, type: event.type,
            targetMatches: event.target === processor, time: context.currentTime, message: (event as ErrorEvent).message ?? '' });
          onFault?.(processor);
          return productionHandler.call(this, event);
        };
      });
      for (let i = 0; i < 30; i++) {
        position.update({ ...base, ...(i % 3 === 0 ? {} : { profile: i % 3 === 1 ? 'sadie-d1' : 'sadie-h10' }) }, 2);
      }
      const deadline = performance.now() + 2000;
      while ((position.profilePending || position.queuedPack) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      const protocolIdle = !position.profilePending && !position.queuedPack;
      await waitForAudioTime(context, context.currentTime + .15);
      const values = [new Float32Array(1024), new Float32Array(1024)]; analysers.forEach((analyser, ear) => analyser.getFloatTimeDomainData(values[ear]!));
      const earEnergy = values.map(channel => channel.reduce((sum, value) => sum + value ** 2, 0));
      const energy = earEnergy.reduce((sum, value) => sum + value, 0), stableOutput = position.outputNode === output;
      const before = { state: context.state, time: context.currentTime, sourceStartedAt,
        nativeGain: position.nativeGain.gain.value, customGain: position.customGain.gain.value, outputGain: output.gain.value };
      const node: AudioWorkletNode = position.custom, pack = preparedHrtfPack(context, 'sadie-d1'), beforeFailure = failures;
      if (!(energy > .000001)) return { worklets: worklets.length, workletNames, targetMatchesFirst: node === worklets[0],
        panners, energy, earEnergy, before, errors, errorEvents, stableOutput, protocolIdle, processorFailed: false, beforeFailure,
        failures, silent: true, disposed: position.disposed, armed: false };
      const stopped = new Promise<boolean>(resolve => {
        onFault = processor => { if (processor === node) resolve(true); };
        setTimeout(() => resolve(false), 2500);
      });
      node.port.postMessage({ pack: { ...pack, inverse: new Float64Array(pack.inverse.length).fill(NaN) } });
      const processorFailed = await stopped;
      await waitForAudioTime(context, context.currentTime + .05);
      analysers.forEach((analyser, ear) => analyser.getFloatTimeDomainData(values[ear]!));
      const silent = values.every(channel => channel.every(value => value === 0)), disposed = position.disposed;
      splitter.disconnect(); analysers.forEach(analyser => analyser.disconnect());
      position.dispose(); position.dispose();
      return { worklets: worklets.length, workletNames, targetMatchesFirst: node === worklets[0], panners, energy, earEnergy, before, errors, errorEvents,
        stableOutput, protocolIdle, processorFailed, beforeFailure, failures, silent, disposed, armed: true };
    } finally {
      position?.dispose(); source?.stop(); window.AudioWorkletNode = original; await context.close();
    }
  });
  await test.info().attach('hrtf-live-disposal.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.worklets).toBe(2); expect(result.panners).toBe(1); expect(result.stableOutput).toBe(true); expect(result.protocolIdle).toBe(true);
  expect(result.workletNames).toEqual(['asmr-hrtf', 'asmr-hrtf-motion']); expect(result.targetMatchesFirst).toBe(true);
  expect(result.before.state).toBe('running'); expect(result.before.time - result.before.sourceStartedAt).toBeGreaterThanOrEqual(.15);
  expect(result.energy).toBeGreaterThan(.000001); expect(result.beforeFailure).toBe(0);
  expect(result.earEnergy.every(energy => energy > .000001)).toBe(true);
  expect(result.armed).toBe(true);
  expect(result.errors).toEqual(['asmr-hrtf']);
  expect(result.errorEvents.every(event => event.targetMatches && event.type === 'processorerror')).toBe(true);
  expect(result.processorFailed).toBe(true); expect(result.failures).toBe(1); expect(result.silent).toBe(true); expect(result.disposed).toBe(true);
});

test('@live late custom motion starts at the audio frame and stays continuous through period and profile edits', async ({ page }) => {
  test.setTimeout(60_000); await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const loaderPath = '/src/audio/hrtf-audio.ts', positionPath = '/src/audio/asmr-position.ts';
    const { prepareHrtfAudio } = await import(loaderPath), { AsmrPosition } = await import(positionPath);
    const context = new AudioContext(), source = context.createOscillator(), level = context.createGain();
    let position: any, observer: AudioWorkletNode | undefined, zero: GainNode | undefined, moduleUrl = '';
    const wait = async (seconds: number) => {
      const target = context.currentTime + seconds, deadline = performance.now() + 5000;
      while (context.currentTime < target && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (context.currentTime < target) throw new Error('Audio clock did not advance.');
    };
    try {
      await prepareHrtfAudio(context, { layers: ['sadie-d1', 'sadie-h10'].map(profile => ({ spatial: { profile } })) });
      await context.resume(); source.frequency.value = 400; level.gain.value = .01; source.connect(level); source.start();
      const base = { azimuth: 60, elevation: 25, distance: .6, motion: 'orbit' };
      position = new AsmrPosition(context, level, context.destination, base, 2);
      await wait(.12); position.update(base, 6); await wait(.04);
      position.update({ ...base, profile: 'sadie-d1' }, 3);
      const state = position.motionClock.snapshot(), createdAt = context.currentTime, motionNode = position.customMotion, output = position.outputNode;
      moduleUrl = URL.createObjectURL(new Blob([`
        class Capture extends AudioWorkletProcessor {
          constructor() { super(); this.values = Array.from({length:3}, () => new Float32Array(Math.round(sampleRate*.4))); this.used=0; this.frame=-1; this.done=false; }
          process(inputs) {
            if(this.done || !inputs[0] || inputs[0].length<3) return true;
            if(this.frame<0) this.frame=currentFrame;
            const length=Math.min(inputs[0][0].length,this.values[0].length-this.used);
            for(let channel=0;channel<3;channel++) this.values[channel].set(inputs[0][channel].subarray(0,length),this.used);
            this.used+=length;
            if(this.used===this.values[0].length) { this.done=true; this.port.postMessage({frame:this.frame,rate:sampleRate,channels:this.values},this.values.map(value=>value.buffer)); }
            return true;
          }
        }
        registerProcessor('hrtf-motion-capture',Capture);
      `], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(moduleUrl);
      observer = new AudioWorkletNode(context, 'hrtf-motion-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 3, channelCountMode: 'explicit', channelInterpretation: 'discrete', outputChannelCount: [1],
      });
      const captured = new Promise<{ frame: number; rate: number; channels: Float32Array[] }>((resolve, reject) => {
        observer!.port.onmessage = event => resolve(event.data); setTimeout(() => reject(new Error('Motion capture did not complete.')), 5000);
      });
      zero = context.createGain(); zero.gain.value = 0; position.customMotion.connect(observer); observer.connect(zero).connect(context.destination);
      await wait(.08); position.update({ ...base, profile: 'sadie-h10' }, 8);
      await wait(.08); position.update(base, 4);
      await wait(.08); position.update({ ...base, profile: 'sadie-d1' }, 2.5);
      const data = await captured;
      const elapsed = Math.max(0, data.frame / data.rate - state.time);
      const cycles = state.phase + state.target * elapsed + (state.from - state.target) * .035 * (1 - Math.exp(-elapsed / .035));
      const firstError = Math.max(Math.abs(data.channels[0][0] - Math.sin(2 * Math.PI * cycles)), Math.abs(data.channels[1][0] - Math.cos(2 * Math.PI * cycles)));
      const phaseIntegrationBound = 2 * Math.PI * Math.abs((state.from - state.target) * (1 - Math.exp(-elapsed / .035))) / data.rate;
      let maxStep = 0, maxCircleError = 0, harmonicError = 0, finite = true;
      for (let frame = 1; frame < data.channels[0].length; frame++) {
        const sine = data.channels[0][frame], cosine = data.channels[1][frame], previousSine = data.channels[0][frame - 1], previousCosine = data.channels[1][frame - 1];
        maxStep = Math.max(maxStep, Math.abs(Math.atan2(sine * previousCosine - cosine * previousSine, sine * previousSine + cosine * previousCosine)));
        maxCircleError = Math.max(maxCircleError, Math.abs(sine ** 2 + cosine ** 2 - 1));
        harmonicError = Math.max(harmonicError, Math.abs(data.channels[2][frame] - 2 * sine * cosine));
        finite &&= Number.isFinite(sine + cosine + data.channels[2][frame]);
      }
      return { firstError, phaseIntegrationBound, maxStep, maxCircleError, harmonicError, finite, rate: data.rate, createdAt,
        captureAt: data.frame / data.rate, state, customReused: position.customMotion === motionNode, output: position.outputNode === output };
    } finally {
      position?.dispose(); observer?.disconnect(); observer?.port.close(); zero?.disconnect(); source.stop();
      if (moduleUrl) URL.revokeObjectURL(moduleUrl); await context.close();
    }
  });
  await test.info().attach('hrtf-live-motion-continuity.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const diagnostic = JSON.stringify(result);
  expect(result.finite, diagnostic).toBe(true);
  // A monotone frequency ramp's sampled integral differs by at most one sample of its frequency change.
  expect(result.firstError, diagnostic).toBeLessThan(result.phaseIntegrationBound + .000002);
  expect(result.maxStep, diagnostic).toBeLessThan(2 * Math.PI * .5 / result.rate + .000002);
  expect(result.maxCircleError, diagnostic).toBeLessThan(.000001); expect(result.harmonicError, diagnostic).toBeLessThan(.000001);
  expect(result.customReused).toBe(true); expect(result.output).toBe(true);
});
