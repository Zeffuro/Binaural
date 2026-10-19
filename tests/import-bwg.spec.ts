import { expect, test } from '@playwright/test';
import { makeBwgFixture as fixture } from './helpers/bwg';

test('BWGen preserves a compact full program and validates portable JSON', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { importBwg } = await import('/src/import/bwg.ts');
    const { parseSession } = await import('/src/model.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const result = importBwg(new Uint8Array(data));
    const validated = parseSession(JSON.parse(JSON.stringify(result.session)));
    return { ...result, validated, segments: decodeBwg(validated.bwg).preset.segments };
  }, fixture([{ voices: 2, length: 1, repeats: 1000 }, { voices: 1, length: 0.5, repeats: 1 }]));
  expect(result.session.timelineDuration).toBe(60030);
  expect(result.session.layers).toHaveLength(2);
  expect(result.session.layers[0].left).toBe(405);
  expect(result.session.layers[0].right).toBe(395);
  expect(result.validated.bwg).toEqual(result.session.bwg);
  expect(result.segments.map(segment => segment.repeats)).toEqual([1000, 1]);
  expect(result.session.bwg.data.length).toBeLessThan(12000);
  expect(result.warnings.join(' ')).toContain('AudioStrobe');
});

test('BWGen parser rejects every truncation, trailing bytes, bad counts, text and node bounds', async ({ page }) => {
  await page.goto('/');
  const failures = await page.evaluate(async data => {
    const path = '/src/import/bwg-format.ts';
    const { parseBwg } = await import(path);
    const valid = new Uint8Array(data);
    const accepted = [];
    for (let length = 0; length < valid.length; length++) {
      try { parseBwg(valid.subarray(0, length)); accepted.push(`truncated ${length}`); } catch { /* Expected. */ }
    }
    const mutations: [string, (bytes: Uint8Array, view: DataView) => void][] = [
      ['format', (_bytes, view) => view.setUint32(128, 4, true)],
      ['creator', (_bytes, view) => view.setUint32(132, 0x030200, true)],
      ['record type', bytes => { bytes[140] = 1; }],
      ['segments', (_bytes, view) => view.setUint32(1312, 26, true)],
      ['voices', bytes => { bytes[416] = 11; }],
      ['repeats', (_bytes, view) => view.setUint32(424, 0, true)],
      ['name', bytes => bytes.fill(65, 141, 398)],
      ['point count', bytes => { bytes[1781] = 255; }],
      ['time', (_bytes, view) => view.setUint16(1781 + 28, 10001, true)],
      ['shape', bytes => { bytes[1781 + 30] = 21; }],
    ];
    for (const [label, mutate] of mutations) {
      const bytes = valid.slice();
      mutate(bytes, new DataView(bytes.buffer));
      try { parseBwg(bytes); accepted.push(label); } catch { /* Expected. */ }
    }
    const trailing = new Uint8Array(valid.length + 1);
    trailing.set(valid);
    new DataView(trailing.buffer).setUint32(136, trailing.length - 136, true);
    try { parseBwg(trailing); accepted.push('trailing'); } catch { /* Expected. */ }
    return accepted;
  }, fixture());
  expect(failures).toEqual([]);
});

test('BWGen accepts nonlinear sweeps, clipping and modulation while rejecting bad references', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { importBwg } = await import('/src/import/bwg.ts');
    const bytes = new Uint8Array(data);
    const view = new DataView(bytes.buffer);
    view.setInt32(1781 + 45 * 40 + 24, 10000, true);
    view.setInt32(1781 + 45 * 40 + 32, 10000, true);
    view.setInt32(1781 + 40 * 40 + 8, 500, true);
    view.setInt32(1781 + 40 * 40 + 16, 50, true);
    const session = importBwg(bytes).session;
    bytes[1781 + 37 * 40 + 1] = 1;
    view.setUint16(1781 + 37 * 40 + 2, 999, true);
    let rejected = false;
    try { importBwg(bytes); } catch { rejected = true; }
    return { session, rejected };
  }, fixture(undefined, { 36: [{ value: 10000, position: 0, weight: 3 }, { value: 6000, position: 10000 }] }));
  expect(result.session.bwg).toBeTruthy();
  expect(result.rejected).toBe(true);
});

test('BWGen separate-ear pitch bypasses the centered binaural offset', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { importBwg } = await import('/src/import/bwg.ts');
    const bytes = new Uint8Array(data);
    bytes[1781 + 37 * 40 + 21] = 2;
    bytes[1781 + 38 * 40 + 1] = 0;
    const view = new DataView(bytes.buffer);
    view.setInt32(1781 + 38 * 40 + 24, 70000, true);
    view.setInt32(1781 + 38 * 40 + 32, 70000, true);
    const layer = importBwg(bytes).session.layers[0];
    return { left: layer.left, right: layer.right };
  }, fixture());
  expect(result).toEqual({ left: 400, right: 700 });
});
