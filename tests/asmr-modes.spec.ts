import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

test('listening modes preserve the mix, expose the right controls and never autoplay', async ({ page }) => {
  await page.goto('/');
  const mode = (name: string) => page.locator(`[data-listening-mode=${name}]`);
  await expect(mode('binaural')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#asmr-controls')).toBeHidden();
  await mode('asmr').click();
  await expect(page.locator('#tone-controls')).toBeHidden();
  await expect(page.locator('.frequency-panel')).toBeHidden();
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to ASMR', exact: true })).toHaveAttribute('href', '#asmr-controls');
  await page.locator('[data-asmr-preset=ear-cupping]').click();
  await expect(page.getByLabel('Sound 1 ear cupping', { exact: true })).toHaveValue('0.85');
  await expect(page.locator('#asmr-preset option')).toHaveCount(16);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true }).locator('option')).toHaveCount(14);
  for (const selected of ['mixed', 'binaural', 'asmr']) {
    await mode(selected).click();
    await expect(mode(selected)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ambient-level')).toHaveValue('0.2');
    await expect(page.locator('#music-level')).toHaveValue('0.4');
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await expect(page.getByLabel('Sound 1 ear cupping', { exact: true })).toHaveValue('0.85');
  await mode('mixed').click();
  await expect(page.locator('#tone-controls')).toBeVisible();
  await expect(page.locator('#asmr-controls')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to tones', exact: true })).toHaveAttribute('href', '#tone-controls');
  await page.locator('#undo-edit').click();
  await expect(mode('asmr')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#asmr-clear').click();
  await expect(mode('asmr')).toHaveAttribute('aria-pressed', 'true');
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
    for (const mode of ['binaural', 'asmr', 'mixed']) {
      session.mode = mode;
      const view = new DataView(await (await renderWav(session, 1)).arrayBuffer()), sums = [0, 0];
      for (let frame = 28665; frame < 41895; frame++) for (let ear = 0; ear < 2; ear++) sums[ear] += (view.getInt16(44 + frame * 4 + ear * 2, true) / 32768) ** 2;
      results[mode] = sums.map(sum => Math.sqrt(sum / 13230));
    }
    session.mode = 'asmr'; session.asmr.layers = []; session.ambient = 'pink'; session.ambientLevel = .5;
    const shared = new DataView(await (await renderWav(session, 1)).arrayBuffer()); let energy = 0;
    for (let i = 44 + 28665 * 4; i < shared.byteLength; i += 2) energy += Math.abs(shared.getInt16(i, true));
    return { results, energy };
  });
  expect(result.results.binaural[0]).toBe(0); expect(result.results.binaural[1]).toBeGreaterThan(.02);
  expect(result.results.asmr[0]).toBeGreaterThan(.001); expect(result.results.asmr[1]).toBe(0);
  expect(Math.min(...result.results.mixed)).toBeGreaterThan(.001);
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
  await expect(page.locator('[data-listening-mode=mixed]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#asmr-clear').click();
  await expect(page.locator('[data-listening-mode=mixed]')).toHaveAttribute('aria-pressed', 'true');
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

test('all bundled recordings decode to bounded stereo PCM and export through the actual mixer', async ({ page }) => {
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
      const session = initialSession(); session.mode = 'asmr'; session.master = 1; session.ambient = 'none'; session.asmr = { level: 1, layers: [layer] };
      const view = new DataView(await (await renderWav(session, 3)).arrayBuffer()), energy = [0, 0];
      for (let i = 44 + 22050 * 4; i < view.byteLength; i += 4) for (let ear = 0; ear < 2; ear++) energy[ear] += Math.abs(view.getInt16(i + ear * 2, true));
      results.push({ id: sound.id, channels: channels.length, duration: buffer.duration, peak, finite, difference, energy,
        edges: channels.every(data => data[0] === 0 && data.at(-1) === 0) });
    }
    return results;
  });
  expect(results).toHaveLength(5); expect(requests).toHaveLength(5);
  for (const result of results) {
    expect(result.finite).toBe(true); expect(result.edges).toBe(true);
    expect(result.peak).toBeGreaterThan(.001); expect(result.peak).toBeLessThanOrEqual(.700001);
    expect(result.duration).toBeGreaterThan(8); expect(result.duration).toBeLessThanOrEqual(20.01);
    expect(result.energy[0]).toBeGreaterThan(1000); expect(result.energy[1]).toBe(0);
    if (result.channels === 2) expect(result.difference).toBeGreaterThan(.1);
  }
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
      const enginePath = '/src/audio/engine.ts', statePath = '/src/asmr-state.ts', modelPath = '/src/model.ts';
      const { AudioEngine } = await import(enginePath), { makeAsmrLayer } = await import(statePath), { initialSession } = await import(modelPath);
      const engine = new AudioEngine(), session = initialSession();
      session.mode = 'asmr'; session.tonesMuted = true; session.master = 1; session.ambient = 'none';
      session.asmr = { level: 1, layers: [{ ...makeAsmrLayer('air'), level: 1 }] };
      await engine.start(session);
      const read = () => {
        const analyzer: AnalyserNode = engine.context.createAnalyser(); analyzer.fftSize = 2048; engine.transport.connect(analyzer);
        return { analyzer, peak: () => { const samples = new Float32Array(2048); analyzer.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs)); } };
      };
      const signal = read(); await new Promise(resolve => setTimeout(resolve, 350));
      const peak = signal.peak(); session.asmr.layers[0].sound = 'recorded-hands'; engine.update(session);
      Object.assign(window, { asmrRace: { engine, session, signal, read, makeAsmrLayer } }); return peak;
    });
    expect(before).toBeGreaterThan(.001);
    await expect.poll(() => requested).toBe(true);
    const silent = await page.evaluate(async () => {
      const { engine, session, signal } = (window as any).asmrRace;
      session.asmr.level = 0; session.asmr.layers[0].muted = true; engine.update(session);
      await new Promise(resolve => setTimeout(resolve, 550));
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
      await new Promise(resolve => setTimeout(resolve, 550));
      const { engine, signal } = (window as any).asmrRace;
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
    session.mode = 'asmr'; session.asmr = settings; session.master = 1;
    const view = new DataView(await (await renderWav(session, 2)).arrayBuffer()); let left = 0, right = 0;
    for (let i = 44 + 22050 * 4; i < view.byteLength; i += 4) { left += Math.abs(view.getInt16(i, true)); right += Math.abs(view.getInt16(i + 2, true)); }
    return { failed, cachedAfterFailure, cachedAfterRetry: asmrRecordingsReady(settings), left, right };
  }, makeBwgFixture());
  expect(attempts).toBe(2); expect(result.failed).toBe(true); expect(result.cachedAfterFailure).toBe(false); expect(result.cachedAfterRetry).toBe(true);
  expect(result.left).toBe(0); expect(result.right).toBeGreaterThan(1000);
});
