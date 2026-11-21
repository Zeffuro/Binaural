import { expect, test } from '@playwright/test';

test('spatial ASMR validates every bound, preserves legacy stereo and round-trips JSON/share state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const spatialPath = '/src/asmr-spatial.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', sharePath = '/src/share.ts';
    const { defaultSpatial, parseAsmrSpatial, spatialPosition, asmrSpatialMotions } = await import(spatialPath);
    const motionIds: string[] = asmrSpatialMotions;
    const { makeAsmrLayer, parseAsmr } = await import(statePath), { initialSession, parseSession } = await import(modelPath);
    const { sessionLink, readSharedSession } = await import(sharePath);
    const base = defaultSpatial(), bad: unknown[] = [undefined, null, [], false, 1, 'spatial', {}];
    for (const [field, values] of Object.entries({ azimuth: [-181, 181, NaN, Infinity, '-90', null], elevation: [-61, 61],
      distance: [.149, 3.001, 0], motion: ['wander', 'SWEEP', 'ORBIT', 'figure8', null, ['still']] })) {
      for (const value of values) bad.push({ ...base, [field]: value });
    }
    const rejected = bad.every(value => { try { parseAsmrSpatial(value); return false; } catch { return true; } });
    const missing = Object.keys(base).every(key => {
      const value = { ...base }; delete value[key];
      try { parseAsmrSpatial(value); return false; } catch { return true; }
    });
    const boundaries = [-180, 180].flatMap(azimuth => [-60, 60].flatMap(elevation => [.15, 3].flatMap(distance =>
      motionIds.map(motion => parseAsmrSpatial({ azimuth, elevation, distance, motion })))));
    const legacy = makeAsmrLayer('air'); legacy.pan = -1; legacy.motion = 'still';
    const spatial = { azimuth: -85, elevation: 35, distance: .3, motion: 'orbit' };
    const session = initialSession(); session.asmr = { level: .6, layers: [{ ...legacy, spatial }] };
    const json = parseSession(JSON.parse(JSON.stringify(session))), shared = readSharedSession(new URL(sessionLink(session)).hash);
    const motions = motionIds.map(motion => {
      session.asmr.layers[0].spatial.motion = motion;
      return { motion, json: parseSession(JSON.parse(JSON.stringify(session))).asmr.layers[0].spatial.motion,
        share: readSharedSession(new URL(sessionLink(session)).hash).asmr.layers[0].spatial.motion };
    });
    const invalidLayer = bad.every(spatial => {
      if (spatial === undefined) return true;
      try { parseAsmr({ level: .6, layers: [{ ...legacy, spatial }] }); return false; } catch { return true; }
    });
    return { rejected, missing, invalidLayer, motions, boundaries: boundaries.length,
      legacy: parseAsmr({ level: .6, layers: [legacy] }).layers[0].spatial === undefined,
      json: json.asmr.layers[0].spatial, shared: shared.asmr.layers[0].spatial,
      positions: [0, 90, -90, 180].map(azimuth => spatialPosition({ ...base, azimuth, distance: 1 })),
      elevated: spatialPosition({ ...base, elevation: 60, distance: 2 }) };
  });
  expect(result.rejected).toBe(true); expect(result.missing).toBe(true); expect(result.invalidLayer).toBe(true);
  expect(result.boundaries).toBe(64); expect(result.legacy).toBe(true);
  expect(result.motions.map(({ motion }) => motion)).toEqual(['still', 'orbit', 'sweep', 'approach', 'rise', 'figure-eight', 'rear-to-front', 'quiet-return']);
  for (const motion of result.motions) { expect(motion.json).toBe(motion.motion); expect(motion.share).toBe(motion.motion); }
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
    const sweep = await render({ motion: 'sweep' }), rise = await render({ motion: 'rise' });
    const approach = await render({ motion: 'approach' }), figure = await render({ motion: 'figure-eight' });
    let peak = 0, finite = true;
    for (const channels of [left, right, front, back, above, below, near, far, cancelled, cancelledOrbit, orbit, fixed, sweep, rise, approach, figure]) {
      for (const channel of channels) for (const sample of channel) { finite &&= Number.isFinite(sample); peak = Math.max(peak, Math.abs(sample)); }
    }
    return { left: power(left), right: power(right), frontBack: difference(front, back), elevation: difference(above, below),
      distance: power(far).reduce((a, b) => a + b) / power(near).reduce((a, b) => a + b), cancelled: power(cancelled), cancelledOrbit: power(cancelledOrbit),
      orbitRight: power(orbit, .35, .65), orbitLeft: power(orbit, 1.35, 1.65), orbitDifference: difference(orbit, fixed),
      sweepRight: power(sweep, .35, .65), sweepLeft: power(sweep, 1.35, 1.65),
      figureRight: power(figure, .35, .65), figureLeft: power(figure, 1.35, 1.65),
      approachNear: power(approach, .85, 1.15), approachFar: power(approach, .05, .25),
      movementDifferences: [sweep, rise, approach, figure].map(channels => difference(channels, fixed)), finite, peak };
  });
  expect(result.finite).toBe(true); expect(result.peak).toBeGreaterThan(.005); expect(result.peak).toBeLessThan(.3);
  expect(result.left[0]).toBeGreaterThan(result.left[1] * 1.2); expect(result.right[1]).toBeGreaterThan(result.right[0] * 1.2);
  expect(result.frontBack).toBeGreaterThan(.000001); expect(result.elevation).toBeGreaterThan(.000001);
  expect(result.distance).toBeGreaterThan(.02); expect(result.distance).toBeLessThan(.1);
  expect(Math.max(...result.cancelled, ...result.cancelledOrbit)).toBeLessThan(1e-12);
  expect(result.orbitRight[1]).toBeGreaterThan(result.orbitRight[0] * 1.2);
  expect(result.orbitLeft[0]).toBeGreaterThan(result.orbitLeft[1] * 1.2); expect(result.orbitDifference).toBeGreaterThan(.000001);
  for (const [right, left] of [[result.sweepRight, result.sweepLeft], [result.figureRight, result.figureLeft]]) {
    expect(right[1]).toBeGreaterThan(right[0] * 1.2); expect(left[0]).toBeGreaterThan(left[1] * 1.2);
  }
  expect(result.approachNear.reduce((a, b) => a + b)).toBeGreaterThan(result.approachFar.reduce((a, b) => a + b) * 1.2);
  for (const difference of result.movementDifferences) expect(difference).toBeGreaterThan(.000001);
});

test('all spatial trajectories stay finite and bounded while retaining legacy still and orbit coordinates', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/asmr-spatial.ts', { asmrSpatialMotions, sampleSpatialPosition, spatialPosition } = await import(path);
    const motions: string[] = asmrSpatialMotions;
    let bounded = true, finite = true, legacyError = 0, variation = 0;
    for (const motion of motions) for (const distance of [.15, .16, .6, 3]) {
      for (const azimuth of [-180, -70, 0, 110, 180]) for (const elevation of [-60, 0, 60]) {
        const settings = { motion, distance, azimuth, elevation }, initial = spatialPosition(settings);
        const minimumReach = motion === 'quiet-return' ? .6 : motion === 'rear-to-front' ? .45 : .15;
        const reach = Math.max(minimumReach, distance);
        for (let step = 0; step < 65; step++) {
          const seconds = step / 16, coordinate = sampleSpatialPosition(settings, seconds, 4);
          const radius = Math.hypot(coordinate.x, coordinate.y, coordinate.z);
          finite &&= Object.values(coordinate).every(Number.isFinite); bounded &&= radius >= .15 - 1e-9 && radius <= reach + 1e-9;
          if (motion === 'still' || motion === 'orbit') {
            const angle = 2 * Math.PI * seconds / 4;
            const expected = motion === 'still' ? initial : {
              x: initial.x * Math.cos(angle) - initial.z * Math.sin(angle), y: initial.y,
              z: initial.x * Math.sin(angle) + initial.z * Math.cos(angle),
            };
            legacyError = Math.max(legacyError, Math.hypot(coordinate.x - expected.x, coordinate.y - expected.y, coordinate.z - expected.z));
          }
        }
      }
    }
    for (const motion of motions.filter(motion => motion !== 'still')) {
      const settings = { motion, distance: .6, azimuth: 0, elevation: 0 };
      const first = sampleSpatialPosition(settings, 0, 4);
      const next = sampleSpatialPosition(settings, motion === 'rear-to-front' || motion === 'quiet-return' ? .5 : 1, 4);
      variation += Math.hypot(first.x - next.x, first.y - next.y, first.z - next.z) > .1 ? 1 : 0;
    }
    return { finite, bounded, legacyError, variation };
  });
  expect(result.finite).toBe(true); expect(result.bounded).toBe(true);
  expect(result.legacyError).toBeLessThan(1e-12); expect(result.variation).toBe(7);
});

test('rear-to-front passes both ears in turn and rotates with the chosen direction', async ({ page }) => {
  await page.goto('/');
  const { ahead, turned } = await page.evaluate(async () => {
    const path = '/src/asmr-spatial.ts', { sampleSpatialPosition } = await import(path);
    const at = (azimuth: number) => [1, 3, 5, 7].map(seconds =>
      sampleSpatialPosition({ azimuth, elevation: 0, distance: .8, motion: 'rear-to-front' }, seconds, 8));
    return { ahead: at(0), turned: at(90) };
  });
  const [rearLeft, frontLeft, rearRight, frontRight] = ahead;
  expect(rearLeft.x).toBeLessThan(-.2);
  expect(rearLeft.z).toBeGreaterThan(.2);
  expect(rearRight.x).toBeCloseTo(-rearLeft.x, 10);
  expect(rearRight.z).toBeCloseTo(rearLeft.z, 10);
  for (const front of [frontLeft, frontRight]) {
    expect(front.x).toBeCloseTo(0, 10);
    expect(front.z).toBeLessThan(-.2);
  }
  for (const [index, point] of ahead.entries()) {
    expect(turned[index].x).toBeCloseTo(-point.z, 10);
    expect(turned[index].z).toBeCloseTo(point.x, 10);
  }
});

test('plastic clicks preset loads a clear 3D recording with its paired tap visual', async ({ page }) => {
  await page.goto('/');
  await page.locator('#asmr-browse').click();
  await page.locator('#preset-search').fill('plastic lid clicks');
  const load = page.locator('[data-load-preset="asmr-plastic-clicks-around-you"]');
  const card = page.locator('.explore-card').filter({ has: load });
  await expect(card.locator('.experience-label')).toContainText('Points of contact');
  await load.click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })
    .getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-plastic-lid');
  await expect(page.getByLabel('Sound 1 clear recording', { exact: true })).toBeChecked();
  await page.locator('.asmr-advanced summary').first().click();
  const movement = page.getByLabel('Sound 1 3D movement', { exact: true });
  await expect(movement).toHaveValue('rear-to-front');
  await expect(movement.locator('option:checked')).toHaveText('Behind each ear to front');
  await expect(page.getByLabel('Sound 1 headphone profile', { exact: true })).toHaveValue('native');
  await expect(page.locator('#trigger-enable')).toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('plastic clicks with a quiet return load with the matching 3D movement and visual', async ({ page }) => {
  await page.goto('/');
  await page.locator('#asmr-browse').click();
  await page.locator('#preset-search').fill('quiet return');
  await page.locator('[data-load-preset="asmr-plastic-quiet-approach"]').click();
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })
    .getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-plastic-toy');
  await expect(page.getByLabel('Sound 1 clear recording', { exact: true })).toBeChecked();
  await page.locator('.asmr-advanced summary').first().click();
  const movement = page.getByLabel('Sound 1 3D movement', { exact: true });
  await expect(movement).toHaveValue('quiet-return');
  await expect(movement.locator('option:checked')).toHaveText('Approach with quiet return');
  await expect(page.getByLabel('Sound 1 headphone profile', { exact: true })).toHaveValue('native');
  await expect(page.locator('#trigger-enable')).toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('adjustable quiet return uses the same timed position and muted gaps for native and SADIE audio', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const positionPath = '/src/audio/asmr-position.ts', loaderPath = '/src/audio/hrtf-audio.ts';
    const { AsmrPosition } = await import(positionPath), { prepareHrtfAudio } = await import(loaderPath);
    const rate = 48000, results = [];
    for (const profile of [undefined, 'sadie-d1']) {
      const settings = { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return', profile,
        quietReturn: { closest: .28, approach: 1.5, gap: .8 } };
      const render = async (offset: number) => {
        const context = new OfflineAudioContext(6, Math.round((4.6 - offset) * rate), rate);
        await prepareHrtfAudio(context, { layers: [{ spatial: settings }] });
        const tone = context.createOscillator(), gain = context.createGain(), sink = context.createGain();
        tone.frequency.value = 931; gain.gain.value = .025; tone.connect(gain);
        const position = new AsmrPosition(context, gain, sink, settings, 17, undefined, offset);
        const ears = context.createChannelSplitter(2), merger = context.createChannelMerger(6);
        sink.connect(ears); ears.connect(merger, 0, 0); ears.connect(merger, 1, 1);
        for (let channel = 0; channel < 4; channel++) position.adjustableSplitter.connect(merger, channel, channel + 2);
        merger.connect(context.destination); tone.start();
        const buffer = await context.startRendering(); position.dispose();
        return Array.from({ length: 6 }, (_, index) => buffer.getChannelData(index));
      };
      const offset = 2.6, full = await render(0), part = await render(offset);
      const point = (time: number) => full.slice(2).map(channel => channel[Math.round(time * rate)]);
      const power = (start: number, end: number) => {
        let value = 0;
        const from = Math.round(start * rate), to = Math.round(end * rate);
        for (let index = from; index < to; index++) value += full[0][index] ** 2 + full[1][index] ** 2;
        return value / (to - from);
      };
      let sectionError = 0;
      for (let channel = 2; channel < 6; channel++) for (let index = 0; index < part[channel].length; index += 113) {
        sectionError = Math.max(sectionError, Math.abs(part[channel][index] - full[channel][index + Math.round(offset * rate)]));
      }
      results.push({ profile, left: point(.02), near: point(1.5), right: point(2.32),
        forward: [power(.3, 1.3), power(2.6, 3.6)], quiet: [power(1.73, 2.2), power(4.01, 4.5)], sectionError });
    }
    return results;
  });
  for (const result of results) {
    expect(result.left[0]).toBeLessThan(-.5); expect(result.left[2]).toBeGreaterThan(.5);
    expect(result.right[0]).toBeGreaterThan(.5); expect(result.right[2]).toBeGreaterThan(.5);
    expect(Math.hypot(...result.near.slice(0, 3))).toBeCloseTo(.28, 4);
    expect(result.near[2]).toBeCloseTo(-.28, 4);
    const audible = Math.min(...result.forward);
    expect(audible).toBeGreaterThan(1e-8);
    expect(Math.max(...result.quiet)).toBeLessThan(audible * 1e-5);
    expect(result.sectionError).toBeLessThan(.00002);
  }
});

test('editing timings during a quiet gap keeps the gap quiet and preserves which ear comes next', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/audio/quiet-approach.ts';
    const { QuietApproachRenderer } = await import(rendererPath);
    const path = { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return',
      quietReturn: { closest: .2, approach: 1, gap: 2 } };
    const renderer = new QuietApproachRenderer(path, 0, 0);
    const output = (count: number) => Array.from({ length: 4 }, () => new Float32Array(count));
    renderer.render(output(1500), 0, 1000);
    renderer.configure({ ...path, quietReturn: { closest: .35, approach: 2, gap: 1 } });
    const next = output(2800);
    renderer.render(next, 1500, 1000);
    return { gapSilent: next[3].slice(0, 750).every(value => value === 0),
      rightX: next[0][850], audible: next[3][1100], closeZ: next[2][2750] };
  });
  expect(result.gapSilent).toBe(true);
  expect(result.rightX).toBeGreaterThan(.5);
  expect(result.audible).toBeGreaterThan(.8);
  expect(result.closeZ).toBeCloseTo(-.35, 4);
});

test('recorded click audio reaches minimum distance at each ear and keeps the full tail through native and measured HRTF', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const positionPath = '/src/audio/asmr-position.ts', loaderPath = '/src/audio/hrtf-audio.ts';
    const { AsmrPosition } = await import(positionPath), { prepareHrtfAudio } = await import(loaderPath);
    const rate = 48000, approach = .75, gap = .45, hold = .30, release = Math.round((approach + hold) * rate) + 1;
    const leg = release + Math.round(gap * rate), results = [];
    const clips = [1, .6].map(scale => Float32Array.from({ length: 7200 }, (_, frame) => {
      if (frame < 960 || frame >= 6000) return 0;
      return scale * .1 * Math.exp(-(frame - 960) / 1600) * Math.cos((frame - 960) * .17);
    }));
    for (const profile of [undefined, 'sadie-d1']) {
      const settings = { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return', profile,
        quietReturn: { closest: .22, approach, gap, syncClicks: true } };
      const render = async (offset: number) => {
        const context = new OfflineAudioContext(6, leg * 2 - offset, rate);
        await prepareHrtfAudio(context, { layers: [{ spatial: settings }] });
        const input = context.createGain(), sink = context.createGain();
        const position = new AsmrPosition(context, input, sink, settings, 17, undefined, offset / rate, undefined,
          { banks: [{ sampleRate: rate, clips }], speed: 1, destination: input });
        const ears = context.createChannelSplitter(2), merger = context.createChannelMerger(6);
        sink.connect(ears); ears.connect(merger, 0, 0); ears.connect(merger, 1, 1);
        for (let channel = 0; channel < 4; channel++) position.adjustableSplitter.connect(merger, channel, channel + 2);
        merger.connect(context.destination);
        const buffer = await context.startRendering(); position.dispose();
        return Array.from({ length: 6 }, (_, index) => buffer.getChannelData(index));
      };
      const offset = release - 5300, full = await render(0), part = await render(offset);
      const passes = clips.map((clip, index) => {
        const start = index * leg + release - clip.length, peak = start + 960, quiet = index * leg + release;
        const sides = [0, 1].map(ear => full[ear].slice(start, quiet).reduce((sum, s) => sum + s * s, 0));
        const quietPeak = Math.max(...[0, 1].map(ear => full[ear].slice(quiet + 7200, (index + 1) * leg)
          .reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
        return { x: full[2][peak], radius: Math.hypot(full[2][peak], full[3][peak], full[4][peak]),
          exactClip: full[5].slice(start, quiet).every((sample, frame) => sample === clip[frame]),
          silentGap: full[5].slice(quiet, (index + 1) * leg).every(sample => sample === 0), sides, quietPeak };
      });
      results.push({ profile, passes, exactSection: part.slice(2).every((channel, index) =>
        channel.every((sample, frame) => sample === full[index + 2][frame + offset])) });
    }
    return results;
  });
  for (const item of results) {
    expect(item.exactSection).toBe(true);
    expect(item.passes[0].x).toBeLessThan(-.2); expect(item.passes[1].x).toBeGreaterThan(.2);
    for (const pass of item.passes) {
      expect(pass.radius).toBeCloseTo(.22, 6);
      expect(pass.exactClip).toBe(true); expect(pass.silentGap).toBe(true);
      expect(Math.max(...pass.sides)).toBeGreaterThan(.0001);
      expect(pass.quietPeak).toBeLessThan(.0001);
    }
  }
});

test('edits during a click preserve that waveform and apply to the opposite pass', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/quiet-click-renderer.ts', { QuietClickRenderer } = await import(path);
    const rate = 1000, clip = Float32Array.from({ length: 170 }, (_, i) =>
      i > 24 && i < 145 ? Math.exp(-(i - 25) / 35) : 0);
    const bank = { sampleRate: rate, clips: [clip] };
    const settings = { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return',
      quietReturn: { closest: .2, approach: .5, gap: .25, syncClicks: true } };
    const edited = { ...settings, quietReturn: { ...settings.quietReturn, closest: .4, approach: 1.5, gap: .8 } };
    const output = (count: number) => Array.from({ length: 4 }, () => new Float32Array(count));
    const renderer = new QuietClickRenderer([bank], settings, 1, rate, 0, 0, false);
    renderer.render(output(680), 0);
    renderer.configure(edited, .5);
    const remainder = output(2300); renderer.render(remainder, 680);
    const original = output(1051);
    new QuietClickRenderer([bank], settings, 1, rate, 0, 0, false).render(original, 0);
    const secondPeak = 1051 + 1500 + 601 - 2 * (170 - 25);
    const partial = output(300);
    new QuietClickRenderer([bank], settings, 1, rate, 0, .68, true).render(partial, 0);
    return { unchanged: original.every((channel, index) => channel.slice(680).every((sample, frame) => sample === remainder[index][frame])),
      peak: remainder[3][secondPeak - 680], right: remainder[0][secondPeak - 680],
      skipPartial: partial[3].every(sample => sample === 0) };
  });
  expect(result.unchanged).toBe(true);
  expect(result.peak).toBe(1);
  expect(result.right).toBeGreaterThan(.38);
  expect(result.skipPartial).toBe(true);
});

test('a varied click sequence keeps whole hits at opposite ears and can seek past its cycle', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/audio/quiet-click-renderer.ts', sequencePath = '/src/audio/quiet-click-sequence.ts';
    const { QuietClickRenderer } = await import(rendererPath), { quietClickTurns } = await import(sequencePath);
    const rate = 1000, approach = 3200, hold = 301, release = approach + hold;
    const timing = { closest: .2, approach: approach / rate, gap: 5.2, syncClicks: true,
      sequence: { recordings: ['recorded-plastic-switch', 'recorded-plastic-pen', 'recorded-plastic-button'],
        gapSpread: 3, seed: 26913 } };
    const settings = { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return', quietReturn: timing };
    const banks = Array.from({ length: 4 }, (_, recording) => ({ sampleRate: rate,
      clips: Array.from({ length: 7 }, (_, clip) => Float32Array.from({ length: 170 + clip * 5 }, (_, frame) =>
        frame >= 25 && frame < 140 ? (.2 + .1 * recording + .01 * clip) * Math.exp(-(frame - 25) / 30) : 0)) }));
    const turns: { recording: number; gap: number }[] = quietClickTurns(timing);
    const cycle = turns.reduce((frames, turn) => frames + release + Math.round(turn.gap * rate), 0);
    const render = (offset: number, length: number, stop?: number) => {
      const output = Array.from({ length: 4 }, () => new Float32Array(length));
      new QuietClickRenderer(banks, settings, 1, rate, 0, offset / rate, false).render(output, 0, stop);
      return output;
    };
    const first = turns.slice(0, 12);
    const frames = first.reduce((sum, turn) => sum + release + Math.round(turn.gap * rate), 0);
    const output = render(0, frames), seen = banks.map(() => 0);
    let start = 0;
    const visits = first.map((turn, index) => {
      const bank = banks[turn.recording], clip = bank.clips[seen[turn.recording]++ % bank.clips.length];
      const end = start + release, firstSample = end - clip.length, peak = firstSample + 25;
      const distance = Math.hypot(...output.slice(0, 3).map(axis => axis[peak]));
      const exact = output[3].subarray(firstSample, end).every((sample, frame) => sample === clip[frame]);
      start = end + Math.round(turn.gap * rate);
      return { exact, distance, right: output[0][peak] > 0, isRight: index % 2 === 1,
        silent: output[3].subarray(end, start).every(sample => sample === 0) };
    });
    const full = render(cycle - 300, 11_000), section = render(cycle + 3300, 5000);
    const second = release + Math.round(first[0].gap * rate);
    const timedEnd = render(0, second + release, second + release - 50)[3];
    return { cycleSeconds: cycle / rate, visits, seam: section.every((channel, index) =>
      channel.every((value, frame) => full[index][3600 + frame] === value)),
      bankRepeat: turns.some((turn, index) => turn.recording === turns[(index + 1) % turns.length].recording),
      banksPerEar: [0, 1].map(side => new Set(turns.filter((_, i) => i % 2 === side).map(turn => turn.recording)).size),
      pauses: new Set(first.map(turn => Math.round(turn.gap * rate))).size,
      inBounds: turns.every(turn => turn.gap >= 2.2 && turn.gap <= 8.2),
      completeAtEnd: timedEnd.slice(0, second).every((sample, frame) => sample === output[3][frame]) &&
        timedEnd.slice(second).every(sample => sample === 0),
      stable: JSON.stringify(turns) === JSON.stringify(quietClickTurns(timing)) };
  });
  expect(result.cycleSeconds).toBeGreaterThan(45 * 60);
  expect(result.bankRepeat).toBe(false); expect(result.banksPerEar).toEqual([4, 4]);
  expect(result.pauses).toBeGreaterThan(6); expect(result.inBounds).toBe(true);
  expect(result.stable).toBe(true); expect(result.seam).toBe(true); expect(result.completeAtEnd).toBe(true);
  for (const hit of result.visits) {
    expect(hit.exact).toBe(true); expect(hit.silent).toBe(true); expect(hit.right).toBe(hit.isRight);
    expect(hit.distance).toBeCloseTo(.2, 6);
  }
});

test('quiet return approaches from alternating rear sides and reaches the center in front', async ({ page }) => {
  await page.goto('/');
  const passes = await page.evaluate(async () => {
    const path = '/src/asmr-spatial.ts', { sampleSpatialPosition } = await import(path);
    const settings = { azimuth: 0, elevation: 0, distance: .8, motion: 'quiet-return' };
    return [1, 5].map(start => Array.from({ length: 33 }, (_, step) =>
      sampleSpatialPosition(settings, start + step / 16, 8) as { x: number; y: number; z: number }));
  });
  const [left, right] = passes;
  expect(left[0].x).toBeLessThan(-.2);
  expect(left[0].z).toBeGreaterThan(.2);
  for (const [step, point] of left.entries()) {
    expect(right[step].x).toBeCloseTo(-point.x, 10);
    expect(right[step].z).toBeCloseTo(point.z, 10);
  }
  for (const pass of passes) {
    const front = pass[pass.length - 1];
    expect(front.x).toBeCloseTo(0, 10);
    expect(front.z).toBeLessThan(-.15);
    const distances = pass.map(({ x, y, z }) => Math.hypot(x, y, z));
    for (let step = 1; step < distances.length; step++) {
      expect(distances[step]).toBeLessThanOrEqual(distances[step - 1] + 1e-10);
    }
    expect(distances[distances.length - 1]).toBeLessThan(distances[0] * .75);
  }
});

for (const profile of [undefined, 'sadie-d1']) {
  test(`both approaches are audible after seeking and both returns are quiet (${profile ?? 'native'})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    const result = await page.evaluate(async profile => {
      const positionPath = '/src/audio/asmr-position.ts', loaderPath = '/src/audio/hrtf-audio.ts';
      const { AsmrPosition } = await import(positionPath), { prepareHrtfAudio } = await import(loaderPath);
      const rate = 48000, duration = 8, offset = 1.375;
      const settings = { azimuth: 0, elevation: 0, distance: .8, motion: 'quiet-return', profile };
      const samples = new Float32Array(rate * duration);
      for (const hz of [613, 1097, 2179, 3671]) {
        const radiansPerFrame = 2 * Math.PI * hz / rate;
        for (let i = 0; i < samples.length; i++) samples[i] += .015 * Math.sin(radiansPerFrame * i);
      }
      const render = async (start: number) => {
        const context = new OfflineAudioContext(2, Math.round((duration - start) * rate), rate);
        await prepareHrtfAudio(context, { layers: [{ spatial: settings }] });
        const source = context.createBufferSource(), buffer = context.createBuffer(1, samples.length, rate);
        buffer.copyToChannel(samples, 0); source.buffer = buffer;
        const position = new AsmrPosition(context, source, context.destination, settings, duration, duration - start, start);
        source.start(0, start);
        const output = await context.startRendering();
        position.dispose(); source.disconnect();
        // Allow both HRTF paths to settle at the start of a section and ring out after each fade.
        const power = (from: number, to: number) => [0, 1].map(ear => {
          const channel = output.getChannelData(ear);
          const first = Math.round((from - start) * rate), end = Math.round((to - start) * rate);
          let sum = 0;
          for (let frame = first; frame < end; frame++) sum += channel[frame] ** 2;
          return sum / (end - first);
        });
        return { forward: [power(1.7, 2.3), power(5.7, 6.3)], quiet: [power(3.35, 4.65), power(7.35, 7.85)] };
      };
      return { full: await render(0), section: await render(offset) };
    }, profile);
    for (const { forward, quiet } of [result.full, result.section]) {
      const weakerPass = Math.min(...forward.map(([left, right]) => left + right));
      expect(weakerPass).toBeGreaterThan(1e-8);
      expect(Math.max(...quiet.flat())).toBeLessThan(weakerPass * 1e-5);
    }
    for (const [pass, ears] of result.full.forward.entries()) {
      for (const [ear, power] of ears.entries()) {
        const ratio = result.section.forward[pass][ear] / power;
        expect(ratio).toBeGreaterThan(.75);
        expect(ratio).toBeLessThan(1.25);
      }
    }
  });
}

test('native spatial modulation matches absolute trajectory phase including three-hour section offsets', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const spatialPath = '/src/asmr-spatial.ts', positionPath = '/src/audio/asmr-position.ts';
    const { asmrSpatialMotions, sampleSpatialPosition } = await import(spatialPath), { AsmrPosition } = await import(positionPath);
    const results: { motion: string; offset: number; initialError: number; nativeError: number; peak: number }[] = [];
    for (const motion of asmrSpatialMotions as string[]) for (const offset of [0, 10800]) {
      const context = new OfflineAudioContext(6, 88200, 44100), source = context.createGain(), sink = context.createGain();
      const settings = { motion, distance: 1.7, azimuth: -65, elevation: 35 }, period = 2.7;
      const position = new AsmrPosition(context, source, sink, settings, period, 2, offset), merger = context.createChannelMerger(6);
      const centers = [position.panner.positionX, position.panner.positionY, position.panner.positionZ].map((parameter: AudioParam, axis: number) => {
        const constant = context.createConstantSource(); constant.offset.value = parameter.value;
        constant.connect(merger, 0, axis); constant.start(); return constant;
      });
      position.matrix.forEach((coefficient: GainNode, index: number) => coefficient.connect(merger, 0, Math.floor(index / 3)));
      // Native sine and custom quadrature accumulate float phase differently in Firefox.
      const references = [1 / period, 1 / period, 2 / period].map((frequency, index) => {
        const oscillator = context.createOscillator(); oscillator.frequency.value = frequency;
        if (offset > 0 || index === 1) {
          const cycles = ((Math.fround(frequency) * offset) % 1 + 1) % 1 + (index === 1 ? .25 : 0);
          const angle = cycles * 2 * Math.PI;
          oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, Math.sin(angle)]),
            new Float32Array([0, Math.cos(angle)]), { disableNormalization: true }));
        }
        oscillator.connect(merger, 0, index + 3); oscillator.start(); return oscillator;
      });
      merger.connect(context.destination); const buffer = await context.startRendering();
      const cycleSeconds = 1 / Math.fround(1 / period);
      const [start, quarter, half, threeQuarters, eighth] = [0, .25, .5, .75, .125].map(cycle => sampleSpatialPosition(settings, cycle * cycleSeconds, period));
      const channels = Array.from({ length: 6 }, (_, channel) => buffer.getChannelData(channel));
      const coefficients = (['x', 'y', 'z'] as const).map(axis => {
        const center = (start[axis] + half[axis]) / 2, cosine = (start[axis] - half[axis]) / 2;
        const sine = (quarter[axis] - threeQuarters[axis]) / 2, harmonic = eighth[axis] - center - (sine + cosine) * Math.SQRT1_2;
        return { axis, center, cosine, sine, harmonic };
      });
      let initialError = 0, nativeError = 0, peak = 0;
      for (let frame = 0; frame < buffer.length; frame++) {
        const expected = [0, 1, 4410].includes(frame) ? sampleSpatialPosition(settings, offset + frame / 44100, period) : undefined;
        coefficients.forEach(({ axis, center, sine, cosine, harmonic }, channel) => {
          const actual = channels[channel][frame];
          const native = center + sine * channels[3][frame] + cosine * channels[4][frame] + harmonic * channels[5][frame];
          nativeError = Math.max(nativeError, Math.abs(actual - native)); peak = Math.max(peak, Math.abs(actual));
          if (expected) initialError = Math.max(initialError, Math.abs(actual - expected[axis]));
        });
      }
      position.dispose(); centers.forEach((constant: ConstantSourceNode) => { constant.stop(); constant.disconnect(); }); merger.disconnect();
      references.forEach(oscillator => { oscillator.stop(); oscillator.disconnect(); });
      results.push({ motion, offset, initialError, nativeError, peak });
    }
    return results;
  });
  expect(results).toHaveLength(16);
  for (const result of results) {
    expect(result.initialError, JSON.stringify(result)).toBeLessThan(.0001);
    expect(result.nativeError, JSON.stringify(result)).toBeLessThan(.0001); expect(result.peak).toBeLessThan(1.71);
  }
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
    const spatial = await measure(), moving: { motion: string; audio: Awaited<ReturnType<typeof measure>> }[] = [];
    for (const motion of ['orbit', 'sweep', 'approach', 'rise', 'figure-eight', 'rear-to-front', 'quiet-return']) {
      session.asmr.layers[0].spatial.motion = motion;
      moving.push({ motion, audio: await measure() });
    }
    return { legacy, spatial, moving };
  });
  expect(result.legacy.energy[0]).toBeGreaterThan(.01); expect(result.legacy.energy[1]).toBe(0);
  expect(result.spatial.energy[1]).toBeGreaterThan(result.spatial.energy[0] * 1.2);
  expect(Math.min(...result.spatial.energy)).toBeGreaterThan(.0001); expect(result.spatial.peak).toBeLessThan(.7);
  expect(result.spatial.tail).toEqual([0, 0]); expect(result.spatial.channels).toBe(2); expect(result.spatial.bytes).toBe(44 + 88200 * 4);
  for (const { motion, audio } of result.moving) {
    expect(Math.min(...audio.energy), motion).toBeGreaterThan(.0001); expect(audio.peak, motion).toBeLessThan(.7);
    expect(audio.tail, motion).toEqual([0, 0]); expect(audio.channels).toBe(2); expect(audio.bytes).toBe(44 + 88200 * 4);
  }
});

for (const motion of ['orbit', 'sweep', 'approach', 'rise', 'figure-eight', 'rear-to-front']) test(`@live spatial ${motion} shares live pause, end and voice replacement ownership`, async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async motion => {
    const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
    const { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession();
    session.mode = 'asmr'; session.minutes = .035; session.master = .7; session.ambient = 'none';
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1,
      spatial: { azimuth: -90, elevation: 15, distance: .3, motion }, period: 2 }] };
    await engine.start(session);
    const context: AudioContext = engine.context, analyzer = context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
    const read = () => { const data = new Float32Array(2048); analyzer.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
    await waitForAudioTime(context, .55); const before = read();
    const first = engine.asmr.voices.get(session.asmr.layers[0].id);
    const oscillators = [first.position.sine, first.position.cosine, first.position.harmonic];
    await engine.pause(); const time = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 160)); const frozen = context.currentTime === time;
    session.asmr.layers[0].spatial.azimuth = 60; session.asmr.layers[0].spatial.elevation = -30; engine.update(session);
    const updatedSameVoice = first === engine.asmr.voices.get(session.asmr.layers[0].id);
    const retainedPhase = oscillators.every((oscillator: OscillatorNode, index: number) => oscillator ===
      [first.position.sine, first.position.cosine, first.position.harmonic][index]);
    await engine.resume(); await waitForAudioTime(context, context.currentTime + .15);
    delete session.asmr.layers[0].spatial; engine.update(session);
    const stereoVoice = engine.asmr.voices.get(session.asmr.layers[0].id), replaced = stereoVoice !== first;
    session.asmr.layers[0].spatial = { azimuth: 60, elevation: 0, distance: .5, motion: 'still' }; engine.update(session);
    const spatialReplaced = engine.asmr.voices.get(session.asmr.layers[0].id) !== stereoVoice;
    await waitForAudioTime(context, 2.3); const ended = read();
    session.asmr.layers[0].spatial.motion = 'orbit'; engine.update(session);
    await waitForAudioTime(context, context.currentTime + .2); const expired = read(), voices = engine.asmr.voices.size;
    await engine.stop();
    return { before, frozen, updatedSameVoice, retainedPhase, replaced, spatialReplaced, ended, expired, voices, stopped: !engine.playing };
  }, motion);
  expect(result.before).toBeGreaterThan(.0001); expect(result.frozen).toBe(true); expect(result.updatedSameVoice).toBe(true);
  expect(result.replaced).toBe(true); expect(result.spatialReplaced).toBe(true);
  expect(result.retainedPhase).toBe(true);
  expect(result.ended).toBe(0); expect(result.expired).toBe(0); expect(result.voices).toBe(0); expect(result.stopped).toBe(true);
});
