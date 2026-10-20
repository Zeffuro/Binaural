import { expect, test } from '@playwright/test';

function stereoWave(): number[] {
  const frames = 4410, bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) {
    view.setInt16(44 + frame * 4 + channel * 2, Math.round(8000 * Math.sin(2 * Math.PI * (channel ? 880 : 440) * frame / 44100)), true);
  }
  return Array.from(bytes);
}

test('selected music owns its file and URL across replacement, stale loads, removal and failures', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/engine.ts', { AudioEngine } = await import(path);
    const originalAudio = window.Audio, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const media: Probe[] = [], created: string[] = [], revoked: string[] = [];
    class Probe {
      onloadeddata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      preload = ''; src = '';
      constructor() { media.push(this); }
      removeAttribute() { this.src = ''; }
      load() {}
      pause() {}
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: Probe });
    URL.createObjectURL = () => { const url = `blob:music-test-${created.length}`; created.push(url); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); };
    const engine = new AudioEngine(), files = Array.from({ length: 8 }, (_, i) => new File(['music'], `${i}.wav`));
    const accepted: boolean[] = [];
    try {
      const first = engine.setMusic(files[0]); accepted.push(engine.selectedMusicFile === undefined);
      media.at(-1)!.onloadeddata!(); await first; accepted.push(engine.selectedMusicFile === files[0]);
      const slow = engine.setMusic(files[1]), oldProbe = media.at(-1)!;
      accepted.push(engine.selectedMusicFile === undefined);
      const latest = engine.setMusic(files[2]); media.at(-1)!.onloadeddata!(); await latest;
      oldProbe.onloadeddata!(); await slow; accepted.push(engine.selectedMusicFile === files[2]);
      const failing = engine.setMusic(files[3]), failedProbe = media.at(-1)!;
      const good = engine.setMusic(files[4]); media.at(-1)!.onloadeddata!(); await good;
      failedProbe.onerror!(); await failing; accepted.push(engine.selectedMusicFile === files[4]);
      const removed = engine.setMusic(files[5]), removedProbe = media.at(-1)!;
      await engine.setMusic(); removedProbe.onloadeddata!(); await removed;
      accepted.push(engine.selectedMusicFile === undefined);
      const rejected = engine.setMusic(files[6]).then(() => '', (error: Error) => error.message);
      media.at(-1)!.onerror!(); const failure = await rejected;
      accepted.push(engine.selectedMusicFile === undefined);
      const final = engine.setMusic(files[7]); media.at(-1)!.onloadeddata!(); await final;
      engine.context = { state: 'suspended', close: async () => {} };
      await engine.stop(); accepted.push(engine.selectedMusicFile === files[7]);
      await engine.setMusic(); accepted.push(engine.selectedMusicFile === undefined);
      return { accepted, failure, created: created.length, revoked: revoked.length, unique: new Set(revoked).size };
    } finally {
      await engine.setMusic(); Object.defineProperty(window, 'Audio', { configurable: true, value: originalAudio });
      URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    }
  });
  expect(result.accepted.every(Boolean)).toBe(true);
  expect(result.failure).toContain('unsupported');
  expect(result.created).toBe(8); expect(result.revoked).toBe(8); expect(result.unique).toBe(8);
});

test('selected local music survives actual playback stop and restart @live', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async wave => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
    const engine = new AudioEngine(), file = new File([new Uint8Array(wave)], 'local.wav', { type: 'audio/wav' });
    try {
      await engine.setMusic(file); const loaded = engine.selectedMusicFile === file;
      await engine.start(initialSession()); const first = engine.playing && engine.selectedMusicFile === file;
      await engine.stop(); const stopped = engine.selectedMusicFile === file;
      await engine.start(initialSession()); const restarted = engine.playing && engine.selectedMusicFile === file;
      await engine.setMusic(); return { loaded, first, stopped, restarted, removed: engine.selectedMusicFile === undefined };
    } finally { await engine.stop(); await engine.setMusic(); }
  }, stereoWave());
  expect(result).toEqual({ loaded: true, first: true, stopped: true, restarted: true, removed: true });
});

test('late playback rejections cannot clear replacement music or the file retained by stop', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/engine.ts', { AudioEngine } = await import(path), originalAudio = window.Audio;
    const elements: Media[] = [];
    class Media {
      onloadeddata: (() => void) | null = null;
      onerror: (() => void) | null = null;
      preload = ''; src = ''; loop = false;
      reject!: (error: Error) => void;
      resolve!: () => void;
      constructor() { elements.push(this); }
      removeAttribute() { this.src = ''; }
      load() {}
      pause() {}
      play() { return new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: Media });
    const engine = new AudioEngine(), first = new File(['first'], 'first.wav'), second = new File(['second'], 'second.wav');
    const context = { state: 'suspended', close: async () => {}, createMediaElementSource: () => ({ connect() {} }) };
    engine.context = context; engine.musicGain = {};
    try {
      const stale = engine.setMusic(first); elements.at(-1)!.onloadeddata!(); await Promise.resolve();
      const oldMusic = elements.at(-1)!;
      const latest = engine.setMusic(second); elements.at(-1)!.onloadeddata!(); await Promise.resolve();
      elements.at(-1)!.resolve(); await latest; oldMusic.reject(new Error('old play failed')); await stale;
      const replacement = engine.selectedMusicFile === second;
      const stopping = engine.setMusic(first); elements.at(-1)!.onloadeddata!(); await Promise.resolve();
      const stoppedMusic = elements.at(-1)!; await engine.stop();
      stoppedMusic.reject(new Error('play interrupted by stop')); await stopping;
      const retained = engine.selectedMusicFile === first;
      engine.context = context; engine.musicGain = {};
      const failing = engine.setMusic(second).then(() => '', (error: Error) => error.message);
      elements.at(-1)!.onloadeddata!(); await Promise.resolve(); elements.at(-1)!.reject(new Error('current play failed'));
      const error = await failing;
      return { replacement, retained, error, cleared: engine.selectedMusicFile === undefined };
    } finally { await engine.stop(); await engine.setMusic(); Object.defineProperty(window, 'Audio', { configurable: true, value: originalAudio }); }
  });
  expect(result).toEqual({ replacement: true, retained: true, error: 'current play failed', cleared: true });
});

test('export decoder preserves actual stereo PCM using one offline decode and no playback context', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async wave => {
    const path = '/src/audio/music-export.ts', { decodeMusicForExport } = await import(path);
    const original = OfflineAudioContext.prototype.decodeAudioData, live = window.AudioContext;
    let calls = 0;
    OfflineAudioContext.prototype.decodeAudioData = function(bytes) { calls++; return original.call(this, bytes); };
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { throw new Error('Live context forbidden'); } } });
    try {
      const buffer: AudioBuffer = await decodeMusicForExport(new File([new Uint8Array(wave)], 'stereo.wav'));
      const amplitude = (channel: number, hz: number) => {
        const data = buffer.getChannelData(channel); let re = 0, im = 0;
        for (let i = 0; i < data.length; i++) { re += data[i] * Math.cos(2 * Math.PI * hz * i / 44100); im += data[i] * Math.sin(2 * Math.PI * hz * i / 44100); }
        return 2 * Math.hypot(re, im) / data.length;
      };
      return { calls, channels: buffer.numberOfChannels, frames: buffer.length, rate: buffer.sampleRate,
        levels: [amplitude(0, 440), amplitude(0, 880), amplitude(1, 440), amplitude(1, 880)] };
    } finally { OfflineAudioContext.prototype.decodeAudioData = original; Object.defineProperty(window, 'AudioContext', { configurable: true, value: live }); }
  }, stereoWave());
  expect(result).toMatchObject({ calls: 1, channels: 2, frames: 4410, rate: 44100 });
  expect(result.levels[0]).toBeGreaterThan(.24); expect(result.levels[3]).toBeGreaterThan(.24);
  expect(result.levels[1]).toBeLessThan(.0001); expect(result.levels[2]).toBeLessThan(.0001);
});

test('export decoder rejects corrupt, empty, oversized and unreadable files without skipping music', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/music-export.ts', { decodeMusicForExport, MAX_MUSIC_FILE_BYTES } = await import(path);
    const huge = new File(['x'], 'huge.wav'); Object.defineProperty(huge, 'size', { value: MAX_MUSIC_FILE_BYTES + 1 });
    const unreadable = new File(['x'], 'unreadable.wav'); unreadable.arrayBuffer = async () => { throw new Error('disk unavailable'); };
    const errors: string[] = [];
    for (const file of [new File([], 'empty.wav'), huge, unreadable, new File(['not music'], 'corrupt.mp3')]) {
      try { await decodeMusicForExport(file); errors.push('accepted'); } catch (error) { errors.push((error as Error).message); }
    }
    return errors;
  });
  expect(result[0]).toContain('empty'); expect(result[1]).toContain('64 MiB');
  expect(result[2]).toContain('could not be read'); expect(result[3]).toContain('could not be decoded');
});

test('export decoder checks cancellation before reading, after reading and after an in-flight decode', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/music-export.ts', { decodeMusicForExport } = await import(path);
    const original = OfflineAudioContext.prototype.decodeAudioData;
    let reads = 0, decodes = 0, release!: (value: AudioBuffer) => void;
    const file = new File(['music'], 'pending.wav');
    file.arrayBuffer = async () => { reads++; return new ArrayBuffer(1); };
    const errors: string[] = [];
    const capture = async (work: Promise<unknown>) => { try { await work; errors.push('accepted'); } catch (error) { errors.push((error as Error).name); } };
    try {
      const before = new AbortController(); before.abort(); await capture(decodeMusicForExport(file, before.signal));
      const beforeReads = reads;
      const reading = new AbortController(); file.arrayBuffer = async () => { reads++; reading.abort(); return new ArrayBuffer(1); };
      await capture(decodeMusicForExport(file, reading.signal));
      file.arrayBuffer = async () => { reads++; return new ArrayBuffer(1); };
      let entered!: () => void; const decoding = new Promise<void>(resolve => { entered = resolve; });
      OfflineAudioContext.prototype.decodeAudioData = function() {
        decodes++; entered(); return new Promise<AudioBuffer>(resolve => { release = resolve; });
      };
      const controller = new AbortController(), pending = capture(decodeMusicForExport(file, controller.signal));
      await decoding; controller.abort(); release(new AudioBuffer({ length: 1, sampleRate: 44100 })); await pending;
      return { errors, beforeReads, reads, decodes };
    } finally { OfflineAudioContext.prototype.decodeAudioData = original; }
  });
  expect(result).toEqual({ errors: ['AbortError', 'AbortError', 'AbortError'], beforeReads: 0, reads: 2, decodes: 1 });
});

test('export decoder bounds decoded channel-samples and rejects empty PCM before graph creation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/music-export.ts', { decodeMusicForExport, MAX_MUSIC_PCM_SAMPLES } = await import(path);
    const original = OfflineAudioContext.prototype.decodeAudioData, errors: string[] = [];
    const shapes = [{ length: 0, numberOfChannels: 2, sampleRate: 44100 },
      { length: 1, numberOfChannels: 0, sampleRate: 44100 },
      { length: Math.floor(MAX_MUSIC_PCM_SAMPLES / 2) + 1, numberOfChannels: 2, sampleRate: 44100 }];
    try {
      for (const shape of shapes) {
        OfflineAudioContext.prototype.decodeAudioData = async () => shape as AudioBuffer;
        try { await decodeMusicForExport(new File(['x'], 'music.wav')); errors.push('accepted'); }
        catch (error) { errors.push((error as Error).message); }
      }
      return errors;
    } finally { OfflineAudioContext.prototype.decodeAudioData = original; }
  });
  expect(result[0]).toContain('no usable audio'); expect(result[1]).toContain('no usable audio');
  expect(result[2]).toContain('too large');
});
