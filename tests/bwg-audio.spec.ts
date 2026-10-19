import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

// Original synthetic programs exercise the same DSP path as imported files.
test('BWGen worklet renders centered stereo tones and the native volume curve', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { default: url } = await import('/src/audio/bwg-worklet.ts?worker&url');
    const context = new OfflineAudioContext(2, 48000, 48000);
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, 'bwg-sequence', { numberOfInputs: 0,
      outputChannelCount: [2], processorOptions: { preset: parseBwg(new Uint8Array(data)) } });
    node.connect(context.destination);
    const buffer = await context.startRendering();
    const amplitude = (channel: number, hz: number): number => {
      const samples = buffer.getChannelData(channel);
      let real = 0, imaginary = 0;
      for (let i = 0; i < samples.length; i++) {
        real += samples[i] * Math.cos(2 * Math.PI * hz * i / 48000);
        imaginary += samples[i] * Math.sin(2 * Math.PI * hz * i / 48000);
      }
      return Math.hypot(real, imaginary) * 2 / samples.length;
    };
    return [amplitude(0, 405), amplitude(1, 395), amplitude(0, 395), amplitude(1, 405)];
  }, makeBwgFixture());
  expect(result[0]).toBeCloseTo(0.03257, 3);
  expect(result[1]).toBeCloseTo(result[0], 4);
  expect(result[2]).toBeLessThan(0.0001);
  expect(result[3]).toBeLessThan(0.0001);
});

test('BWGen AM starts at its minimum and opposite phase swaps ear pulses', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const preset = parseBwg(new Uint8Array(data));
    const renderer = new BwgRenderer(preset, 48000);
    const left = new Float32Array(48000), right = new Float32Array(48000);
    renderer.render(left, right);
    const rms = (samples: Float32Array, time: number): number => {
      const start = Math.round(time * 48000);
      let sum = 0;
      for (let i = start; i < start + 480; i++) sum += samples[i] ** 2;
      return Math.sqrt(sum / 480);
    };
    return { left0: rms(left, 0), right0: rms(right, 0), leftHalf: rms(left, 0.245), rightHalf: rms(right, 0.245) };
  }, makeBwgFixture(undefined, {
    45: [{ value: 10000, position: 0 }, { value: 10000, position: 10000 }],
    49: [{ value: 18000, position: 0 }, { value: 18000, position: 10000 }],
  }));
  expect(result.left0).toBeLessThan(result.right0 / 20);
  expect(result.rightHalf).toBeLessThan(result.leftHalf / 20);
});

test('BWGen inside-head noise is inverse stereo and keeps evolving during a final hold', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const bytes = new Uint8Array(data);
    bytes[428] = 1;
    bytes[1760] = 1;
    const preset = parseBwg(bytes);
    const renderer = new BwgRenderer(preset, 48000);
    const left = new Float32Array(48000), right = new Float32Array(48000);
    const alive = renderer.render(left, right);
    let error = 0, power = 0, endPower = 0;
    for (let i = 0; i < left.length; i++) {
      error = Math.max(error, Math.abs(left[i] + right[i]));
      power += left[i] ** 2;
      if (i > 30000) endPower += left[i] ** 2;
    }
    bytes[1760] = 0;
    const finite = new BwgRenderer(parseBwg(bytes), 48000);
    const stopped = new Float32Array(48000);
    finite.render(stopped, new Float32Array(48000));
    return { alive, error, power, endPower, stopped: Math.max(...stopped.slice(30000)) };
  }, makeBwgFixture([{ voices: 1, length: 0.01, repeats: 1 }], {
    5: [{ value: 5000, position: 0 }, { value: 5000, position: 10000 }],
    6: [{ value: 5000, position: 0 }, { value: 5000, position: 10000 }],
    39: [{ value: 0, position: 0 }, { value: 0, position: 10000 }],
  }));
  expect(result.alive).toBe(true);
  expect(result.error).toBe(0);
  expect(result.power).toBeGreaterThan(1);
  expect(result.endPower).toBeGreaterThan(1);
  expect(result.stopped).toBe(0);
});

test('BWGen shaped waves and harmonic filters retain finite normalized output', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BwgWaveBank } = await import('/src/audio/bwg-wave.ts');
    const bank = new BwgWaveBank();
    const results = [];
    for (const wave of [32768000, 32768500, 32768870, 32769000]) {
      for (const filter of [0, 320, 2000]) {
        const samples = Float32Array.from({ length: 8192 }, (_, i) => bank.sample(i * Math.PI * 2 / 8192, wave, filter));
        const harmonic = (number: number): number => {
          let real = 0, imaginary = 0;
          samples.forEach((value, i) => { real += value * Math.cos(i * Math.PI * 2 * number / 8192); imaginary += value * Math.sin(i * Math.PI * 2 * number / 8192); });
          return 2 * Math.hypot(real, imaginary) / 8192;
        };
        results.push({ wave, filter, finite: samples.every(Number.isFinite), peak: Math.max(...samples.map(Math.abs)), first: harmonic(1), seventh: harmonic(7) });
      }
    }
    return results;
  });
  for (const row of result) {
    expect(row.finite).toBe(true);
    expect(row.peak).toBeCloseTo(1, 3);
  }
  const square = result.filter(row => row.wave === 32769000);
  expect(square[2].seventh).toBeGreaterThan(0.15);
  expect(square[1].seventh).toBeLessThan(square[2].seventh * 0.9);
});

test('BWGen preserves oscillator and modulation phase across repeats and freezes zero-period AM', async ({ page }) => {
  await page.goto('/');
  const envelopes = {
    36: [{ value: 11000, position: 0 }, { value: 11000, position: 10000 }],
    45: [{ value: 10000, position: 0 }, { value: 10000, position: 10000 }],
    47: [{ value: 700000, position: 0 }, { value: 700000, position: 10000 }],
  };
  const result = await page.evaluate(async inputs => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer, modulatedVolume } = await import('/src/audio/bwg-renderer.ts');
    const { bwgWave } = await import('/src/audio/bwg-wave.ts');
    const render = (data: number[]): Float32Array => {
      const renderer = new BwgRenderer(parseBwg(new Uint8Array(data)), 48000);
      const left = new Float32Array(115200);
      renderer.render(left, new Float32Array(115200));
      return left;
    };
    const repeated = render(inputs[0]), continuous = render(inputs[1]);
    let difference = 0;
    for (let i = 0; i < repeated.length; i++) difference = Math.max(difference, Math.abs(repeated[i] - continuous[i]));
    const zero = render(inputs[2]);
    const peak = Math.max(...zero.slice(0, 48000).map(Math.abs));
    return { difference, peak, minimum: modulatedVolume(5000, 10000, Math.PI * 1.5),
      boundaries: [bwgWave(0, 32769000), bwgWave(Math.PI, 32769000)] };
  }, [makeBwgFixture([{ voices: 1, length: 0.01, repeats: 4 }], envelopes),
    makeBwgFixture([{ voices: 1, length: 0.04, repeats: 1 }], envelopes),
    makeBwgFixture(undefined, { ...envelopes, 47: [{ value: 0, position: 0 }, { value: 0, position: 10000 }] })]);
  expect(result.difference).toBe(0);
  expect(result.peak).toBeLessThan(0.001);
  expect(result.minimum).toBe(39);
  expect(result.boundaries).toEqual([0, 0]);
});

test('BWGen noise smoothing matches independent native arithmetic reference values', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const renderer = new BwgRenderer(parseBwg(new Uint8Array(data)), 48000);
    const left = new Float32Array(8);
    renderer.render(left, new Float32Array(8));
    return Array.from(left, value => Math.round(value / 0.22 * 32768));
  }, makeBwgFixture(undefined, {
    5: [{ value: 10000, position: 0 }, { value: 10000, position: 10000 }],
    7: [{ value: 5000, position: 0 }, { value: 5000, position: 10000 }],
    39: [{ value: 0, position: 0 }, { value: 0, position: 10000 }],
  }));
  expect(result).toEqual([-32595, -16234, -2627, -17155, -2752, 2182, -6499, -16427]);
});
