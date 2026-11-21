import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeBwgFixture } from './helpers/bwg';
import { setSources } from './helpers/listening-sources';

test('source switches preserve the mix, keep controls discoverable and never autoplay', async ({ page }) => {
  await page.goto('/');
  const tones = page.getByRole('button', { name: /^Tones (?:On|Off)$/ });
  const asmr = page.getByRole('button', { name: /^ASMR (?:On|Off)$/ });
  await expect(tones).toHaveAttribute('aria-pressed', 'true');
  await expect(asmr).toHaveAttribute('aria-pressed', 'false');
  await setSources(page, 'asmr');
  await expect(page.locator('#tone-controls')).toBeVisible();
  await expect(page.locator('.frequency-panel')).toBeVisible();
  await expect(page.locator('#tone-settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('#frequency-browser')).not.toHaveAttribute('open', '');
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.locator('.asmr-layer')).toHaveCount(1);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('brush');
  await expect(page.getByRole('link', { name: 'Skip to ASMR', exact: true })).toHaveAttribute('href', '#asmr-controls');
  await page.locator('[data-asmr-preset=ear-cupping]').click();
  await page.locator('.asmr-advanced').first().locator('summary').click();
  await expect(page.getByLabel('Sound 1 ear cupping', { exact: true })).toHaveValue('0.85');
  await expect(page.locator('#asmr-browse')).toBeVisible();
  await expect(page.locator('#asmr-preset')).toHaveCount(0);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true }).locator('option')).toHaveCount(38);
  for (const selected of ['mixed', 'binaural', 'ambient', 'asmr'] as const) {
    await setSources(page, selected);
    await expect(tones).toHaveAttribute('aria-pressed', String(selected === 'mixed' || selected === 'binaural'));
    await expect(asmr).toHaveAttribute('aria-pressed', String(selected === 'mixed' || selected === 'asmr'));
    await expect(page.locator('#ambient-level')).toHaveValue('0.2');
    await expect(page.locator('#music-level')).toHaveValue('0.4');
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await expect(page.getByLabel('Sound 1 ear cupping', { exact: true })).toHaveValue('0.85');
  await tones.click();
  await expect(page.locator('#tone-controls')).toBeVisible();
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to tones', exact: true })).toHaveAttribute('href', '#tone-controls');
  await page.locator('#undo-edit').click();
  await expect(tones).toHaveAttribute('aria-pressed', 'false');
  await expect(asmr).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#asmr-clear').click();
  await expect(asmr).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#asmr-controls')).toBeVisible();
});

test('WAV modes isolate actual tone and ASMR channels while keeping shared atmosphere', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const model = '/src/model.ts', state = '/src/asmr-state.ts', output = '/src/audio/export.ts';
    const { initialSession } = await import(model), { makeAsmrLayer } = await import(state), { renderWav } = await import(output);
    const session = initialSession(); session.master = .5; session.ambient = 'none'; session.minutes = 1;
    session.layers[0] = { ...session.layers[0], left: 660, right: 660, route: 'right', level: .8 };
    session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1, pan: -1, motion: 'still' }] };
    const results: Record<string, number[]> = {};
    for (const mode of ['binaural', 'asmr', 'mixed', 'ambient']) {
      session.mode = mode;
      const view = new DataView(await (await renderWav(session, 1)).arrayBuffer()), sums = [0, 0];
      for (let frame = 28665; frame < 41895; frame++) for (let ear = 0; ear < 2; ear++) sums[ear] += (view.getInt16(44 + frame * 4 + ear * 2, true) / 32768) ** 2;
      results[mode] = sums.map(sum => Math.sqrt(sum / 13230));
    }
    session.mode = 'ambient'; session.ambient = 'pink'; session.ambientLevel = .5;
    const shared = new DataView(await (await renderWav(session, 1)).arrayBuffer()); let energy = 0;
    for (let i = 44 + 28665 * 4; i < shared.byteLength; i += 2) energy += Math.abs(shared.getInt16(i, true));
    return { results, energy };
  });
  expect(result.results.binaural[0]).toBe(0); expect(result.results.binaural[1]).toBeGreaterThan(.02);
  expect(result.results.asmr[0]).toBeGreaterThan(.001); expect(result.results.asmr[1]).toBe(0);
  expect(Math.min(...result.results.mixed)).toBeGreaterThan(.001);
  expect(result.results.ambient).toEqual([0, 0]);
  expect(result.energy).toBeGreaterThan(10000);
});

test('legacy ASMR links keep Mixed mode when cleared and unknown modes are rejected', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const model = '/src/model.ts', state = '/src/asmr-state.ts', share = '/src/share.ts';
    const { initialSession, parseSession } = await import(model), { makeAsmrLayer } = await import(state), { sessionLink } = await import(share);
    const session = initialSession(); session.asmr = { level: .6, layers: [makeAsmrLayer('air')] };
    const rejected = ['unknown', '', 1, null].every(mode => { try { parseSession({ ...session, mode }); return false; } catch { return true; } });
    return { link: sessionLink(session), rejected };
  });
  expect(result.rejected).toBe(true); await page.goto(result.link);
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#asmr-clear').click();
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#asmr-controls')).toBeVisible();
});

test('ASMR starts with ordinary and native BWGen buses silent before the audio context resumes', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const gains = await page.evaluate(async fixture => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', importPath = '/src/import/bwg.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
    const { makeAsmrLayer } = await import(statePath), { importBwg } = await import(importPath);
    const values: { tone: number; native?: number }[] = [], original = AudioContext.prototype.resume;
    let engine: InstanceType<typeof AudioEngine>;
    AudioContext.prototype.resume = function () {
      values.push({ tone: engine.toneBus.gain.value, native: engine.bwgBus?.gain.value });
      return original.call(this);
    };
    try {
      for (const session of [initialSession(), importBwg(new Uint8Array(fixture)).session]) {
        engine = new AudioEngine(); session.mode = 'asmr'; session.ambient = 'none';
        session.asmr = { level: .5, layers: [makeAsmrLayer('air')] };
        await engine.start(session); await engine.stop();
      }
    } finally { AudioContext.prototype.resume = original; }
    return values;
  }, makeBwgFixture());
  expect(gains).toEqual([{ tone: 0 }, { tone: 0, native: 0 }]);
});

test('all bundled recordings retain their channel layout, bounded PCM and actual mixer export', async ({ page, browserName }) => {
  await page.goto('/');
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/audio/asmr/')) requests.push(request.url()); });
  const results = await page.evaluate(async () => {
    const assets = '/src/audio/asmr-assets.ts', state = '/src/asmr-state.ts', model = '/src/model.ts', output = '/src/audio/export.ts';
    const { prepareAsmrRecordings, recordedAsmrBuffer } = await import(assets), { recordedAsmrSounds, makeAsmrLayer } = await import(state);
    const { initialSession } = await import(model), { renderWav } = await import(output);
    const results = [];
    for (const sound of recordedAsmrSounds) {
      const layer = { ...makeAsmrLayer(sound.id), level: 1, pan: -1, motion: 'still', tone: 1 };
      await prepareAsmrRecordings({ level: 1, layers: [layer] });
      const buffer: AudioBuffer = recordedAsmrBuffer(sound.id), channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      let peak = 0, finite = true, difference = 0;
      for (let i = 0; i < buffer.length; i++) {
        let combined = 0;
        for (const channel of channels) { finite &&= Number.isFinite(channel[i]); combined += Math.abs(channel[i]); }
        peak = Math.max(peak, combined);
        if (channels.length === 2) difference += Math.abs(channels[0][i] - channels[1][i]);
      }
      // Starting a source may detach getChannelData views; inspect them before export.
      const edges = channels.every(data => data[0] === 0 && data.at(-1) === 0);
      const session = initialSession(); session.mode = 'asmr'; session.master = 1; session.ambient = 'none'; session.asmr = { level: 1, layers: [layer] };
      const extended = sound.id === 'recorded-sketching-long' || sound.id.startsWith('recorded-plastic-');
      const seconds = extended ? Math.max(3, Math.ceil(buffer.duration)) : 3;
      const view = new DataView(await (await renderWav(session, seconds)).arrayBuffer()), energy = [0, 0];
      for (let i = 44 + 22050 * 4; i < view.byteLength; i += 4) for (let ear = 0; ear < 2; ear++) energy[ear] += Math.abs(view.getInt16(i + ear * 2, true));
      results.push({ id: sound.id, file: sound.file, channels: channels.length, duration: buffer.duration,
        frames: buffer.length, sampleRate: buffer.sampleRate, peak, finite, difference, energy, edges });
    }
    return results;
  });
  const { clips } = JSON.parse(await readFile('public/audio/asmr/credits.json', 'utf8'));
  expect(results).toHaveLength(clips.length); expect(requests).toHaveLength(clips.length);
  for (const result of results) {
    const clip = clips.find((clip: { file: string }) => clip.file === result.file);
    expect(clip, result.id).toBeDefined();
    if (result.id === 'recorded-sketching-long') {
      expect(clip.format).toBe('WAV');
      const wav = await readFile(`public/audio/asmr/${result.file}`);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      expect(wav.readUInt32LE(4) + 8).toBe(wav.length); expect(wav.length).toBe(clip.bytes);
      expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
      expect(wav.readUInt16LE(20)).toBe(1); expect(wav.readUInt16LE(34)).toBe(16);
      const data = 20 + wav.readUInt32LE(16);
      expect(wav.toString('ascii', data, data + 4)).toBe('data');
      const sourceChannels = wav.readUInt16LE(22), sourceRate = wav.readUInt32LE(24), blockAlign = wav.readUInt16LE(32);
      const dataBytes = wav.readUInt32LE(data + 4), sourceFrames = dataBytes / blockAlign;
      expect(data + 8 + dataBytes).toBeLessThan(wav.length);
      expect(blockAlign).toBe(sourceChannels * 2); expect(sourceRate).toBe(clip.sampleRate);
      expect(sourceFrames).toBe(clip.originalMetadata.frames);
      expect(sourceFrames / sourceRate).toBe(clip.durationSeconds);
      expect(sourceChannels).toBe(clip.channels); expect(result.channels, result.id).toBe(sourceChannels);
      expect(result.sampleRate, result.id).toBe(sourceRate);
      // Chromium on Windows has returned a 796-frame difference for this metadata-bearing WAV.
      const durationTolerance = browserName === 'chromium' ? .02 : .01;
      expect(Math.abs(result.frames - sourceFrames), result.id).toBeLessThan(sourceRate * durationTolerance);
    } else if (clip.format === 'MP3') {
      expect([1, 2]).toContain(result.channels);
      expect(Math.abs(result.duration - clip.originalMetadata.durationSeconds), result.id).toBeLessThan(.15);
      expect(result.duration, result.id).toBeLessThan(60);
    } else {
      expect(result.channels, result.id).toBe(clip.channels);
      expect(Math.abs(result.duration - clip.durationSeconds), result.id).toBeLessThan(.01);
    }
    expect(result.finite, result.id).toBe(true); expect(result.edges, result.id).toBe(true);
    expect(result.peak, result.id).toBeGreaterThan(.001); expect(result.peak, result.id).toBeLessThanOrEqual(.700001);
    expect(result.energy[0], result.id).toBeGreaterThan(1000); expect(result.energy[1], result.id).toBe(0);
    if (clip.format === 'Ogg Vorbis') {
      if (result.channels === 2 && result.id !== 'recorded-grass') expect(result.difference, result.id).toBeGreaterThan(.1);
      else expect(result.difference, result.id).toBe(0);
    }
    console.log(`Decoded ${result.id}: ${result.channels} channels, ${result.duration.toFixed(3)} seconds, stereo difference ${result.difference.toFixed(3)}`);
  }
});

test('recorded mono and distinct stereo fixtures keep their channels through decoding and mixing', async ({ page }) => {
  for (const channels of [1, 2]) {
    const frames = 48000, bytes = frames * channels * 2, wav = Buffer.alloc(44 + bytes);
    wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * channels * 2, 28);
    wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
    for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < channels; ear++) {
      const sine = (frequency: number) => Math.sin(2 * Math.PI * frequency * frame / 48000);
      const base = (ear ? .25 : .5) * sine(ear ? 880 : 440);
      const detail = channels === 2 ? .18 * (sine(ear ? 8000 : 6000) + sine(8)) : 0;
      wav.writeInt16LE(Math.round((base + detail) * 32767), 44 + (frame * channels + ear) * 2);
    }
    const file = channels === 1 ? 'hand-rubbing.ogg' : 'metal-tapping.ogg';
    await page.route(`**/audio/asmr/${file}`, route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  }
  await page.goto('/');
  const { results, clear } = await page.evaluate(async () => {
    const assets = '/src/audio/asmr-assets.ts', mixerPath = '/src/audio/asmr-mixer.ts', state = '/src/asmr-state.ts';
    const { prepareAsmrRecordings, recordedAsmrBuffer } = await import(assets), { AsmrMixer } = await import(mixerPath), { makeAsmrLayer } = await import(state);
    const render = async (sound: string, tone: number, clearTone?: boolean) => {
      const settings = { level: 1, layers: [{ ...makeAsmrLayer(sound), level: 1, pan: 0, motion: 'still', tone,
        ...(clearTone === undefined ? {} : { clearTone }) }] };
      await prepareAsmrRecordings(settings);
      const channels = recordedAsmrBuffer(sound).numberOfChannels, context = new OfflineAudioContext(2, 44100, 44100);
      new AsmrMixer(context, context.destination).update(settings);
      const buffer = await context.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      return { channels, left, right };
    };
    const magnitude = (data: Float32Array, frequency: number) => {
      let real = 0, imaginary = 0;
      for (let i = 11025; i < 33075; i++) { const phase = 2 * Math.PI * frequency * i / 44100; real += data[i] * Math.cos(phase); imaginary += data[i] * Math.sin(phase); }
      return Math.hypot(real, imaginary) / 22050;
    };
    const results = [];
    for (const sound of ['recorded-hands', 'recorded-metal']) {
      const { channels, left, right } = await render(sound, 1);
      let difference = 0;
      for (let i = 11025; i < 33075; i++) difference = Math.max(difference, Math.abs(left[i] - right[i]));
      results.push({ channels, difference, left: [magnitude(left, 440), magnitude(left, 880)], right: [magnitude(right, 440), magnitude(right, 880)] });
    }
    const defaultTone = await render('recorded-metal', .4), disabled = await render('recorded-metal', .4, false);
    const enabled = await render('recorded-metal', .4, true);
    const clear = (['left', 'right'] as const).map((ear, index) => {
      const low = index ? 880 : 440, high = index ? 8000 : 6000, otherHigh = index ? 6000 : 8000;
      const pcm = enabled[ear];
      return { exactDefault: defaultTone[ear].every((sample, frame) => sample === disabled[ear][frame]),
        lowRatio: magnitude(pcm, low) / magnitude(defaultTone[ear], low),
        high: magnitude(pcm, high), warmHigh: magnitude(defaultTone[ear], high),
        leak: magnitude(pcm, otherHigh), rumble: magnitude(pcm, 8) };
    });
    return { results, clear };
  });
  expect(results.map(result => result.channels)).toEqual([1, 2]);
  expect(results[0].difference).toBeLessThan(.000001);
  for (const ear of [results[0].left, results[0].right, results[1].left]) { expect(ear[0]).toBeGreaterThan(.001); expect(ear[0]).toBeGreaterThan(ear[1] * 100); }
  expect(results[1].right[1]).toBeGreaterThan(.001); expect(results[1].right[1]).toBeGreaterThan(results[1].right[0] * 100);
  for (const ear of clear) {
    expect(ear.exactDefault).toBe(true);
    expect(ear.lowRatio).toBeGreaterThan(.85); expect(ear.lowRatio).toBeLessThan(1.15);
    expect(ear.high).toBeGreaterThan(.006); expect(ear.high).toBeGreaterThan(ear.warmHigh * 7);
    expect(ear.leak).toBeLessThan(ear.high / 100);
    expect(ear.rumble).toBeLessThan(ear.high * .15);
  }
});

test('clear recording is recording-only and survives exported JSON and shared sessions', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  const clear = page.getByLabel('Sound 1 clear recording', { exact: true });
  const tone = page.getByLabel('Sound 1 tone', { exact: true });
  const trigger = page.getByLabel('Sound 1 trigger', { exact: true });
  await expect(clear).toHaveCount(0);
  await trigger.selectOption('recorded-metal');
  await page.locator('.asmr-advanced summary').click();
  await expect(tone).toBeVisible();
  await expect(clear).not.toBeChecked();
  await clear.click();
  await expect(clear).toBeChecked();
  await expect(tone).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  const session = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(session.asmr.layers[0]).toMatchObject({ sound: 'recorded-metal', clearTone: true });
  await page.locator('#share-session').click();
  const url = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.goto('about:blank');
  await page.goto(url);
  await expect(page.locator('#notice')).toContainText('Shared session loaded');
  await expect(clear).toBeChecked();
  await trigger.selectOption('brush');
  await expect(clear).toHaveCount(0);
  await trigger.selectOption('recorded-metal');
  await expect(clear).not.toBeChecked();
});

test('opposite cupping phases alternate warmth independently and ear-focus recipes stay in their own ear', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', presetPath = '/src/asmr-presets.ts', statePath = '/src/asmr-state.ts';
    const { AsmrMixer } = await import(mixerPath), { asmrPresets } = await import(presetPath), { makeAsmrLayer } = await import(statePath);
    const render = async (layers: unknown[], seconds: number) => {
      const context = new OfflineAudioContext(2, 24000 * seconds, 24000);
      new AsmrMixer(context, context.destination).update({ level: 1, layers });
      return context.startRendering();
    };
    const rms = (buffer: AudioBuffer, ear: number, time: number, duration = .3) => {
      const data = buffer.getChannelData(ear); let sum = 0;
      for (let i = time * 24000; i < (time + duration) * 24000; i++) sum += data[Math.round(i)] ** 2;
      return Math.sqrt(sum / (duration * 24000));
    };
    const base = { ...makeAsmrLayer('air'), level: 1, motion: 'still', pressure: 1, period: 4, tone: .6 };
    const phases = await render([{ ...base, pan: -1 }, { ...base, id: crypto.randomUUID(), pan: 1, pressurePhase: 180 }], 4);
    const first = [rms(phases, 0, .8), rms(phases, 1, .8)], second = [rms(phases, 0, 2.8), rms(phases, 1, 2.8)];
    const ears = [];
    for (const id of ['left-ear-focus', 'right-ear-focus']) {
      const buffer = await render(asmrPresets.find((preset: { id: string }) => preset.id === id).make().layers, 2);
      ears.push([rms(buffer, 0, 1), rms(buffer, 1, 1)]);
    }
    return { first, second, ears };
  });
  expect(result.first[0]).toBeGreaterThan(result.first[1] * 1.4);
  expect(result.second[1]).toBeGreaterThan(result.second[0] * 1.4);
  expect(result.ears[0][0]).toBeGreaterThan(.001); expect(result.ears[0][1]).toBeLessThan(.000001);
  expect(result.ears[1][1]).toBeGreaterThan(.001); expect(result.ears[1][0]).toBeLessThan(.000001);
});

for (const action of ['mode', 'restart']) test(`pending recording edits fall silent and cannot revive after ${action}`, async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  let release!: () => void, requested = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/audio/asmr/hand-rubbing.ogg', async route => { requested = true; await pending; await route.continue(); });
  try {
    const before = await page.evaluate(async () => {
      const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts', clockPath = '/tests/helpers/audio-clock.ts';
      const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
      const { waitForAudioTime } = await import(clockPath);
      const engine = new AudioEngine(), session = initialSession();
      session.mode = 'asmr'; session.tonesMuted = true; session.master = 1; session.ambient = 'none';
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1 }] };
      await engine.start(session);
      const read = () => {
        const analyzer: AnalyserNode = engine.context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
        return { analyzer, peak: () => { const samples = new Float32Array(2048); analyzer.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs)); } };
      };
      const signal = read(); await waitForAudioTime(engine.context, engine.context.currentTime + .65);
      const peak = signal.peak(); session.asmr.layers[0].sound = 'recorded-hands'; engine.update(session);
      Object.assign(window, { asmrRace: { engine, session, signal, read, makeAsmrLayer, waitForAudioTime } }); return peak;
    });
    expect(before).toBeGreaterThan(.001);
    await expect.poll(() => requested).toBe(true);
    const silent = await page.evaluate(async () => {
      const { engine, session, signal, waitForAudioTime } = (window as any).asmrRace;
      session.asmr.level = 0; session.asmr.layers[0].muted = true; engine.update(session);
      await waitForAudioTime(engine.context, engine.context.currentTime + .55);
      return { peak: signal.peak(), loading: engine.loadingAsmr };
    });
    expect(silent.loading).toBe(true); expect(silent.peak).toBeLessThan(.00001);
    await page.evaluate(async action => {
      const state = (window as any).asmrRace;
      if (action === 'mode') { state.session.mode = 'binaural'; state.engine.update(state.session); }
      else {
        await state.engine.stop();
        state.session.asmr = { level: 1, layers: [{ ...state.makeAsmrLayer('air'), level: 1 }] };
        await state.engine.start(state.session); state.signal = state.read();
      }
    }, action);
    release();
    const after = await page.evaluate(async () => {
      const assets = '/src/audio/asmr-assets.ts', statePath = '/src/asmr-state.ts';
      const { prepareAsmrRecordings } = await import(assets), { makeAsmrLayer } = await import(statePath);
      await prepareAsmrRecordings({ level: 1, layers: [makeAsmrLayer('recorded-hands')] });
      const { engine, signal, waitForAudioTime } = (window as any).asmrRace;
      await waitForAudioTime(engine.context, engine.context.currentTime + .55);
      const result = { peak: signal.peak(), loading: engine.loadingAsmr, sounds: [...engine.asmr.voices.values()].map((voice: any) => voice.sound) };
      await engine.stop(); return result;
    });
    expect(after.loading).toBe(false);
    if (action === 'mode') { expect(after.peak).toBeLessThan(.00001); expect(after.sounds).not.toContain('recorded-hands'); }
    else { expect(after.peak).toBeGreaterThan(.001); expect(after.sounds).toEqual(['air']); }
  } finally { release(); }
});

test('failed recording loads can retry and ASMR-only native sessions can export', async ({ page }) => {
  await page.goto('/');
  let attempts = 0;
  await page.route('**/audio/asmr/hand-rubbing.ogg', route => ++attempts === 1 ? route.abort() : route.continue());
  const result = await page.evaluate(async fixture => {
    const assets = '/src/audio/asmr-assets.ts', statePath = '/src/asmr-state.ts', importPath = '/src/import/bwg.ts', output = '/src/audio/export.ts';
    const { prepareAsmrRecordings, asmrRecordingsReady } = await import(assets), { makeAsmrLayer } = await import(statePath);
    const { importBwg } = await import(importPath), { renderWav } = await import(output);
    const settings = { level: 1, layers: [{ ...makeAsmrLayer('recorded-hands'), motion: 'still', pan: 1, level: 1 }] };
    let failed = false;
    try { await prepareAsmrRecordings(settings); } catch { failed = true; }
    const cachedAfterFailure = asmrRecordingsReady(settings); await prepareAsmrRecordings(settings);
    const session = importBwg(new Uint8Array(fixture)).session;
    session.mode = 'asmr'; session.asmr = settings; session.master = 1; session.ambient = 'none';
    const view = new DataView(await (await renderWav(session, 2)).arrayBuffer()); let left = 0, right = 0;
    for (let i = 44 + 22050 * 4; i < view.byteLength; i += 4) { left += Math.abs(view.getInt16(i, true)); right += Math.abs(view.getInt16(i + 2, true)); }
    session.mode = 'ambient';
    const muted = new DataView(await (await renderWav(session, 1)).arrayBuffer());
    let ambientEnergy = 0;
    for (let i = 44; i < muted.byteLength; i += 2) ambientEnergy += Math.abs(muted.getInt16(i, true));
    return { failed, cachedAfterFailure, cachedAfterRetry: asmrRecordingsReady(settings), left, right, ambientEnergy };
  }, makeBwgFixture());
  expect(attempts).toBe(2); expect(result.failed).toBe(true); expect(result.cachedAfterFailure).toBe(false); expect(result.cachedAfterRetry).toBe(true);
  expect(result.left).toBe(0); expect(result.right).toBeGreaterThan(1000);
  expect(result.ambientEnergy).toBe(0);
});
