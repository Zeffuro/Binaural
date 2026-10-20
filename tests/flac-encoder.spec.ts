import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

test('FLAC independently decodes to the WAV PCM16 codes for mono, stereo, clipping and partial blocks', async ({ page, browserName }) => {
  await page.goto('/');
  const results = await page.evaluate(async browserName => {
    const { FlacExportSource } = await import('/src/audio/flac-export-source.ts');
    const { wavPcm } = await import('/src/audio/wav-encoding.ts');
    const context = new OfflineAudioContext(2, 1, 44100);
    const rows = [];
    const edges = [-2, -1, -.99999, -.5, -1 / 65536, 0, 1 / 65536, .5, .99999, 1, 2];
    for (const kind of ['mono', 'stereo', 'silence']) for (const frames of [1, 4095, 4097, 44101]) {
      const left = Float32Array.from({ length: frames }, (_, i) => kind === 'silence' ? 0 :
        i < edges.length ? edges[i] : Math.sin(i * .097) * .6);
      const right = kind === 'stereo' ? Float32Array.from({ length: frames }, (_, i) =>
        i < edges.length ? edges[edges.length - i - 1] : Math.cos(i * .173) * .4) : left.slice();
      const original = [left.slice(), right.slice()];
      const expected = new DataView(wavPcm(left, right));
      const encoder = new FlacExportSource(frames);
      try {
        await encoder.readyPromise;
        const pieces: ArrayBuffer[] = [];
        for (let start = 0; start < frames; start += 997) {
          pieces.push(await encoder.encode(left.subarray(start, start + 997), right.subarray(start, start + 997)));
        }
        const final = await encoder.finish();
        pieces.push(final.data);
        const encoded = new Uint8Array(await new Blob(pieces).arrayBuffer());
        const beforeHeader = encoded.slice(0, 42);
        encoded.set(new Uint8Array(final.header));
        const decoded = await context.decodeAudioData(encoded.buffer.slice(0));
        let difference = 0;
        for (let ear = 0; ear < 2; ear++) {
          const actual = decoded.getChannelData(ear);
          for (let i = 0; i < frames; i++) {
            const code = expected.getInt16(i * 4 + ear * 2, true);
            // Chromium's native FLAC decoder scales positive PCM16 by 32767.
            const divisor = browserName === 'chromium' && code > 0 ? 32767 : 32768;
            const expectedFloat = browserName === 'chromium' ? Math.fround(code * Math.fround(1 / divisor)) : code / divisor;
            difference = Math.max(difference, Math.abs(actual[i] - expectedFloat));
          }
        }
        rows.push({ kind, frames, channels: decoded.numberOfChannels, decodedFrames: decoded.length,
          rate: decoded.sampleRate, difference, bytes: encoded.length,
          finalMd5: Array.from(new Uint8Array(final.header).subarray(26)),
          pcm: btoa(Array.from(new Uint8Array(expected.buffer), value => String.fromCharCode(value)).join('')),
          headerChanged: beforeHeader.some((value, i) => value !== encoded[i]),
          intact: left.every((value, i) => value === original[0][i]) && right.every((value, i) => value === original[1][i]) });
      } finally { encoder.dispose(); }
    }
    return rows;
  }, browserName);
  expect(results).toHaveLength(12);
  for (const row of results) {
    expect(row.channels, JSON.stringify(row)).toBe(2);
    expect(row.decodedFrames).toBe(row.frames);
    expect(row.rate).toBe(44100);
    expect(row.difference).toBe(0);
    expect(row.intact).toBe(true);
    expect(Buffer.from(row.finalMd5).toString('hex')).toBe(createHash('md5').update(Buffer.from(row.pcm, 'base64')).digest('hex'));
    expect(row.headerChanged).toBe(true);
    if (row.kind === 'silence' && row.frames > 4096) expect(row.bytes).toBeLessThan(row.frames * 4 / 10);
  }
});

test('FLAC preserves a full thirty-second chunk and one final frame with bounded writes and compression', async ({ page, browserName }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { FlacExportSource, FLAC_MAX_CHUNK_FRAMES } = await import('/src/audio/flac-export-source.ts');
    const encoder = new FlacExportSource(FLAC_MAX_CHUNK_FRAMES + 1);
    const left = new Float32Array(FLAC_MAX_CHUNK_FRAMES), right = left.slice();
    left[left.length - 1] = -.75;
    right[right.length - 1] = .5;
    try {
      const first = await encoder.encode(left, right);
      const last = await encoder.encode(new Float32Array([1]), new Float32Array([-1]));
      const final = await encoder.finish();
      const bytes = new Uint8Array(await new Blob([first, last, final.data]).arrayBuffer());
      bytes.set(new Uint8Array(final.header));
      const context = new OfflineAudioContext(2, 1, 44100);
      const decoded = await context.decodeAudioData(bytes.buffer);
      return { length: decoded.length, bytes: bytes.length, largestWrite: Math.max(first.byteLength, last.byteLength, final.data.byteLength),
        tail: [Array.from(decoded.getChannelData(0).slice(-2)), Array.from(decoded.getChannelData(1).slice(-2))],
        intact: left.byteLength === FLAC_MAX_CHUNK_FRAMES * 4 && left[left.length - 1] === -.75 };
    } finally { encoder.dispose(); }
  });
  expect(result.length).toBe(30 * 44100 + 1);
  expect(result.bytes).toBeLessThan(result.length * 4 / 100);
  expect(result.largestWrite).toBeLessThan(30 * 44100 * 4);
  const positiveScale = browserName === 'chromium' ? 32767 : 32768;
  expect(result.tail).toEqual([[-.75, Math.fround(32767 * Math.fround(1 / positiveScale))],
    [Math.fround(16384 * Math.fround(1 / positiveScale)), -1]]);
  expect(result.intact).toBe(true);
});

test('FLAC validates finite bounded stereo input, exact totals and one in-flight operation without losing state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { FlacExportSource, FLAC_MAX_CHUNK_FRAMES } = await import('/src/audio/flac-export-source.ts');
    const errors: string[] = [];
    const capture = async (promise: Promise<unknown>): Promise<void> => {
      try { await promise; errors.push('resolved'); } catch (error) { errors.push((error as Error).message); }
    };
    for (const total of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 44100 * 10800 + 1]) {
      const invalid = new FlacExportSource(total);
      await capture(invalid.ready);
      invalid.dispose();
    }
    const source = new FlacExportSource(3);
    try {
      await capture(source.finish());
      await capture(source.encode(new Float32Array(), new Float32Array()));
      await capture(source.encode(new Float32Array(2), new Float32Array(1)));
      await capture(source.encode(new Float32Array(FLAC_MAX_CHUNK_FRAMES + 1), new Float32Array(FLAC_MAX_CHUNK_FRAMES + 1)));
      await capture(source.encode(new Float32Array([Number.NaN]), new Float32Array(1)));
      await capture(source.encode(new Float32Array(1), new Float32Array([Number.NEGATIVE_INFINITY])));
      const first = source.encode(new Float32Array(2), new Float32Array(2));
      await capture(source.encode(new Float32Array(1), new Float32Array(1)));
      await capture(source.finish());
      await first;
      await capture(source.encode(new Float32Array(2), new Float32Array(2)));
      await source.encode(new Float32Array(1), new Float32Array(1));
      const final = await source.finish();
      await capture(source.encode(new Float32Array(1), new Float32Array(1)));
      await capture(source.finish());
      return { errors, headerBytes: final.header.byteLength };
    } finally { source.dispose(); }
  });
  expect(result.errors).toHaveLength(17);
  expect(result.errors.slice(0, 6)).toEqual(Array(6).fill('Invalid FLAC export frame count.'));
  expect(result.errors.slice(6, 10)).toEqual(['The FLAC export frame count is incomplete.',
    'Invalid FLAC audio section.', 'Invalid FLAC audio section.', 'Invalid FLAC audio section.']);
  expect(result.errors.slice(10, 12)).toEqual(Array(2).fill('The audio renderer produced invalid samples.'));
  expect(result.errors.slice(12, 14)).toEqual(Array(2).fill('A FLAC export request is already in progress.'));
  expect(result.errors[14]).toBe('Invalid FLAC audio section.');
  expect(result.errors.slice(15)).toEqual(Array(2).fill('The FLAC export is already finished.'));
  expect(result.headerBytes).toBe(42);
});

test('FLAC abort and dispose reject readiness and pending work and terminate each owned worker once', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { FlacExportSource } = await import('/src/audio/flac-export-source.ts');
    const NativeWorker = window.Worker;
    let created = 0, terminated = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); created++; }
      terminate(): void { terminated++; super.terminate(); }
    };
    const names: string[] = [];
    const capture = async (promise: Promise<unknown>): Promise<void> => {
      try { await promise; names.push('resolved'); } catch (error) { names.push((error as Error).name); }
    };
    try {
      const preAborted = new AbortController();
      preAborted.abort();
      const before = new FlacExportSource(1, preAborted.signal);
      await capture(before.ready);
      await capture(before.encode(new Float32Array(1), new Float32Array(1)));
      before.dispose();
      const waiting = new FlacExportSource(1);
      waiting.dispose();
      await capture(waiting.ready);
      const controller = new AbortController();
      const active = new FlacExportSource(30 * 44100, controller.signal);
      await active.ready;
      const pending = active.encode(new Float32Array(30 * 44100), new Float32Array(30 * 44100));
      await Promise.resolve();
      controller.abort();
      await capture(pending);
      await capture(active.finish());
      active.dispose();
      return { names, created, terminated };
    } finally { window.Worker = NativeWorker; }
  });
  expect(result.names).toEqual(Array(5).fill('AbortError'));
  expect(result.created).toBe(2);
  expect(result.terminated).toBe(2);
});

test('FLAC surfaces initialization, worker crash, unreadable and malformed response errors with cleanup', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { FlacExportSource } = await import('/src/audio/flac-export-source.ts');
    const NativeWorker = window.Worker;
    const errors: string[] = [];
    let terminated = 0, mode = '';
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage(message: { type: string; id?: number }): void {
        queueMicrotask(() => {
          if (message.type === 'init') this.onmessage?.(new MessageEvent('message', {
            data: mode === 'init' ? { type: 'error', message: 'Synthetic initialization failure' } : { type: 'ready' } }));
          else if (mode === 'crash') this.onerror?.(new ErrorEvent('error', { message: 'Synthetic worker crash' }));
          else if (mode === 'unreadable') this.onmessageerror?.();
          else this.onmessage?.(new MessageEvent('message', { data: { type: 'encoded', id: message.id! + 1, data: new ArrayBuffer(0) } }));
        });
      }
      terminate(): void { terminated++; }
    } as unknown as typeof Worker;
    try {
      for (mode of ['init', 'crash', 'unreadable', 'malformed']) {
        const source = new FlacExportSource(1);
        try { await source.encode(new Float32Array(1), new Float32Array(1)); errors.push('resolved'); }
        catch (error) { errors.push((error as Error).message); }
        finally { source.dispose(); }
      }
      return { errors, terminated };
    } finally { window.Worker = NativeWorker; }
  });
  expect(result.errors).toEqual(['Synthetic initialization failure', 'Synthetic worker crash',
    'The FLAC export worker returned unreadable audio.', 'The FLAC export worker returned invalid data.']);
  expect(result.terminated).toBe(4);
});

test('FLAC bounds an encoder import that never becomes ready', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const { FlacExportSource } = await import('/src/audio/flac-export-source.ts');
    const NativeWorker = window.Worker;
    window.Worker = class { postMessage(): void {} terminate(): void {} } as unknown as typeof Worker;
    try {
      const source = new FlacExportSource(1);
      (window as unknown as { flacTimeout: Promise<string> }).flacTimeout = source.ready.then(() => 'resolved', (error: Error) => error.message)
        .finally(() => source.dispose());
    } finally { window.Worker = NativeWorker; }
  });
  await page.clock.fastForward(20001);
  const message = await page.evaluate(() => (window as unknown as { flacTimeout: Promise<string> }).flacTimeout);
  expect(message).toBe('The FLAC encoder took too long to initialize.');
});
