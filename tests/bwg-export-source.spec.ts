import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

const point = (value: number, position = 0, weight = 10) => ({ value, position, weight });
const fixture = makeBwgFixture([{ voices: 1, length: 0.025, repeats: 2 }, { voices: 1, length: 0.02, repeats: 1 }], {
  0: [point(6500), point(2500, 10000, 17)],
  1: [point(4500), point(7000, 10000, 3)],
  2: [point(60), point(90, 10000)],
  3: [point(100), point(150, 10000)],
  4: [point(1700), point(500, 10000)],
  5: [point(3200), point(6000, 10000, 13)],
  6: [point(4100), point(2500, 10000, 8)],
  7: [point(3000), point(6000, 10000)],
  8: [point(6500), point(2500, 10000)],
  9: [point(7000), point(3000, 10000)],
  10: [point(4500), point(8500, 10000)],
  30: [point(6000), point(9000, 10000)],
  31: [point(7500), point(2500, 10000)],
  32: [point(120000), point(700000, 10000)],
  33: [point(300000), point(500000, 10000)],
  34: [point(7000), point(17000, 10000)],
  36: [point(11000), point(27000, 10000, 19)],
  37: [point(12000), point(65000, 10000, 4)],
  41: [point(32769000), point(32768500, 10000)],
  43: [point(700), point(2000, 10000)],
  45: [point(8000), point(1000, 10000)],
  47: [point(230000), point(450000, 10000)],
  49: [point(18000), point(0, 10000)],
});

test('BWGen worker chunks exactly preserve nonlinear sequences, noise, repeats, final hold and bound backgrounds', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const { BwgExportSource } = await import('/src/audio/bwg-export-source.ts');
    const rate = 8000;
    const results = [];
    for (const continues of [false, true]) for (const kind of ['none', 'continuous', 'interval']) {
      const preset = parseBwg(new Uint8Array(bytes));
      preset.settings[1760 - 398] = Number(continues);
      const background = kind === 'none' ? undefined : { interval: kind === 'interval', name: 'Original synthetic background',
        sample: { rate: 11025, channels: [Float32Array.from({ length: 2500 }, (_, i) => Math.sin(i * 0.04) * 0.4),
          Float32Array.from({ length: 2500 }, (_, i) => Math.cos(i * 0.09) * 0.25)] } };
      const renderer = new BwgRenderer(preset, rate, background);
      renderer.levels = [0.35];
      const expected = [new Float32Array(rate * 7), new Float32Array(rate * 7)];
      renderer.render(expected[0], expected[1]);
      const source = new BwgExportSource(preset, rate, [0.35], background);
      let difference = 0, finite = true;
      try {
        await source.ready;
        for (const [start, frames] of [[0, rate / 2], [rate / 2, rate / 2], [0, rate * 4],
          [rate, rate * 4], [rate * 2, rate * 4], [rate * 3, rate * 4]]) {
          const channels = await source.read(start, frames);
          for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < frames; frame++) {
            finite &&= Number.isFinite(channels[ear][frame]);
            difference = Math.max(difference, Math.abs(channels[ear][frame] - expected[ear][start + frame]));
          }
        }
      } finally { source.dispose(); }
      const tailPower = expected[0].subarray(rate * 5).reduce((sum, sample) => sum + sample * sample, 0);
      results.push({ continues, kind, difference, finite, tailPower,
        backgroundIntact: !background || background.sample.channels.every(channel => channel.byteLength > 0) });
    }
    return results;
  }, fixture);
  expect(result).toHaveLength(6);
  for (const row of result) {
    expect(row.difference, JSON.stringify(row)).toBe(0);
    expect(row.finite).toBe(true);
    expect(row.backgroundIntact).toBe(true);
    if (row.continues) expect(row.tailPower).toBeGreaterThan(0);
    else expect(row.tailPower).toBe(0);
  }
});

test('BWGen worker enforces sequential bounded ranges and one pending read without damaging its state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgExportSource, BWG_EXPORT_HISTORY_SECONDS, BWG_EXPORT_MAX_READ_SECONDS } = await import('/src/audio/bwg-export-source.ts');
    const source = new BwgExportSource(parseBwg(new Uint8Array(bytes)), 8000, [1]);
    const errors: string[] = [];
    try {
      const first = source.read(0, 32000);
      try { await source.read(0, 1); } catch (error) { errors.push((error as Error).message); }
      await first;
      for (const [start, frames] of [[0, 32000], [32001, 1], [32000, 0], [32000, 320001],
        [32000.5, 1], [32000, Number.NaN], [32000, 1.5], [8000, 23999], [3999, 32000]]) {
        try { await source.read(start, frames); } catch (error) { errors.push((error as Error).name); }
      }
      const next = await source.read(4000, 36000);
      const oddRate = 11025, odd = new BwgExportSource(parseBwg(new Uint8Array(bytes)), oddRate, [1]);
      let oddError = '', oddFrames = 0;
      try {
        await odd.read(0, oddRate * 4);
        const firstRetained = oddRate * 4 - Math.floor(oddRate * BWG_EXPORT_HISTORY_SECONDS);
        try { await odd.read(firstRetained - 1, oddRate * 4); } catch (error) { oddError = (error as Error).name; }
        oddFrames = (await odd.read(firstRetained, oddRate * 4))[0].length;
      } finally { odd.dispose(); }
      return { errors, frames: next[0].length, history: BWG_EXPORT_HISTORY_SECONDS, maximum: BWG_EXPORT_MAX_READ_SECONDS, oddError, oddFrames };
    } finally { source.dispose(); }
  }, fixture);
  expect(result.errors[0]).toContain('already in progress');
  expect(result.errors.slice(1)).toEqual(Array(9).fill('RangeError'));
  expect(result.frames).toBe(36000);
  expect(result.history).toBe(3.5);
  expect(result.maximum).toBe(40);
  expect(result.oddError).toBe('RangeError'); expect(result.oddFrames).toBe(44100);
});

test('BWGen worker retains exact PCM across the thirty-second WAV chunk boundary', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const { BwgExportSource } = await import('/src/audio/bwg-export-source.ts');
    const preset = parseBwg(new Uint8Array(bytes));
    preset.settings[1760 - 398] = 1;
    const rate = 4000;
    const direct = new BwgRenderer(preset, rate);
    const expected = [new Float32Array(rate * 60), new Float32Array(rate * 60)];
    direct.render(expected[0], expected[1]);
    const source = new BwgExportSource(preset, rate, [1]);
    let difference = 0;
    try {
      const first = await source.read(0, rate * 30);
      const second = await source.read(rate * 27, rate * 33);
      for (let ear = 0; ear < 2; ear++) {
        for (let i = 0; i < first[ear].length; i++) difference = Math.max(difference, Math.abs(first[ear][i] - expected[ear][i]));
        for (let i = 0; i < second[ear].length; i++) difference = Math.max(difference, Math.abs(second[ear][i] - expected[ear][rate * 27 + i]));
      }
      return difference;
    } finally { source.dispose(); }
  }, fixture);
  expect(result).toBe(0);
});

test('BWGen worker abort and dispose reject readiness, pending reads and later use while terminating each worker', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgExportSource } = await import('/src/audio/bwg-export-source.ts');
    const NativeWorker = window.Worker;
    let created = 0, terminated = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); created++; }
      terminate(): void { terminated++; super.terminate(); }
    };
    const names: string[] = [];
    const capture = async (pending: Promise<unknown>): Promise<void> => {
      try { await pending; names.push('resolved'); } catch (error) { names.push((error as Error).name); }
    };
    try {
      const preset = parseBwg(new Uint8Array(bytes));
      const preAborted = new AbortController();
      preAborted.abort();
      const before = new BwgExportSource(preset, 8000, [1], undefined, preAborted.signal);
      await capture(before.ready);
      await capture(before.read(0, 1));
      before.dispose();
      const waiting = new BwgExportSource(preset, 8000, [1]);
      waiting.dispose();
      await capture(waiting.ready);
      const controller = new AbortController();
      const active = new BwgExportSource(preset, 8000, [1], undefined, controller.signal);
      await active.ready;
      const pending = active.read(0, 320000);
      await Promise.resolve();
      controller.abort();
      await capture(pending);
      await capture(active.read(0, 1));
      active.dispose();
      return { names, created, terminated };
    } finally { window.Worker = NativeWorker; }
  }, fixture);
  expect(result.names).toEqual(Array(5).fill('AbortError'));
  expect(result.created).toBe(2);
  expect(result.terminated).toBe(2);
});

test('BWGen worker surfaces initialization and runtime worker errors and cleans up', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgExportSource } = await import('/src/audio/bwg-export-source.ts');
    const errors: string[] = [];
    const preset = parseBwg(new Uint8Array(bytes));
    const badCurve = structuredClone(preset);
    badCurve.segments[0].curves[0].points[0].value = Number.NaN;
    const malformedBackground = { name: 'Invalid clip', interval: false,
      sample: { rate: 8000, channels: [new Float32Array([Number.NaN])] } };
    const sources = [new BwgExportSource(preset, 0, [1]), new BwgExportSource(preset, 8000, [Number.NaN]),
      new BwgExportSource(badCurve, 8000, [1]), new BwgExportSource(preset, 8000, [1], malformedBackground)];
    for (const source of sources) {
      try { await source.ready; errors.push('resolved'); } catch (error) { errors.push((error as Error).message); }
      finally { source.dispose(); }
    }
    const NativeWorker = window.Worker;
    let terminated = 0;
    window.Worker = class extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: { type: string }): void {
        queueMicrotask(() => {
          if (message.type === 'init') this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } }));
          else this.onerror?.(new ErrorEvent('error', { message: 'Synthetic worker crash' }));
        });
      }
      terminate(): void { terminated++; }
    } as unknown as typeof Worker;
    try {
      const source = new BwgExportSource(preset, 8000, [1]);
      try { await source.read(0, 80); } catch (error) { errors.push((error as Error).message); }
      finally { source.dispose(); }
    } finally { window.Worker = NativeWorker; }
    return { errors, terminated };
  }, fixture);
  expect(result.errors[0]).toContain('settings');
  expect(result.errors[1]).toContain('settings');
  expect(result.errors[2]).toContain('synthesis');
  expect(result.errors[3]).toContain('background');
  expect(result.errors[4]).toBe('Synthetic worker crash');
  expect(result.terminated).toBe(1);
});
