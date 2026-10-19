import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

const envelope = (value: number) => [{ value, position: 0 }, { value, position: 10000 }];
const reference = (settings: Record<number, ReturnType<typeof envelope>> = {}) => makeBwgFixture(undefined, {
  0: envelope(10000), 1: envelope(10000), ...settings,
});

test('recorded backgrounds preserve stereo, continuous looping and signed whole-millisecond shift', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgBackground } = await import('/src/audio/bwg-background.ts');
    const { validateCurves } = await import('/src/audio/bwg-curves.ts');
    const outputs = [];
    for (const [shift, stereo] of [[100, false], [-100, false], [99, false], [0, true]]) {
      const preset = parseBwg(new Uint8Array(data));
      preset.segments[0].curves[4].points.forEach(point => { point.value = Number(shift); });
      validateCurves(preset);
      const left = Float32Array.from({ length: 32 }, (_, i) => i / 32);
      const channels = stereo ? [left, Float32Array.from(left, value => -value)] : [left];
      const source = new BwgBackground({ name: 'Original fixture', sample: { rate: 8000, channels }, interval: false }, 8000);
      const frames = Array.from({ length: 33 }, () => source.render(preset.segments[0], 0).map(value => value + 0));
      outputs.push({ first: frames[0], second: frames[1], repeat: frames[32] });
    }
    return outputs;
  }, reference({ 2: envelope(60000), 3: envelope(60000) }));
  expect(result).toEqual([
    { first: [0, 0.25], second: [1 / 32, 9 / 32], repeat: [0, 0.25] },
    { first: [0, 0.75], second: [1 / 32, 25 / 32], repeat: [0, 0.75] },
    { first: [0, 0], second: [1 / 32, 1 / 32], repeat: [0, 0] },
    { first: [0, 0], second: [1 / 32, -1 / 32], repeat: [0, 0] },
  ]);
});

test('interval backgrounds preserve independent gaps and native reset endpoints', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgBackground } = await import('/src/audio/bwg-background.ts');
    const preset = parseBwg(new Uint8Array(data));
    const source = new BwgBackground({ name: 'One-shot fixture', interval: true,
      sample: { rate: 4000, channels: [new Float32Array([1, 0.5, -0.5, -1])] } }, 4000);
    const frames = Array.from({ length: 83 }, () => source.render(preset.segments[0], 0).map(value => value + 0));
    return { start: frames.slice(0, 5), leftGap: frames.slice(4, 41).map(frame => frame[0]),
      leftReset: frames[41][0], rightGap: frames.slice(4, 80).map(frame => frame[1]), rightEndpoint: frames[80][1], rightReset: frames[81][1] };
  }, reference({ 2: envelope(1), 3: envelope(2) }));
  expect(result.start).toEqual([[1, 1], [0.5, 0.5], [-0.5, -0.5], [-1, -1], [0, 0]]);
  expect(result.leftGap.every(value => value === 0)).toBe(true);
  expect(result.leftReset).toBe(1);
  expect(result.rightGap.every(value => value === 0)).toBe(true);
  expect(result.rightEndpoint).toBe(1);
  expect(result.rightReset).toBe(1);
});

test('recorded background AM retains its initial phase, ear offset and zero-period hold', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgBackground } = await import('/src/audio/bwg-background.ts');
    const preset = parseBwg(new Uint8Array(data));
    const binding = { name: 'Constant fixture', interval: false, sample: { rate: 4000, channels: [new Float32Array([1, 1, 1, 1])] } };
    const source = new BwgBackground(binding, 4000);
    const frames = Array.from({ length: 201 }, () => source.render(preset.segments[0], 0).map(value => value + 0));
    const frozen = new BwgBackground(binding, 4000);
    return { first: frames[0], half: frames[200], held: Array.from({ length: 20 }, () => [...frozen.render(preset.segments[0], 10000)]) };
  }, reference({ 9: envelope(10000), 10: envelope(10000), 13: envelope(18000),
    11: [{ value: 100000, position: 0 }, { value: 0, position: 10000 }],
    12: [{ value: 100000, position: 0 }, { value: 0, position: 10000 }] }));
  expect(result.first[0]).toBeLessThan(0.005);
  expect(result.first[1]).toBe(1);
  expect(result.half[0]).toBe(1);
  expect(result.half[1]).toBeLessThan(0.005);
  expect(result.held.every(frame => frame[0] === result.first[0] && frame[1] === result.first[1])).toBe(true);
});

test('background tracking and nonlinear envelopes use the same parameter compiler as voices', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgBackground } = await import('/src/audio/bwg-background.ts');
    const { validateCurves } = await import('/src/audio/bwg-curves.ts');
    const preset = parseBwg(new Uint8Array(data));
    const right = preset.segments[0].curves[1];
    right.mode = 1; right.tracking = 0; right.trackingScale = 500; right.trackingMax = 100;
    validateCurves(preset);
    const source = new BwgBackground({ name: 'Fixture', interval: false,
      sample: { rate: 4000, channels: [new Float32Array([1, 1])] } }, 4000);
    return [0, 5000, 10000].map(position => source.render(preset.segments[0], position).map(value => value + 0));
  }, reference({ 0: [{ value: 0, position: 0, weight: 0 }, { value: 10000, position: 10000 }] }));
  expect(result[0]).toEqual([0, 0]);
  expect(result[1][0]).toBeLessThan(0.01);
  expect(result[1][1]).toBeLessThan(result[1][0]);
  expect(result[2]).toEqual([1, 0.1484375]);
});

test('background interval tracking uses the selected sound pack legal range', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { validateCurves, evaluateCurve } = await import('/src/audio/bwg-curves.ts');
    return ['Bgextra.dll', 'Bkgnd.dll'].map(file => {
      const bytes = new Uint8Array(data);
      bytes.set(new TextEncoder().encode(file), 1320);
      new DataView(bytes.buffer).setUint32(1316, 5, true);
      const preset = parseBwg(bytes), curve = preset.segments[0].curves[2];
      curve.mode = 1; curve.tracking = 0; curve.trackingScale = 10000; curve.trackingMax = 1000;
      validateCurves(preset);
      return evaluateCurve(preset.segments[0], 2, 0);
    });
  }, reference());
  expect(result).toEqual([10000, 60000]);
});
