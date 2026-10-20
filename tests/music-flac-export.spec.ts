import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { makeBwgFixture } from './helpers/bwg';

function musicWave(channels = 2, rate = 22050): number[] {
  const frames = Math.round(rate * .32), bytes = new Uint8Array(44 + frames * channels * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < channels; ear++) {
    view.setInt16(44 + (frame * channels + ear) * 2, Math.round(.125 * 32768 * Math.sin(2 * Math.PI * (ear ? 693.75 : 431.25) * frame / rate)), true);
  }
  return Array.from(bytes);
}

test('mono and stereo local music follow music level, master, timer and every listening mode', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async waves => {
    const exportPath = '/src/audio/export.ts', modelPath = '/src/model.ts';
    const { renderAudio } = await import(exportPath), { initialSession } = await import(modelPath);
    const rows = [], referenceContext = new OfflineAudioContext(2, 61740, 44100);
    const oscillator = referenceContext.createOscillator(), gain = referenceContext.createGain(), compressor = referenceContext.createDynamicsCompressor();
    oscillator.frequency.value = 431.25; gain.gain.value = .125 * .8 * .4 * .5;
    compressor.threshold.value = -10; compressor.knee.value = 6; compressor.ratio.value = 12;
    compressor.attack.value = .003; compressor.release.value = .25;
    oscillator.connect(gain).connect(compressor).connect(referenceContext.destination); oscillator.start();
    const reference = (await referenceContext.startRendering()).getChannelData(0); let re = 0, im = 0;
    for (let i = 30870; i < 44982; i++) { re += reference[i] * Math.cos(2 * Math.PI * 431.25 * i / 44100); im += reference[i] * Math.sin(2 * Math.PI * 431.25 * i / 44100); }
    const expected = 2 * Math.hypot(re, im) / 14112;
    for (const [index, wave] of waves.entries()) {
      const session = initialSession(); session.minutes = 0; session.ambient = 'none'; session.tonesMuted = true;
      session.master = .5; session.musicLevel = .8;
      const music = new File([new Uint8Array(wave)], 'local.wav', { type: 'audio/wav' });
      const render = async () => new DataView(await (await renderAudio(session, 3, { music })).arrayBuffer());
      const level = (view: DataView, ear: number, start = .7, hz = 431.25) => {
        let re = 0, im = 0; const first = Math.round(start * 44100), count = 14112;
        for (let i = first; i < first + count; i++) {
          const value = view.getInt16(44 + i * 4 + ear * 2, true) / 32768;
          re += value * Math.cos(2 * Math.PI * hz * i / 44100); im += value * Math.sin(2 * Math.PI * hz * i / 44100);
        }
        return 2 * Math.hypot(re, im) / count;
      };
      const modes = [];
      for (const mode of ['binaural', 'asmr', 'mixed']) {
        session.mode = mode; const view = await render(); modes.push([level(view, 0), level(view, 1, .7, index ? 693.75 : 431.25)]);
      }
      const full = modes[0][0]; session.musicLevel = .4; const halfMusic = level(await render(), 0);
      session.master = .25; const halfMaster = level(await render(), 0);
      session.timelineDuration = 2; const timer = await render();
      let after = 0; for (let frame = 2.1 * 44100; frame < 3 * 44100; frame++) after = Math.max(after, Math.abs(timer.getInt16(44 + frame * 4, true)));
      session.musicLevel = 0; const muted = await render();
      rows.push({ modes, full, halfMusic, halfMaster, late: level(timer, 0, 1.6), after,
        muted: new Uint8Array(muted.buffer, 44).every(value => value === 0) });
    }
    return { rows, expected };
  }, [musicWave(1), musicWave(2)]);
  for (const row of results.rows) {
    expect(row.full).toBeCloseTo(results.expected, 4);
    for (const ears of row.modes) for (const level of ears) expect(level).toBeCloseTo(row.full, 4);
    expect(row.halfMusic / row.full).toBeCloseTo(.5, 3); expect(row.halfMaster / row.halfMusic).toBeCloseTo(.5, 3);
    expect(row.late).toBeLessThan(row.halfMaster * .4); expect(row.after).toBe(0); expect(row.muted).toBe(true);
  }
});

test('compressed local Ogg is decoded into the same graph as an independently decoded source', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const exportPath = '/src/audio/export.ts', graphPath = '/src/audio/export-graph.ts', modelPath = '/src/model.ts';
    const { renderAudio } = await import(exportPath), { exportGraph } = await import(graphPath), { initialSession } = await import(modelPath);
    const response = await fetch('/audio/asmr/hand-rubbing.ogg'); if (!response.ok) throw new Error('Missing compressed fixture');
    const bytes = await response.arrayBuffer(), file = new File([bytes], 'local.ogg', { type: 'audio/ogg' });
    const session = initialSession(); session.minutes = 0; session.tonesMuted = true; session.ambient = 'none'; session.musicLevel = .75; session.master = .3;
    const context = new OfflineAudioContext(2, 44100, 44100), music = await context.decodeAudioData(bytes.slice(0));
    const cleanup = exportGraph(context, session, 0, undefined, undefined, music);
    const expected = await context.startRendering(); cleanup();
    const view = new DataView(await (await renderAudio(session, 1, { music: file })).arrayBuffer());
    let peak = 0, error = 0;
    for (let ear = 0; ear < 2; ear++) for (let i = 0; i < 44100; i++) {
      const sample = view.getInt16(44 + i * 4 + ear * 2, true) / 32768;
      peak = Math.max(peak, Math.abs(sample)); error = Math.max(error, Math.abs(sample - expected.getChannelData(ear)[i]));
    }
    return { channels: music.numberOfChannels, peak, error };
  });
  expect(result.channels).toBeGreaterThan(0); expect(result.peak).toBeGreaterThan(.001); expect(result.error).toBeLessThan(2 / 32768);
});

test('music mixes independently with ordinary, native BWGen and ASMR buses', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async ({ wave, bwg }) => {
    const exportPath = '/src/audio/export.ts', modelPath = '/src/model.ts', importPath = '/src/import/bwg.ts', asmrPath = '/src/asmr-state.ts';
    const { renderAudio } = await import(exportPath), { initialSession } = await import(modelPath);
    const { importBwg } = await import(importPath), { makeAsmrLayer } = await import(asmrPath);
    const music = new File([new Uint8Array(wave)], 'music.wav'), rows = [];
    for (const native of [false, true]) for (const mode of ['mixed', 'asmr']) {
      const session = native ? importBwg(new Uint8Array(bwg)).session : initialSession();
      if (!native) { session.minutes = 0; session.timelineDuration = undefined; }
      session.master = .2; session.ambient = 'none'; session.musicLevel = .8; session.mode = mode;
      if (!native) Object.assign(session.layers[0], { left: 200, right: 210, level: .2 });
      session.asmr = { level: .15, layers: [{ ...makeAsmrLayer('air'), level: .3, pan: -.3, motion: 'still' }] };
      const view = new DataView(await (await renderAudio(session, 1.4, { music })).arrayBuffer());
      const level = (ear: number, hz: number) => {
        let re = 0, im = 0;
        for (let i = 30870; i < 44982; i++) { const value = view.getInt16(44 + i * 4 + ear * 2, true) / 32768;
          re += value * Math.cos(2 * Math.PI * hz * i / 44100); im += value * Math.sin(2 * Math.PI * hz * i / 44100); }
        return 2 * Math.hypot(re, im) / 14112;
      };
      const tone = level(0, session.layers[0].left), markers = [level(0, 431.25), level(1, 693.75)];
      session.musicLevel = 0; session.tonesMuted = true; session.bwgMuted = true;
      const asmr = new DataView(await (await renderAudio(session, 1.4)).arrayBuffer());
      let energy = 0; for (let i = 30870; i < 44982; i++) energy += (asmr.getInt16(44 + i * 4, true) / 32768) ** 2;
      rows.push({ native, mode, tone, markers, asmr: Math.sqrt(energy / 14112) });
    }
    return rows;
  }, { wave: musicWave(), bwg: makeBwgFixture() });
  for (const row of results) {
    for (const level of row.markers) expect(level).toBeGreaterThan(.006);
    expect(row.asmr).toBeGreaterThan(.00001);
    if (row.mode === 'mixed') expect(row.tone).toBeGreaterThan(.001);
    else expect(row.tone).toBeLessThan(.001);
  }
});

test('music loops across thirty-second render sections with one decode and continuous absolute phase', async ({ page }) => {
  test.setTimeout(120_000); await page.goto('/');
  const result = await page.evaluate(async wave => {
    const exportPath = '/src/audio/export.ts', graphPath = '/src/audio/export-graph.ts', modelPath = '/src/model.ts';
    const { renderAudio } = await import(exportPath), { exportGraph } = await import(graphPath), { initialSession } = await import(modelPath);
    const music = new File([new Uint8Array(wave)], 'loop.wav'), session = initialSession();
    session.minutes = 0; session.ambient = 'none'; session.tonesMuted = true; session.master = .4; session.musicLevel = .8;
    const decoder = new OfflineAudioContext(2, 1, 44100), buffer = await decoder.decodeAudioData(await music.arrayBuffer());
    const original = OfflineAudioContext.prototype.decodeAudioData; let decodes = 0;
    OfflineAudioContext.prototype.decodeAudioData = function(bytes) { decodes++; return original.call(this, bytes); };
    let bytes: ArrayBuffer;
    try { bytes = await (await renderAudio(session, 30.4, { music })).arrayBuffer(); }
    finally { OfflineAudioContext.prototype.decodeAudioData = original; }
    const context = new OfflineAudioContext(2, Math.round(30.4 * 44100), 44100);
    const cleanup = exportGraph(context, session, 0, undefined, undefined, buffer), expected = await context.startRendering(); cleanup();
    const view = new DataView(bytes); let error = 0, energy = 0, jump = 0, peak = 0;
    for (let ear = 0; ear < 2; ear++) for (let frame = Math.round(29.9 * 44100); frame < Math.round(30.3 * 44100); frame++) {
      const actual = view.getInt16(44 + frame * 4 + ear * 2, true) / 32768;
      error = Math.max(error, Math.abs(actual - expected.getChannelData(ear)[frame])); energy += actual ** 2; peak = Math.max(peak, Math.abs(actual));
      jump = Math.max(jump, Math.abs(actual - view.getInt16(44 + (frame - 1) * 4 + ear * 2, true) / 32768));
    }
    return { decodes, frames: (bytes.byteLength - 44) / 4, error, energy, jump, peak };
  }, musicWave(2, 44100));
  expect(result.decodes).toBe(1); expect(result.frames).toBe(Math.round(30.4 * 44100));
  expect(result.energy).toBeGreaterThan(.1); expect(result.error).toBeLessThan(3 / 32768); expect(result.jump).toBeLessThan(result.peak * .12);
});

test('WAV and FLAC contain identical PCM16 after local music resampling and finalize valid MD5 metadata', async ({ page }) => {
  test.setTimeout(120_000); await page.goto('/');
  const results = await page.evaluate(async waves => {
    const exportPath = '/src/audio/export.ts', modelPath = '/src/model.ts';
    const { renderAudio } = await import(exportPath), { initialSession } = await import(modelPath), rows = [];
    const session = initialSession(); session.minutes = 0; session.tonesMuted = true; session.ambient = 'none'; session.master = .4; session.musicLevel = .7;
    for (const wave of waves) {
      const music = new File([new Uint8Array(wave)], 'resample.wav');
      const wav = await renderAudio(session, .7, { music, format: 'wav' }), flac = await renderAudio(session, .7, { music, format: 'flac' });
      const bytes = await wav.arrayBuffer(), compressed = await flac.arrayBuffer(), header = new Uint8Array(compressed, 0, 42);
      const decoder = new OfflineAudioContext(2, 1, 44100), decoded = await decoder.decodeAudioData(compressed.slice(0)), view = new DataView(bytes);
      let mismatches = 0;
      for (let ear = 0; ear < 2; ear++) for (let i = 0; i < decoded.length; i++) {
        if (Math.round(decoded.getChannelData(ear)[i] * 32768) !== view.getInt16(44 + i * 4 + ear * 2, true)) mismatches++;
      }
      const packed = (header[21] & 15) * 0x100000000 + new DataView(compressed).getUint32(22);
      let raw = ''; for (const byte of new Uint8Array(bytes, 44)) raw += String.fromCharCode(byte);
      rows.push({ wavType: wav.type, type: flac.type, magic: new TextDecoder().decode(header.subarray(0, 4)), frames: decoded.length,
        channels: decoded.numberOfChannels, rate: decoded.sampleRate, packed, mismatches, smaller: flac.size < wav.size,
        md5: Array.from(header.subarray(26, 42), value => value.toString(16).padStart(2, '0')).join(''), pcm: btoa(raw) });
    }
    return rows;
  }, [musicWave(1), musicWave(2)]);
  for (const row of results) {
    expect(row).toMatchObject({ wavType: 'audio/wav', type: 'audio/flac', magic: 'fLaC', frames: 30870,
      channels: 2, rate: 44100, packed: 30870, mismatches: 0, smaller: true });
    expect(row.md5).toBe(createHash('md5').update(Buffer.from(row.pcm, 'base64')).digest('hex'));
  }
});

test('seekable FLAC output patches its final stream header before close and matches the download', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async wave => {
    const exportPath = '/src/audio/export.ts', modelPath = '/src/model.ts';
    const { renderAudio, writeAudio } = await import(exportPath), { initialSession } = await import(modelPath);
    const session = initialSession(); session.minutes = 0; session.ambient = 'none'; session.tonesMuted = true; session.master = .4; session.musicLevel = .7;
    const music = new File([new Uint8Array(wave)], 'stream.wav'), expected = new Uint8Array(await (await renderAudio(session, .3, { format: 'flac', music })).arrayBuffer());
    const file = new Uint8Array(expected.length + 4096), events: string[] = [], stages: string[] = [];
    let position = 0, length = 0, aborted = 0;
    await writeAudio(session, .3, {
      write: async (data: ArrayBuffer) => { events.push(`write:${position}:${data.byteLength}`); file.set(new Uint8Array(data), position); position += data.byteLength; length = Math.max(length, position); },
      seek: async (offset: number) => { events.push(`seek:${offset}`); position = offset; },
      close: async () => { events.push('close'); }, abort: async () => { aborted++; },
    }, { format: 'flac', music, onProgress: (value: { stage: string }) => { stages.push(value.stage); } });
    const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(file.slice(0, length).buffer);
    return { events, stages, aborted, frames: decoded.length, same: length === expected.length && expected.every((value, index) => file[index] === value),
      md5: Array.from(file.subarray(26, 42), value => value.toString(16).padStart(2, '0')).join('') };
  }, musicWave());
  expect(result).toMatchObject({ aborted: 0, frames: 13230, same: true });
  expect(result.md5).not.toBe('0'.repeat(32)); expect(result.events.slice(-3)).toEqual(['seek:0', 'write:0:42', 'close']);
  expect(result.stages).toContain('finishing'); expect(result.stages.at(-1)).toBe('saving');
});

test('FLAC writer failures and cancellation abort output and dispose encoder workers', async ({ page }) => {
  test.setTimeout(120_000); await page.goto('/');
  const results = await page.evaluate(async wave => {
    const exportPath = '/src/audio/export.ts', modelPath = '/src/model.ts';
    const { writeAudio } = await import(exportPath), { initialSession } = await import(modelPath), original = window.Worker;
    let active = 0;
    class TrackedWorker extends original {
      private stopped = false;
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); active++; }
      terminate() { if (!this.stopped) { this.stopped = true; active--; } super.terminate(); }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: TrackedWorker });
    const session = initialSession(); session.minutes = 0; session.ambient = 'none'; session.tonesMuted = true; session.musicLevel = .7;
    const music = new File([new Uint8Array(wave)], 'music.wav'), rows = [];
    try {
      for (const failure of ['write', 'seek', 'patch', 'close', 'cancel-render', 'cancel-finish', 'cancel-save', 'missing-seek', 'decode', 'decode-muted', 'decode-master-zero']) {
        session.musicLevel = failure === 'decode-muted' ? 0 : .7; session.master = failure === 'decode-master-zero' ? 0 : .2;
        const controller = new AbortController(); let closes = 0, aborts = 0, writes = 0, sought = false, error = '', name = '';
        const writer = {
          write: async () => { writes++; if (failure === 'write' || (failure === 'patch' && sought)) throw new Error(`${failure} failed`); },
          seek: failure === 'missing-seek' ? undefined : async () => { sought = true; if (failure === 'seek') throw new Error('seek failed'); },
          close: async () => { closes++; if (failure === 'close') throw new Error('close failed'); },
          abort: async () => { aborts++; if (failure === 'write') throw new Error('abort cleanup failed'); },
        };
        try {
          await writeAudio(session, .2, writer, { format: 'flac', signal: controller.signal,
            music: failure.startsWith('decode') ? new File(['corrupt'], 'bad.mp3') : music,
            onProgress: (value: { stage: string; completedFrames: number }) => {
              if ((failure === 'cancel-render' && value.stage === 'rendering' && value.completedFrames > 0) ||
                  (failure === 'cancel-finish' && value.stage === 'finishing') || (failure === 'cancel-save' && value.stage === 'saving')) controller.abort();
            } });
        } catch (reason) { error = (reason as Error).message; name = (reason as Error).name; }
        rows.push({ failure, closes, aborts, writes, sought, error, name, active });
      }
      return rows;
    } finally { Object.defineProperty(window, 'Worker', { configurable: true, value: original }); }
  }, musicWave());
  for (const row of results) {
    expect(row.aborts, row.failure).toBe(1); expect(row.active, row.failure).toBe(0);
    expect(row.closes, row.failure).toBe(row.failure === 'close' ? 1 : 0);
    if (row.failure.startsWith('cancel')) expect(row.name).toBe('AbortError');
    else if (row.failure === 'missing-seek') { expect(row.error).toContain('seekable'); expect(row.writes).toBe(0); }
    else if (row.failure.startsWith('decode')) { expect(row.error).toContain('could not be decoded'); expect(row.writes).toBe(0); }
    else expect(row.error).toBe(`${row.failure} failed`);
  }
});
