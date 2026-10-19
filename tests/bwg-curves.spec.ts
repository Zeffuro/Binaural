import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

test('BWGen playback uses all native sweep weights, integer knots and exact discontinuities', async ({ page }) => {
  const data = makeBwgFixture([{ voices: 1, length: 1, repeats: 1 }]);
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const format = '/src/import/bwg-format.ts', runtime = '/src/audio/bwg-curves.ts';
    const { parseBwg } = await import(format);
    const { evaluateCurve, validateCurves } = await import(runtime);
    const preset = parseBwg(new Uint8Array(data)), segment = preset.segments[0];
    const curve = segment.curves[36];
    curve.points[0].value = 0;
    curve.points[1].value = 10000;
    const weights = Array.from({ length: 21 }, (_, weight) => {
      curve.points[0].weight = weight;
      validateCurves(preset);
      return evaluateCurve(segment, 36, 5000);
    });
    curve.points = [
      { value: 0, position: 0, weight: 4, symmetric: 0, flags: 4 },
      { value: 10000, position: 979, weight: 10, symmetric: 0, flags: 10 },
      { value: 20000, position: 979, weight: 10, symmetric: 1, flags: 266 },
      { value: 30000, position: 10000, weight: 10, symmetric: 0, flags: 10 },
    ];
    validateCurves(preset);
    const irregular = [0, 48, 49, 489, 978, 979, 10000].map(time => evaluateCurve(segment, 36, time));
    const unsymmetric = evaluateCurve(segment, 36, 5000);
    curve.points.forEach(point => { point.symmetric = 1; });
    validateCurves({ ...parseBwg(new Uint8Array(data)), segments: [segment] });
    return { weights, irregular, symmetricUnchanged: unsymmetric === evaluateCurve(segment, 36, 5000) };
  }, data);
  expect(result.weights).toEqual([200, 300, 500, 700, 1100, 1600, 2200, 2800, 3600, 4300,
    5000, 5700, 6400, 7200, 7800, 8400, 8900, 9300, 9500, 9700, 9800]);
  expect(result.irregular).toEqual([0, 0, 0, 1100, 9938, 20000, 30000]);
  expect(result.symmetricUnchanged).toBe(true);
});

test('BWGen tracking converts and clips source nodes before sweeps, including negative and packed values', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const format = '/src/import/bwg-format.ts', runtime = '/src/audio/bwg-curves.ts';
    const { parseBwg } = await import(format);
    const { evaluateCurve, validateCurves } = await import(runtime);
    const preset = parseBwg(new Uint8Array(data)), segment = preset.segments[0];
    const evaluate = (index: number, position: number): number => {
      validateCurves(preset);
      return evaluateCurve(segment, index, position);
    };
    const source = segment.curves[36], target = segment.curves[37];
    source.points[0].value = 0; source.points[1].value = 10000;
    Object.assign(target, { mode: 1, tracking: 36, trackingScale: 1000, trackingConfig: 0,
      trackingMin: 0, trackingMax: 5 });
    const clippedNodes = [0, 5000, 10000].map(at => evaluate(37, at));
    source.points.forEach(point => { point.value = 10000; });
    Object.assign(target, { trackingScale: 500, trackingConfig: 2000, trackingMax: 20000 });
    const crossUnits = evaluate(37, 5000);
    Object.assign(target, { trackingScale: -1000, trackingConfig: 20000 });
    const negativeSlope = evaluate(37, 5000);
    const phase = segment.curves[49];
    Object.assign(phase, { mode: 1, tracking: 36, trackingScale: 1000, trackingConfig: 0,
      trackingMin: -360, trackingMax: 360 });
    source.points.forEach(point => { point.value = 5; });
    const positiveHalf = evaluate(49, 0);
    source.points.forEach(point => { point.value = -5; });
    const negativeHalf = evaluate(49, 0);
    const leftWave = segment.curves[41], rightWave = segment.curves[42];
    leftWave.points.forEach(point => { point.value = (765 << 16) | 321; });
    const packedIdentity = evaluate(42, 0);
    Object.assign(target, { tracking: 41, trackingScale: 1000, trackingConfig: 0 });
    const waveformSource = evaluate(37, 0);
    Object.assign(rightWave, { tracking: 36, trackingMin: 0, trackingMax: 100 });
    source.points.forEach(point => { point.value = 1500; });
    const waveformTarget = evaluate(42, 0);
    Object.assign(target, { tracking: 36, trackingMin: 100000, trackingMax: 200000 });
    const legalClamp = evaluate(37, 0);
    validateCurves(preset);
    return { clippedNodes, crossUnits, negativeSlope, positiveHalf, negativeHalf,
      packedIdentity, waveformSource, waveformTarget, legalClamp };
  }, makeBwgFixture());
  expect(result).toEqual({ clippedNodes: [0, 250, 500], crossUnits: 700, negativeSlope: 1000,
    positiveHalf: 1, negativeHalf: 0, packedIdentity: (765 << 16) | 321,
    waveformSource: 3210, waveformTarget: (500 << 16) | 15, legalClamp: 2000000 });
});

test('BWGen repeat timing remains compact and preserves the final segment endpoint', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const format = '/src/import/bwg-format.ts', runtime = '/src/audio/bwg-curves.ts';
    const { parseBwg } = await import(format);
    const { segmentAt, durationOf } = await import(runtime);
    const preset = parseBwg(new Uint8Array(data));
    return { duration: durationOf(preset), segments: preset.segments.length,
      positions: [-1, 0, 30, 60, 59999, 60000, 60015, 60030, 60060, 60061].map(time => {
        const { index, position, ended } = segmentAt(preset, time);
        return [index, position, ended];
      }) };
  }, makeBwgFixture([{ voices: 1, length: 1, repeats: 1000 }, { voices: 1, length: 0.5, repeats: 2 }]));
  expect(result.duration).toBe(60060);
  expect(result.segments).toBe(2);
  expect(result.positions).toEqual([[0, 0, false], [0, 0, false], [0, 5000, false], [0, 0, false],
    [0, 9833.333333333332, false], [1, 0, false], [1, 5000, false], [1, 0, false],
    [1, 10000, true], [1, 10000, true]]);
});

test('BWGen curve validation rejects invalid modes, ranges, tracking and recursion', async ({ page }) => {
  await page.goto('/');
  const accepted = await page.evaluate(async data => {
    const format = '/src/import/bwg-format.ts', runtime = '/src/audio/bwg-curves.ts';
    const { parseBwg } = await import(format);
    const { validateCurves, evaluateCurve } = await import(runtime);
    const mutations = [
      preset => { preset.segments[0].curves[37].mode = 2; },
      preset => { preset.segments[0].curves[37].channelMode = 3; },
      preset => { Object.assign(preset.segments[0].curves[37], { mode: 1, tracking: 999 }); },
      preset => { Object.assign(preset.segments[0].curves[37], { mode: 1, tracking: 38 }); },
      preset => { preset.segments[0].curves[37].trackingScale = NaN; },
      preset => { Object.assign(preset.segments[0].curves[37], { trackingMin: 2, trackingMax: 1 }); },
      preset => { preset.segments[0].curves[37].points[0].position = 1; },
      preset => { preset.segments[0].curves[37].points[0].weight = 21; },
      preset => { preset.segments[0].curves[37].points[0].value = 2000001; },
    ];
    const accepted: number[] = [];
    mutations.forEach((mutate, index) => {
      const preset = parseBwg(new Uint8Array(data)); mutate(preset);
      try { validateCurves(preset); accepted.push(index); } catch { /* Expected. */ }
    });
    const preset = parseBwg(new Uint8Array(data));
    Object.assign(preset.segments[0].curves[37], { mode: 1, tracking: 38 });
    try { evaluateCurve(preset.segments[0], 37, 5000); accepted.push(99); } catch { /* Expected. */ }
    return accepted;
  }, makeBwgFixture());
  expect(accepted).toEqual([]);
});
