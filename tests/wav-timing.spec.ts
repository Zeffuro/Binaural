import { expect, test } from '@playwright/test';

test('offset frequency phase integrates ramps, steps, duplicate points and the final held value', async ({ page }) => {
  await page.goto('/');
  const phases = await page.evaluate(async () => {
    const path = '/src/audio/automation.ts', { frequencyPhase } = await import(path);
    const points = [{ time: 0, value: 100.25, curve: 'step' }, { time: 2, value: 200.75, curve: 'linear' },
      { time: 4, value: 300.5, curve: 'step' }, { time: 4, value: 400.125, curve: 'step' },
      { time: 6, value: 600.375, curve: 'linear' }];
    return [0, 1, 2, 3, 4, 5, 6, 7].map(time => frequencyPhase(points, time));
  });
  [0, .375, 0, .75, .5, .6875, 0, .375].forEach((value, index) => expect(phases[index]).toBeCloseTo(value, 10));
});

test('ASMR seeks three-hour offsets with the playback rate accepted by the actual AudioParam', async ({ page }) => {
  await page.goto('/');
  const starts = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', statePath = '/src/asmr-state.ts';
    const { AsmrMixer } = await import(mixerPath), { makeAsmrLayer } = await import(statePath);
    const context = new OfflineAudioContext(2, 441, 44100), original = context.createBufferSource.bind(context);
    const starts: { when: number; seek: number; rate: number; duration: number }[] = [];
    context.createBufferSource = () => {
      const source = original(), start = source.start.bind(source);
      source.start = (when = 0, seek = 0, duration?: number) => {
        starts.push({ when, seek, rate: source.playbackRate.value, duration: source.buffer!.duration });
        start(when, seek, duration);
      };
      return source;
    };
    for (const offset of [0, 10800]) {
      const mixer = new AsmrMixer(context, context.destination, .01, offset);
      mixer.update({ level: .6, layers: [{ ...makeAsmrLayer('cupping'), rate: 1.3 }] }); mixer.dispose();
    }
    return starts;
  });
  expect(starts).toHaveLength(2); expect(starts[0].seek).toBe(0); expect(starts[1].when).toBe(0);
  const far = starts[1], expected = (10800 * far.rate) % far.duration, raw = (10800 * 1.3) % far.duration;
  expect(far.rate).not.toBe(1.3); expect(far.seek).toBeCloseTo(expected, 12);
  expect(Math.abs(far.seek - raw)).toBeGreaterThan(.0004);
});

for (const mode of ['static-tone', 'automated-tone', 'asmr-loop', 'asmr-sweep', 'asmr-wander', 'asmr-spatial']) {
  test(`stitched ${mode} PCM follows the monolithic render across a 30-second boundary`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const result = await page.evaluate(async mode => {
      const graphPath = '/src/audio/offline-tone.ts', mixerPath = '/src/audio/asmr-mixer.ts', statePath = '/src/asmr-state.ts';
      const { offlineTone } = await import(graphPath), { AsmrMixer } = await import(mixerPath), { makeAsmrLayer } = await import(statePath);
      const rate = 44100, duration = 34, boundary = 30, warmup = 3;
      const tone = { id: 'offset', name: 'Offset', left: 203.125, right: 219.375, route: 'binaural', level: .8 };
      const automation = {
        left: [{ time: 0, value: 203.125, curve: 'step' }, { time: 17.25, value: 217.375, curve: 'linear' },
          { time: 29.75, value: 197.625, curve: 'step' }, { time: 30.25, value: 233.875, curve: 'linear' },
          { time: 33, value: 209.125, curve: 'step' }],
        right: [{ time: 0, value: 219.375, curve: 'step' }, { time: 29.5, value: 231.125, curve: 'linear' },
          { time: 29.5, value: 211.875, curve: 'step' }, { time: 31, value: 224.625, curve: 'linear' }],
        leftLevel: [{ time: 0, value: .7, curve: 'step' }, { time: 29.75, value: .4, curve: 'linear' },
          { time: 30, value: .9, curve: 'step' }, { time: 32, value: .5, curve: 'linear' }],
        rightLevel: [{ time: 0, value: .5, curve: 'step' }, { time: 30, value: .8, curve: 'linear' },
          { time: 31.25, value: .3, curve: 'step' }],
      };
      const asmr = { ...makeAsmrLayer('cupping'), level: .8, rate: 1.25, period: 2.7,
        motion: mode === 'asmr-wander' ? 'wander' : mode === 'asmr-sweep' ? 'sweep' : 'still',
        pan: -.23, width: .8, tone: .6, pressure: .8, pressurePhase: 77,
        ...(mode === 'asmr-spatial' ? { spatial: { azimuth: 63, elevation: 25, distance: .4, motion: 'orbit' } } : {}),
      };
      const render = async (offset: number, seconds: number) => {
        const context = new OfflineAudioContext(2, Math.round(seconds * rate), rate);
        if (mode.endsWith('tone')) offlineTone(context,
          mode === 'automated-tone' ? { ...tone, automation } : tone, context.destination, 1, seconds, offset);
        else {
          const mixer = new AsmrMixer(context, context.destination, seconds, offset);
          mixer.update({ level: .7, layers: [asmr] });
        }
        const buffer = await context.startRendering();
        return [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
      };
      const mono = await render(0, duration), first = await render(0, boundary);
      const next = await render(boundary - warmup, duration - boundary + warmup);
      const stitched = first.map((channel, ear) => {
        const output = new Float32Array(duration * rate); output.set(channel);
        output.set(next[ear].subarray(warmup * rate), boundary * rate); return output;
      });
      const measure = (start: number, end: number) => {
        let error = 0, energy = 0, peak = 0;
        for (let ear = 0; ear < 2; ear++) for (let i = Math.round(start * rate); i < end * rate; i++) {
          const difference = stitched[ear][i] - mono[ear][i];
          error += difference ** 2; energy += mono[ear][i] ** 2; peak = Math.max(peak, Math.abs(difference));
        }
        return { relativeRms: Math.sqrt(error / Math.max(1e-20, energy)), peak, energy };
      };
      const spectrum = (channels: Float32Array[]) => [203.125, 219.375, 233.875].flatMap(hz => channels.map(channel => {
        let real = 0, imaginary = 0;
        for (let i = (boundary - .25) * rate; i < (boundary + .25) * rate; i++) {
          const frame = Math.round(i), angle = 2 * Math.PI * hz * frame / rate;
          real += channel[frame] * Math.cos(angle); imaginary += channel[frame] * Math.sin(angle);
        }
        return Math.hypot(real, imaginary) / (rate * .5);
      }));
      const actualSpectrum = spectrum(stitched), expectedSpectrum = spectrum(mono);
      return { boundary: measure(boundary - .05, boundary + .05), tail: measure(boundary, duration),
        finite: stitched.every(channel => channel.every(Number.isFinite)),
        spectralError: Math.max(...actualSpectrum.map((value, index) => Math.abs(value - expectedSpectrum[index]))),
        seamError: Math.max(...stitched.map((channel, ear) => Math.abs(
          (channel[boundary * rate] - channel[boundary * rate - 1]) - (mono[ear][boundary * rate] - mono[ear][boundary * rate - 1])))) };
    }, mode);
    expect(result.finite).toBe(true); expect(result.boundary.energy).toBeGreaterThan(1e-6);
    const tolerance = mode === 'asmr-spatial' ? .08 : .025;
    expect(result.boundary.relativeRms).toBeLessThan(tolerance); expect(result.tail.relativeRms).toBeLessThan(tolerance);
    expect(result.boundary.peak).toBeLessThan(.005); expect(result.seamError).toBeLessThan(.005);
    expect(result.spectralError).toBeLessThan(.0005);
  });
}
