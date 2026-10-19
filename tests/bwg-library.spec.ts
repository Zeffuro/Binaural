import { expect, test } from '@playwright/test';
import { makeBwgLibraryFixture } from './helpers/bwg-library';

test('BWGen libraries preserve every preset, repeated segment and raw synthesis field', async ({ page }) => {
  await page.goto('/');
  const parsed = await page.evaluate(async data => {
    const path = '/src/import/bwg-library.ts';
    const { parseBwgLibrary } = await import(path);
    return parseBwgLibrary(new Uint8Array(data));
  }, makeBwgLibraryFixture().bytes);
  expect(parsed.map(preset => preset.name)).toEqual(['Original sequence A', 'Original sequence B']);
  expect(parsed.map(preset => preset.segments.map(segment =>
    [segment.id, segment.seconds, segment.repeats, segment.voices, segment.curves.length])))
    .toEqual([[['A', 60, 1000, 1, 50]], [['A', 30, 2, 2, 64], ['B', 120, 3, 1, 50]]]);
  expect(parsed[0].settings).toHaveLength(1382);
  expect(parsed[0].settings[0]).toBe(13);
  expect(parsed[0].settings.at(-1)).toBe(27);
  expect(parsed[0].segments[0].settings).toHaveLength(36);
  expect(parsed[0].segments[0].curves[36].reserved).toEqual([71, 0]);
  expect(parsed[0].segments[0].curves[36].trackingConfig).toBe(-1500);
  expect(parsed[0].segments[0].curves[36].trackingScale).toBe(-500);
  expect(parsed[0].segments[0].curves[36].points[0]).toEqual({
    value: 3000, position: 0, flags: 2562, weight: 2, symmetric: 10,
  });
});

test('BWGen library record framing rejects every partial record and unsupported structure', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ bytes: data, boundaries }) => {
    const path = '/src/import/bwg-library.ts';
    const format = '/src/import/bwg-format.ts';
    const { parseBwgLibrary, splitBwgLibrary } = await import(path);
    const { parseBwg } = await import(format);
    const bytes = new Uint8Array(data);
    const unexpected: string[] = [];
    const rejects = (label: string, value: Uint8Array): void => {
      try { parseBwgLibrary(value); unexpected.push(label); } catch { /* Expected. */ }
    };
    for (let end = 0; end < bytes.length; end++) {
      if (!boundaries.includes(end)) rejects(`prefix ${end}`, bytes.subarray(0, end));
    }
    for (const boundary of boundaries) {
      if (parseBwgLibrary(bytes.subarray(0, boundary)).length !== 1) unexpected.push(`boundary ${boundary}`);
    }
    const mutations: [string, (value: Uint8Array, view: DataView) => void][] = [
      ['zero length', (_value, view) => view.setUint32(136, 0, true)],
      ['short record', (_value, view) => view.setUint32(136, 4, true)],
      ['oversized record', (_value, view) => view.setUint32(136, 0xffffffff, true)],
      ['unknown preset type', value => { value[140] = 2; }],
      ['unknown separator type', value => { value[boundaries[0] + 4] = 2; }],
      ['long separator', (_value, view) => view.setUint32(boundaries[0], 6, true)],
      ['revision', (_value, view) => view.setUint32(128, 4, true)],
      ['creator', (_value, view) => view.setUint32(132, 0x030200, true)],
      ['damaged signature', value => { value[49] = 0; }],
    ];
    for (const [label, mutate] of mutations) {
      const value = bytes.slice();
      mutate(value, new DataView(value.buffer));
      rejects(label, value);
    }
    const onlySeparator = new Uint8Array(141);
    onlySeparator.set(bytes.subarray(0, 136));
    onlySeparator.set([5, 0, 0, 0, 1], 136);
    rejects('no presets', onlySeparator);
    rejects('excessive input', new Uint8Array(8 * 1024 * 1024 + 1));
    try { parseBwg(bytes); unexpected.push('single-preset parser accepted library'); } catch { /* Expected. */ }
    const standalone = bytes.subarray(0, boundaries[0]);
    const padded = new Uint8Array(standalone.length + 10);
    padded.set(standalone, 5);
    const arrayBuffer = standalone.slice().buffer;
    const entries = splitBwgLibrary(bytes);
    const reconstructed = entries.every(({ preset, data }) => JSON.stringify(parseBwg(data)) === JSON.stringify(preset));
    const exact = entries[0].data.every((value, index) => value === bytes[index]) &&
      entries[1].data.every((value, index) => value === bytes[index < 136 ? index : boundaries[1] + index - 136]);
    bytes.fill(0);
    return { unexpected, counts: [parseBwgLibrary(arrayBuffer).length,
      parseBwgLibrary(padded.subarray(5, 5 + standalone.length)).length],
      reconstructed, exact, independent: entries.every(entry => entry.data[0] !== 0),
      equal: JSON.stringify(parseBwgLibrary(arrayBuffer)[0]) === JSON.stringify(parseBwg(arrayBuffer)) };
  }, makeBwgLibraryFixture());
  expect(result).toEqual({ unexpected: [], counts: [1, 1], equal: true, reconstructed: true, exact: true, independent: true });
});
