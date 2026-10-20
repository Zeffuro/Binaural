import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { VideoRecording, VideoRecordingOptions } from '../src/video-recording';
import { makeBwgFixture } from './helpers/bwg';

interface Harness {
  create(changes?: Partial<VideoRecordingOptions>): Promise<VideoRecording>;
  emit(size?: number): void;
  error(): void;
  end(): void;
  hide(): void;
  time: number;
  state: 'playing' | 'paused' | 'stopped';
  pauseCalls: number;
  resumeCalls: number;
  draws: number;
  disposed: number;
  stoppedTracks: number;
  captures: number;
  starts: number[];
  badConstructor: boolean;
  badDraw: boolean;
  emptyAudio: boolean;
  unsupported: boolean;
  omitStop: boolean;
  stalledClock: boolean;
}
declare global { interface Window { videoHarness: Harness } }

async function mocks(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { recordVideo } = await import('/src/video-recording.ts');
    let last: Recorder;
    let hidden = false;
    const h: Harness = {
      time: 10, state: 'playing', pauseCalls: 0, resumeCalls: 0, draws: 0, disposed: 0, stoppedTracks: 0,
      captures: 0, starts: [], badConstructor: false, badDraw: false, emptyAudio: false, unsupported: false, omitStop: false, stalledClock: false,
      create: async changes => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const audio = new Stream(h.emptyAudio ? [] : [new Track('audio')]);
        let initialClock = true;
        const recording = recordVideo({ canvas, seconds: 10, fps: 30, draw: () => {
          h.draws++; if (h.badDraw) throw new Error('Drawing failed');
        }, audio: { stream: audio as unknown as MediaStream, time: () => {
          if (initialClock) { initialClock = false; return h.time - (h.stalledClock ? 0 : .01); }
          return h.time;
        }, state: () => h.state,
          dispose: () => { h.disposed++; audio.getTracks().forEach(track => track.stop()); } }, ...changes });
        await new Promise(resolve => setTimeout(resolve, 70));
        return recording;
      },
      emit: (size = 4) => {
        const data = new Blob([new Uint8Array(Math.min(size, 1024))]);
        if (size > 1024) {
          // Exercise size bounds without allocating GiB in CI.
          Object.defineProperty(data, 'size', { value: size });
          Object.defineProperty(data, 'arrayBuffer', { value: async () => new ArrayBuffer(1024) });
        }
        last.ondataavailable?.({ data } as BlobEvent);
      },
      error: () => last.onerror?.(new Event('error')),
      end: () => last.stream.getTracks()[0].dispatchEvent(new Event('ended')),
      hide: () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); },
    };
    class Track extends EventTarget {
      readyState = 'live';
      constructor(readonly kind: string) { super(); }
      stop() { if (this.readyState !== 'ended') { this.readyState = 'ended'; h.stoppedTracks++; } }
      clone() { return new Track(this.kind); }
    }
    class Stream {
      constructor(private tracks: Track[]) {}
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
    }
    class Recorder {
      static isTypeSupported() { return !h.unsupported; }
      state: RecordingState = 'inactive';
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: Stream, options: MediaRecorderOptions) {
        if (h.badConstructor) throw new Error('Constructor failed');
        this.mimeType = options.mimeType!; last = this;
      }
      start(slice: number) { h.starts.push(slice); this.state = 'recording'; }
      pause() { h.pauseCalls++; this.state = 'paused'; }
      resume() { h.resumeCalls++; this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        if (h.omitStop) return;
        queueMicrotask(() => { h.emit(); this.onstop?.(); });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
    Object.defineProperty(window, 'MediaStream', { configurable: true, value: Stream });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    HTMLCanvasElement.prototype.captureStream = () => { h.captures++; return new Stream([new Track('video')]) as unknown as MediaStream; };
    window.videoHarness = h;
  });
}

test('video follows the audio clock, pause/resume and duration with exactly owned cleanup', async ({ page }) => {
  await mocks(page);
  const result = await page.evaluate(async () => {
    const h = window.videoHarness, recording = await h.create({ seconds: 2 });
    h.emit(8); h.time += .7; h.state = 'paused';
    await new Promise(resolve => setTimeout(resolve, 80));
    const paused = h.pauseCalls; h.state = 'playing';
    await new Promise(resolve => setTimeout(resolve, 80));
    h.time += 1.3;
    const result = await recording.done;
    const draws = h.draws;
    await new Promise(resolve => setTimeout(resolve, 70));
    return { reason: result.reason, seconds: result.seconds, bytes: result.bytes, size: result.blob!.size,
      paused, resumed: h.resumeCalls, disposed: h.disposed, stopped: h.stoppedTracks, draws, after: h.draws, starts: h.starts };
  });
  expect(result).toMatchObject({ reason: 'duration', seconds: 2, bytes: 12, size: 12, paused: 1, resumed: 1,
    disposed: 1, stopped: 3, starts: [1000] });
  expect(result.after).toBe(result.draws);
});

test('video waits for the audio clock to advance and starts its duration at recorder startup', async ({ page }) => {
  await mocks(page);
  const result = await page.evaluate(async () => {
    const h = window.videoHarness;
    h.stalledClock = true;
    const progress: number[] = [];
    const recording = await h.create({ seconds: 2, onProgress: value => progress.push(value.seconds) });
    const waiting = { starts: h.starts.length, draws: h.draws, seconds: progress.at(-1) };
    h.time += .8;
    await new Promise(resolve => setTimeout(resolve, 70));
    const started = { starts: h.starts.slice(), seconds: progress.at(-1) };
    let finished = false;
    void recording.done.then(() => { finished = true; });
    h.time += 1.2;
    await new Promise(resolve => setTimeout(resolve, 70));
    const premature = finished;
    h.time += .81;
    const result = await recording.done;
    return { waiting, started, premature, seconds: result.seconds, reason: result.reason, disposed: h.disposed };
  });
  expect(result).toEqual({ waiting: { starts: 0, draws: 1, seconds: 0 },
    started: { starts: [1000], seconds: 0 }, premature: false, seconds: 2, reason: 'duration', disposed: 1 });
});

for (const route of ['cancel', 'signal', 'finish', 'audio-stop', 'hidden', 'track-ended', 'timeout', 'clock'] as const) {
  test(`video releases a pending audio startup on ${route}`, async ({ page }) => {
    await mocks(page);
    const result = await page.evaluate(async route => {
      const h = window.videoHarness, controller = new AbortController();
      h.stalledClock = true;
      const nativeTimeout = window.setTimeout.bind(window);
      if (route === 'timeout') Object.defineProperty(window, 'setTimeout', { configurable: true,
        value: (callback: () => void, delay: number) => nativeTimeout(callback, delay === 10000 ? 0 : delay) });
      let aborted = 0, closed = 0;
      const recording = await h.create({ signal: controller.signal, writer: {
        write: async () => {}, close: async () => { closed++; }, abort: async () => { aborted++; },
      } });
      if (route === 'cancel') recording.cancel();
      if (route === 'signal') controller.abort();
      if (route === 'finish') recording.finish();
      if (route === 'audio-stop') h.state = 'stopped';
      if (route === 'hidden') h.hide();
      if (route === 'track-ended') h.end();
      if (route === 'clock') Object.defineProperty(h, 'time', { configurable: true, get: () => NaN });
      let error = '';
      try { await recording.done; } catch (failure) { error = (failure as Error).message; }
      Object.defineProperty(h, 'time', { configurable: true, writable: true, value: 100 });
      await new Promise(resolve => setTimeout(resolve, 70));
      return { error, starts: h.starts.length, stopped: h.stoppedTracks, disposed: h.disposed, aborted, closed };
    }, route);
    expect(result).toMatchObject({ starts: 0, stopped: 3, disposed: 1, aborted: 1, closed: 0 });
    expect(result.error).toContain(route === 'timeout' ? 'clock did not start' : route === 'clock' ? 'clock is unavailable'
      : route === 'cancel' || route === 'signal' ? 'cancelled' : 'no video data');
  });
}

for (const trigger of ['finish', 'audio-stop', 'hidden', 'track-ended'] as const) {
  test(`video finalizes a playable partial result on ${trigger}`, async ({ page }) => {
    await mocks(page);
    const result = await page.evaluate(async trigger => {
      const h = window.videoHarness, recording = await h.create(); h.time += 1;
      if (trigger === 'finish') recording.finish();
      if (trigger === 'audio-stop') h.state = 'stopped';
      if (trigger === 'hidden') h.hide();
      if (trigger === 'track-ended') h.end();
      const result = await recording.done;
      recording.cancel(); recording.finish();
      return { reason: result.reason, bytes: result.bytes, disposed: h.disposed, stopped: h.stoppedTracks };
    }, trigger);
    expect(result).toEqual({ reason: { finish: 'finished', 'audio-stop': 'audio-stopped', hidden: 'hidden', 'track-ended': 'track-ended' }[trigger],
      bytes: 4, disposed: 1, stopped: 3 });
  });
}

test('video serializes file writes, drains them before commit and ignores cancellation after saving starts', async ({ page }) => {
  await mocks(page);
  const result = await page.evaluate(async () => {
    const h = window.videoHarness, calls: string[] = [], stages: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let recording!: VideoRecording;
    recording = await h.create({ writer: {
      write: async data => { calls.push(`write:${data.byteLength}`); if (calls.length === 1) await gate; },
      close: async () => { calls.push('close'); recording.cancel(); }, abort: async () => { calls.push('abort'); },
    }, onProgress: progress => { stages.push(progress.stage); } });
    h.emit(7); h.emit(9); recording.finish();
    await new Promise(resolve => setTimeout(resolve, 30));
    const blocked = calls.slice(); release();
    const result = await recording.done;
    return { blocked, calls, stages, blob: !!result.blob, bytes: result.bytes, disposed: h.disposed };
  });
  expect(result.blocked).toEqual(['write:7']);
  expect(result.calls).toEqual(['write:7', 'write:9', 'write:4', 'close']);
  expect(result.stages).toContain('saving');
  expect(result).toMatchObject({ blob: false, bytes: 20, disposed: 1 });
});

for (const route of ['cancel', 'signal', 'draw', 'recorder', 'write', 'close', 'backpressure'] as const) {
  test(`video ${route} failure aborts temporary output once and never commits a download`, async ({ page }) => {
    await mocks(page);
    const result = await page.evaluate(async route => {
      const h = window.videoHarness, calls: string[] = [], controller = new AbortController();
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const recording = await h.create({ signal: controller.signal, writer: {
        write: async () => { calls.push('write'); if (route === 'write') throw new Error('Write failed'); if (route === 'backpressure') await gate; },
        close: async () => { calls.push('close'); if (route === 'close') throw new Error('Close failed'); },
        abort: async () => { calls.push('abort'); },
      } });
      h.emit(8);
      if (route === 'cancel') recording.cancel();
      if (route === 'signal') controller.abort();
      if (route === 'draw') h.badDraw = true;
      if (route === 'recorder') h.error();
      if (route === 'close') recording.finish();
      if (route === 'backpressure') { h.emit(20 * 1024 * 1024); h.emit(20 * 1024 * 1024); release(); }
      let error = '', name = '';
      try { await recording.done; } catch (failure) { error = (failure as Error).message; name = (failure as Error).name; }
      recording.cancel(); recording.finish();
      return { calls, error, name, disposed: h.disposed, stopped: h.stoppedTracks };
    }, route);
    expect(result.error).not.toBe('');
    expect(result.calls.filter(call => call === 'abort')).toHaveLength(1);
    expect(result.calls.filter(call => call === 'close')).toHaveLength(route === 'close' ? 1 : 0);
    expect(result.disposed).toBe(1); expect(result.stopped).toBe(3);
    if (route === 'backpressure') expect(result.error).toContain('too slow');
    if (route === 'cancel' || route === 'signal') expect(result.name).toBe('AbortError');
  });
}

test('video rejects unsupported formats, invalid options, hidden starts and setup failures without capture permissions', async ({ page }) => {
  await mocks(page);
  const rows = await page.evaluate(async () => {
    const h = window.videoHarness, rows = [];
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => { throw new Error('Must not request capture permissions'); } });
    for (const route of ['duration', 'fps', 'format', 'unsupported', 'constructor', 'draw', 'tracks', 'paused', 'hidden']) {
      const before = h.disposed;
      h.unsupported = route === 'unsupported'; h.badConstructor = route === 'constructor'; h.badDraw = route === 'draw';
      h.emptyAudio = route === 'tracks'; h.state = route === 'paused' ? 'paused' : 'playing';
      if (route === 'hidden') h.hide();
      let aborts = 0, closes = 0;
      const recording = await h.create({ seconds: route === 'duration' ? 3601 : 1,
        fps: (route === 'fps' ? 60 : 24) as 24, mimeType: route === 'format' ? 'video/invalid' : undefined,
        writer: { write: async () => {}, close: async () => { closes++; }, abort: async () => { aborts++; } } });
      let error = ''; try { await recording.done; } catch (failure) { error = (failure as Error).message; }
      rows.push({ route, error, disposed: h.disposed - before, aborts, closes });
    }
    return rows;
  });
  expect(rows).toHaveLength(9);
  for (const row of rows) { expect(row.error, row.route).not.toBe(''); expect(row).toMatchObject({ disposed: 1, aborts: 1, closes: 0 }); }
});

test('video preserves a bounded final chunk at the soft limit and rejects a hard overflow', async ({ page }) => {
  await mocks(page);
  const result = await page.evaluate(async () => {
    const h = window.videoHarness;
    const { maxVideoDownloadBytes } = await import('/src/video-recording.ts');
    const partial = await h.create(); h.emit(maxVideoDownloadBytes - 32 * 1024 * 1024);
    const valid = await partial.done;
    const overflow = await h.create(); h.emit(maxVideoDownloadBytes + 1);
    let error = ''; try { await overflow.done; } catch (failure) { error = (failure as Error).message; }
    return { reason: valid.reason, bytes: valid.bytes, error, disposed: h.disposed };
  });
  expect(result.reason).toBe('size-limit'); expect(result.bytes).toBe(480 * 1024 * 1024 + 4);
  expect(result.error).toContain('size limit'); expect(result.disposed).toBe(2);
});

test('direct video output uses its two GiB cap with drained bounded writes and a final valid chunk', async ({ page }) => {
  await mocks(page);
  const result = await page.evaluate(async () => {
    const h = window.videoHarness; let writes = 0, closed = 0, aborted = 0;
    const recording = await h.create({ writer: { write: async () => { writes++; }, close: async () => { closed++; }, abort: async () => { aborted++; } } });
    for (let i = 0; i < 65; i++) { h.emit(31 * 1024 * 1024); await new Promise(resolve => setTimeout(resolve, 0)); }
    h.emit(1024 * 1024);
    const result = await recording.done;
    return { reason: result.reason, bytes: result.bytes, writes, closed, aborted, blob: !!result.blob };
  });
  expect(result).toEqual({ reason: 'size-limit', bytes: 2016 * 1024 * 1024 + 4, writes: 67, closed: 1, aborted: 0, blob: false });
});

for (const route of ['clock', 'missing-stop'] as const) {
  test(`video ${route} failure rejects cleanly and releases capture tracks`, async ({ page }) => {
    await mocks(page);
    const result = await page.evaluate(async route => {
      const h = window.videoHarness;
      const nativeTimeout = window.setTimeout.bind(window);
      if (route === 'missing-stop') {
        h.omitStop = true;
        Object.defineProperty(window, 'setTimeout', { configurable: true,
          value: (callback: () => void, delay: number) => nativeTimeout(callback, delay === 5000 ? 0 : delay) });
      }
      const recording = await h.create();
      if (route === 'clock') Object.defineProperty(h, 'time', { get: () => { throw new Error('Playback clock failed'); } });
      recording.finish();
      let error = ''; try { await recording.done; } catch (failure) { error = (failure as Error).message; }
      return { error, disposed: h.disposed, stopped: h.stoppedTracks };
    }, route);
    expect(result.error).toContain(route === 'clock' ? 'clock failed' : 'did not finish');
    expect(result).toMatchObject({ disposed: 1, stopped: 3 });
  });
}

test('audio capture taps are lazy stereo leases connected only after transport and release independently', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const engine = new AudioEngine(), nodes: { channelCount: number; channelCountMode: string; channelInterpretation: string }[] = [];
    let disconnected = 0, connected = 0, tracks = 0, closed = 0;
    const context = { currentTime: 4, state: 'running', close: async () => { closed++; },
      createMediaStreamDestination: () => {
        const node = { channelCount: 1, channelCountMode: 'max', channelInterpretation: 'discrete',
          disconnect: () => {}, stream: { getTracks: () => [{ stop: () => { tracks++; } }] } };
        nodes.push(node); return node;
      } };
    let rejected = false; try { engine.captureAudio(); } catch { rejected = true; }
    Object.assign(engine, { context, transport: { connect: () => { connected++; }, disconnect: (node: unknown) => {
      if (!nodes.includes(node as typeof nodes[number])) throw new Error('Disconnected the output graph'); disconnected++;
    } } });
    const before = nodes.length, first = engine.captureAudio(), second = engine.captureAudio();
    const initial = first.state(); Object.assign(engine, { stopping: true }); const duringStop = first.state();
    Object.assign(engine, { stopping: false }); context.state = 'suspended'; const paused = first.state();
    first.dispose(); first.dispose(); const other = second.state(); await engine.stop();
    return { rejected, before, nodes: nodes.map(node => [node.channelCount, node.channelCountMode, node.channelInterpretation]),
      initial, duringStop, paused, other, state: second.state(), time: first.time(), connected, disconnected, tracks, closed };
  });
  expect(result).toEqual({ rejected: true, before: 0, nodes: [[2, 'explicit', 'speakers'], [2, 'explicit', 'speakers']],
    initial: 'playing', duringStop: 'playing', paused: 'paused', other: 'paused', state: 'stopped', time: 4, connected: 2, disconnected: 2, tracks: 2, closed: 1 });
});

test('@live recorded canvas and stereo engine mix independently decode with changing frame pixels', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.locator('h1').click();
  const outputs = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { initialSession } = await import('/src/model.ts');
    const { recordVideo, supportedVideoFormats } = await import('/src/video-recording.ts');
    const engine = new AudioEngine(), session = initialSession();
    session.minutes = 0; session.ambient = 'none'; session.master = .35;
    session.layers = [{ ...session.layers[0], left: 440, right: 660, level: .8, route: 'binaural' }];
    await engine.start(session);
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360; const context = canvas.getContext('2d')!;
    try {
      const outputs = [];
      for (const format of supportedVideoFormats()) {
        const audio = engine.captureAudio(), origin = audio.time(), wallOrigin = performance.now();
        const colors: { color: string; audioSeconds: number; wallSeconds: number }[] = [];
        const recording = recordVideo({ canvas, audio, seconds: 2, fps: 24, mimeType: format.mimeType,
          draw: () => {
            const audioSeconds = audio.time() - origin, color = audioSeconds < .8 ? '#ff0000' : '#0000ff';
            if (colors.at(-1)?.color !== color) colors.push({ color, audioSeconds, wallSeconds: (performance.now() - wallOrigin) / 1000 });
            context.fillStyle = color; context.fillRect(0, 0, 640, 360);
          } });
        const result = await recording.done;
        outputs.push({ bytes: Array.from(new Uint8Array(await result.blob!.arrayBuffer())), extension: result.extension,
          mimeType: result.mimeType, requested: format.mimeType, seconds: result.seconds, reason: result.reason, playing: engine.playing,
          colors, wallSeconds: (performance.now() - wallOrigin) / 1000 });
      }
      return outputs;
    } finally { await engine.stop(); }
  });
  expect(outputs.length).toBeGreaterThan(0);
  for (const [index, output] of outputs.entries()) {
  expect(output.playing).toBe(true); expect(output.reason).toBe('duration'); expect(output.seconds).toBe(2);
  expect(output.mimeType).toContain(output.extension);
  const file = testInfo.outputPath(`capture-${index}.${output.extension}`); await writeFile(file, Buffer.from(output.bytes));
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_packets', '-of', 'json', file], { encoding: 'utf8' })) as {
    streams: { codec_type: string; codec_name: string; channels?: number; width?: number; height?: number; start_time: string }[];
    packets: { codec_type: string; pts_time: string; duration_time?: string }[] };
  const audioStart = Number(metadata.streams.find(stream => stream.codec_type === 'audio')?.start_time);
  const videoStart = Number(metadata.streams.find(stream => stream.codec_type === 'video')?.start_time);
  const timelineEnd = Math.max(...metadata.packets.map(packet => Number(packet.pts_time) + (Number(packet.duration_time) || 0)));
  console.log(JSON.stringify({ requested: output.requested, colors: output.colors, wallSeconds: output.wallSeconds,
    streams: metadata.streams, timelineEnd }));
  expect(Math.abs(audioStart - videoStart), `${output.requested} audio/video start alignment`).toBeLessThan(.25);
  expect(timelineEnd - Math.min(audioStart, videoStart), `${output.requested} container duration`).toBeLessThan(2.4);
  expect(metadata.streams.find(stream => stream.codec_type === 'audio')?.channels).toBe(2);
  expect(metadata.streams.find(stream => stream.codec_type === 'audio')?.codec_name).toBe(output.extension === 'mp4' ? 'aac' : 'opus');
  expect(metadata.streams.find(stream => stream.codec_type === 'video')).toMatchObject({ width: 640, height: 360 });
  expect(metadata.streams.find(stream => stream.codec_type === 'video')?.codec_name).toBe(output.requested.includes('vp9') ? 'vp9' : output.requested.includes('vp8') ? 'vp8' : 'h264');
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 });
  const duration = pcm.length / 8 / 48000; expect(duration).toBeGreaterThan(1.7); expect(duration).toBeLessThan(2.4);
  const level = (ear: number, hz: number) => {
    let re = 0, im = 0; const first = 48000 * .6, count = 48000 * .5;
    for (let frame = first; frame < first + count; frame++) {
      const value = pcm.readFloatLE(frame * 8 + ear * 4);
      re += value * Math.cos(2 * Math.PI * hz * frame / 48000); im += value * Math.sin(2 * Math.PI * hz * frame / 48000);
    }
    return Math.hypot(re, im) * 2 / count;
  };
  expect(level(0, 440)).toBeGreaterThan(.01); expect(level(1, 660)).toBeGreaterThan(.01);
  expect(level(0, 660)).toBeLessThan(level(0, 440) * .1); expect(level(1, 440)).toBeLessThan(level(1, 660) * .1);
  for (const [at, channel] of [['0.3', 0], ['1.3', 2]] as const) {
    // Decode from the start: MediaRecorder WebM chunks have no seek index.
    const frame = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', at, '-map', '0:v:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
    const location = `${output.requested} at ${at}s`;
    expect(frame.length, location).toBe(640 * 360 * 3); expect(frame[channel], location).toBeGreaterThan(220);
    expect(frame[channel === 0 ? 2 : 0], location).toBeLessThan(30);
  }
  }
});

test('@live recording includes native BWGen, stereo local music and ASMR with live bus edits', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/'); await page.locator('h1').click();
  const output = await page.evaluate(async bwg => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const { recordVideo } = await import('/src/video-recording.ts');
    const engine = new AudioEngine(), session = importBwg(new Uint8Array(bwg)).session;
    session.mode = 'mixed'; session.master = .2; session.musicLevel = .8; session.ambient = 'none';
    session.asmr = { level: .7, layers: [{ ...makeAsmrLayer('air'), level: .7, tone: 1, pan: 0, motion: 'still' }] };
    const frames = 4800, wave = new Uint8Array(44 + frames * 4), view = new DataView(wave.buffer);
    const text = (at: number, value: string) => wave.set(new TextEncoder().encode(value), at);
    text(0, 'RIFF'); view.setUint32(4, wave.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true);
    view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) for (let ear = 0; ear < 2; ear++) {
      view.setInt16(44 + i * 4 + ear * 2, Math.round(4000 * Math.sin(2 * Math.PI * (ear ? 700 : 430) * i / 48000)), true);
    }
    await engine.setMusic(new File([wave], 'local.wav', { type: 'audio/wav' }));
    await engine.start(session);
    const audio = engine.captureAudio(), origin = audio.time(), canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360; const context = canvas.getContext('2d')!;
    let edited = false;
    try {
      const recording = recordVideo({ canvas, audio, seconds: 2.8, fps: 30, draw: () => {
        context.fillStyle = '#246b45'; context.fillRect(0, 0, 640, 360);
        if (!edited && audio.time() - origin > 1.4) { edited = true; session.asmr!.level = 0; engine.update(session); }
      } });
      const result = await recording.done;
      return { bytes: Array.from(new Uint8Array(await result.blob!.arrayBuffer())), extension: result.extension,
        nativeHz: session.layers[0].left, edited, reason: result.reason };
    } finally { await engine.stop(); await engine.setMusic(); }
  }, makeBwgFixture());
  expect(output.reason).toBe('duration'); expect(output.edited).toBe(true);
  const file = testInfo.outputPath(`native-music-asmr.${output.extension}`); await writeFile(file, Buffer.from(output.bytes));
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 });
  const spectrum = (ear: number, hz: number, start = .7, span = .4) => {
    let re = 0, im = 0, weights = 0; const first = Math.round(start * 48000), count = Math.round(span * 48000);
    for (let i = 0; i < count; i++) {
      const weight = .5 - .5 * Math.cos(2 * Math.PI * i / (count - 1));
      const value = pcm.readFloatLE((first + i) * 8 + ear * 4) * weight; weights += weight;
      re += value * Math.cos(2 * Math.PI * hz * i / 48000); im += value * Math.sin(2 * Math.PI * hz * i / 48000);
    }
    return 2 * Math.hypot(re, im) / weights;
  };
  expect(spectrum(0, 430)).toBeGreaterThan(.002); expect(spectrum(1, 700)).toBeGreaterThan(.002);
  expect(spectrum(0, output.nativeHz)).toBeGreaterThan(.003);
  const band = (start: number) => Math.sqrt(Array.from({ length: 33 }, (_, i) => spectrum(0, 2000 + i * 125, start) ** 2).reduce((sum, value) => sum + value, 0));
  expect(band(.7)).toBeGreaterThan(band(2) * 2 + .00001);
});
