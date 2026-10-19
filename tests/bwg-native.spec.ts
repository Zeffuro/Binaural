import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const path = process.env.BWG_LIBRARY ?? '';

test('every original built-in imports losslessly and renders every segment', async ({ page }) => {
  test.skip(!existsSync(path), 'Optional local BWGen library; vendor presets are not distributed with this project.');
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { splitBwgLibrary } = await import('/src/import/bwg-library.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { parseSession } = await import('/src/model.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const { evaluateCurve } = await import('/src/audio/bwg-curves.ts');
    const entries = splitBwgLibrary(new Uint8Array(data));
    return entries.map(entry => {
      const session = parseSession(JSON.parse(JSON.stringify(importBwg(entry.data).session)));
      const preset = decodeBwg(session.bwg).preset;
      let curveChecks = 0, rendered = 0, offset = 0;
      for (const segment of preset.segments) {
        for (let index = 0; index < segment.curves.length; index++) {
          const positions = new Set([0, 10000]);
          for (let p = 0; p < segment.curves[index].points.length - 1; p++) {
            const first = segment.curves[index].points[p].position;
            const last = segment.curves[index].points[p + 1].position;
            for (let k = 0; k <= 20; k++) positions.add(first + Math.trunc((last - first) * k / 20));
          }
          for (const position of positions) {
            if (!Number.isFinite(evaluateCurve(segment, index, position))) throw new Error('Nonfinite curve');
            curveChecks++;
          }
        }
        for (const fraction of [0, 0.5, 0.999]) {
          const renderer = new BwgRenderer(preset, 48000);
          renderer.frames = Math.round((offset + segment.seconds * fraction) * 48000);
          const left = new Float32Array(1024), right = new Float32Array(1024);
          renderer.render(left, right);
          if (![...left, ...right].every(Number.isFinite)) throw new Error('Nonfinite audio');
          rendered++;
        }
        offset += segment.seconds * segment.repeats;
      }
      return { lossless: session.bwg.data === btoa(String.fromCharCode(...entry.data)), curveChecks, rendered, segments: preset.segments.length };
    });
  }, Array.from(readFileSync(path)));
  expect(result).toHaveLength(28);
  expect(result.every(row => row.lossless && row.curveChecks > 0 && row.rendered === row.segments * 3)).toBe(true);
  expect(result.reduce((total, row) => total + row.segments, 0)).toBe(30);
});
