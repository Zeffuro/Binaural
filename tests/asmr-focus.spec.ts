import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeBwgFixture } from './helpers/bwg';

const constant = (value: number) => [{ value, position: 0 }, { value, position: 10000 }];

test('ASMR focus stays reversible through undo, saved presets, JSON and shared links', async ({ page }) => {
  await page.goto('/');
  const focus = page.getByRole('checkbox', { name: 'ASMR focus', exact: true });
  await expect(focus).not.toBeChecked();
  await page.locator('[data-asmr-sound=air]').click();
  await focus.check();
  await page.locator('#undo-edit').click();
  await expect(focus).not.toBeChecked();
  await focus.check();
  await page.locator('[data-asmr-preset=ear-cupping]').click();
  await expect(focus).toBeChecked();
  await page.getByLabel('Preset name', { exact: true }).fill('Quiet focus');
  await page.locator('#save-preset').click();
  await expect(page.locator('#notice')).toContainText('saved');
  const ready = page.waitForEvent('download'); await page.locator('#export').click();
  const downloaded = await ready, json = await readFile((await downloaded.path())!, 'utf8');
  expect(JSON.parse(json)).toMatchObject({ ambientLevel: .2, musicLevel: .4, asmr: { focus: true } });
  await focus.uncheck();
  await page.locator('#import-file').setInputFiles({ name: 'focus.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(focus).toBeChecked();
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share session', exact: true })).toHaveCount(0);
  await page.goto('about:blank'); await page.goto(link);
  await expect(focus).toBeChecked();
  await focus.uncheck();
  await page.reload();
  await page.locator('.saved-preset').filter({ hasText: 'Quiet focus' }).click();
  await expect(focus).toBeChecked();
  await focus.uncheck();
  await expect(page.locator('#ambient-level')).toHaveValue('0.2');
  await expect(page.locator('#music-level')).toHaveValue('0.4');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('@live ASMR focus restores atmosphere and music for disabled, muted, zero and solo-silent ASMR', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts';
    const { AudioEngine } = await import(enginePath);
    const { initialSession } = await import('/src/model.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const clockPath = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(clockPath);
    const engine = new AudioEngine(), session = initialSession();
    session.minutes = 0; session.mode = 'mixed'; session.master = .1;
    session.ambient = 'white'; session.ambientLevel = .5; session.musicLevel = .5;
    session.asmr = { focus: true, level: .7, layers: [makeAsmrLayer('air')] };
    await engine.start(session);
    const read = async () => {
      engine.update(session); await waitForAudioTime(engine.context, engine.context.currentTime + .5);
      return { atmosphere: engine.noiseGain.gain.value, music: engine.musicGain.gain.value,
        tones: engine.toneBus.gain.value, asmr: engine.asmr.bus.gain.value };
    };
    try {
      const active = await read();
      session.asmr.focus = false; const off = await read();
      session.asmr.focus = true; session.mode = 'binaural'; const disabled = await read();
      session.mode = 'mixed'; session.asmr.layers[0].muted = true; const muted = await read();
      session.asmr.layers[0].muted = false; session.asmr.layers[0].level = 0; const zero = await read();
      session.asmr.layers[0].level = .6;
      session.asmr.layers.push({ ...makeAsmrLayer('wood'), solo: true, level: 0 }); const soloSilent = await read();
      session.asmr.layers[1].muted = true; const mutedSolo = await read();
      return { active, off, disabled, muted, zero, soloSilent, mutedSolo,
        stored: [session.ambientLevel, session.musicLevel, session.asmr.level] };
    } finally { await engine.stop(); }
  });
  const gain = 10 ** (-10 / 20);
  for (const value of [result.active, result.mutedSolo]) {
    expect(value.atmosphere).toBeCloseTo(.5 * .22 * gain, 5);
    expect(value.music).toBeCloseTo(.5 * .4 * gain, 5);
    expect(value.tones).toBeCloseTo(1, 5); expect(value.asmr).toBeCloseTo(.7, 5);
  }
  for (const value of [result.off, result.disabled, result.muted, result.zero, result.soloSilent]) {
    expect(value.atmosphere).toBeCloseTo(.5 * .22, 5); expect(value.music).toBeCloseTo(.5 * .4, 5);
  }
  expect(result.disabled.asmr).toBeCloseTo(0, 5);
  expect(result.stored).toEqual([.5, .5, .7]);
});

test('WAV focus ducks actual music and atmosphere while preserving tone and ASMR PCM', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { initialSession } = await import('/src/model.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const { renderWav } = await import('/src/audio/export.ts');
    const { wavHeader, wavPcm } = await import('/src/audio/wav-encoding.ts');
    const session = initialSession(); session.mode = 'mixed'; session.master = .1; session.minutes = 0;
    session.ambient = 'none'; session.musicLevel = .5;
    Object.assign(session.layers[0], { left: 660, right: 660, route: 'right', level: .5 });
    session.asmr = { focus: false, level: .5, layers: [{ ...makeAsmrLayer('air'), pan: -1, motion: 'still' }] };
    const rate = 44100, frames = rate * 2;
    const music = new File([wavHeader(frames), wavPcm(new Float32Array(frames),
      Float32Array.from({ length: frames }, (_, i) => .25 * Math.sin(2 * Math.PI * 880 * i / rate)))], 'music.wav');
    const render = async (focus: boolean, localMusic?: File) => {
      session.asmr!.focus = focus;
      return new DataView(await (await renderWav(session, 1.5, undefined, undefined, localMusic)).arrayBuffer());
    };
    const off = await render(false, music), on = await render(true, music), restored = await render(false, music);
    const amplitude = (view: DataView, hz: number) => {
      let re = 0, im = 0;
      for (let frame = rate / 2; frame < rate * 1.5; frame++) {
        const value = view.getInt16(44 + frame * 4 + 2, true) / 32768;
        re += value * Math.cos(2 * Math.PI * hz * frame / rate); im += value * Math.sin(2 * Math.PI * hz * frame / rate);
      }
      return 2 * Math.hypot(re, im) / rate;
    };
    let asmrError = 0, restoreError = 0;
    for (let frame = rate / 2; frame < rate * 1.5; frame++) {
      asmrError = Math.max(asmrError, Math.abs(off.getInt16(44 + frame * 4, true) - on.getInt16(44 + frame * 4, true)));
      for (let ear = 0; ear < 2; ear++) restoreError = Math.max(restoreError,
        Math.abs(off.getInt16(44 + frame * 4 + ear * 2, true) - restored.getInt16(44 + frame * 4 + ear * 2, true)));
    }
    session.tonesMuted = true; session.ambient = 'white'; session.ambientLevel = .5;
    const atmosphereOff = await render(false), atmosphereOn = await render(true);
    const power = (view: DataView) => {
      let sum = 0; for (let frame = rate / 2; frame < rate * 1.5; frame++) sum += view.getInt16(44 + frame * 4 + 2, true) ** 2;
      return Math.sqrt(sum / rate);
    };
    return { musicOff: amplitude(off, 880), musicRatio: amplitude(on, 880) / amplitude(off, 880),
      toneOff: amplitude(off, 660), toneRatio: amplitude(on, 660) / amplitude(off, 660), asmrError, restoreError,
      atmosphereOff: power(atmosphereOff), atmosphereRatio: power(atmosphereOn) / power(atmosphereOff) };
  });
  expect(result.musicOff).toBeGreaterThan(.004); expect(result.toneOff).toBeGreaterThan(.004);
  expect(result.musicRatio).toBeCloseTo(10 ** (-10 / 20), 3);
  expect(result.atmosphereOff).toBeGreaterThan(10); expect(result.atmosphereRatio).toBeCloseTo(10 ** (-10 / 20), 3);
  expect(result.toneRatio).toBeCloseTo(1, 3); expect(result.asmrError).toBeLessThanOrEqual(1); expect(result.restoreError).toBe(0);
});

test('@live ASMR focus waits for recorded sounds to become audible', async ({ page }) => {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/audio/asmr/cloth-rustles.ogg', async route => { requested(); await gate; await route.continue(); });
  await page.goto('/'); await page.locator('h1').click();
  try {
    const pending = page.evaluate(async () => {
      const path = '/src/audio/engine.ts';
      const { AudioEngine } = await import(path), { initialSession } = await import('/src/model.ts');
      const { makeAsmrLayer } = await import('/src/asmr-state.ts');
      const clockPath = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(clockPath);
      const engine = new AudioEngine(), session = initialSession();
      session.minutes = 0; session.mode = 'mixed'; session.master = .1; session.musicLevel = .5;
      session.asmr = { focus: true, level: .7, layers: [makeAsmrLayer('air')] };
      await engine.start(session);
      Object.assign(window, { focusFixture: { engine, session } });
      session.asmr.layers = [makeAsmrLayer('recorded-cloth')]; engine.update(session);
      await waitForAudioTime(engine.context, engine.context.currentTime + .5);
      const settleDeadline = performance.now() + 3000;
      while (engine.asmr.bus.gain.value > .000005) {
        if (performance.now() > settleDeadline) throw new Error('The pending ASMR bus did not fade out.');
        await waitForAudioTime(engine.context, engine.context.currentTime + .05);
      }
      return { loading: engine.loadingAsmr, music: engine.musicGain.gain.value, bus: engine.asmr.bus.gain.value };
    });
    await seen;
    const waiting = await pending;
    expect(waiting.loading).toBe(true); expect(waiting.music).toBeCloseTo(.2, 5); expect(waiting.bus).toBeCloseTo(0, 5);
    release();
    const ready = await page.evaluate(async () => {
      const { engine } = (window as unknown as { focusFixture: { engine: any } }).focusFixture;
      const clockPath = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(clockPath);
      const deadline = performance.now() + 8000;
      while (engine.loadingAsmr && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (engine.loadingAsmr || engine.failure) throw new Error(engine.failure ?? 'ASMR recording did not finish loading.');
      await waitForAudioTime(engine.context, engine.context.currentTime + .5);
      return { loading: engine.loadingAsmr, music: engine.musicGain.gain.value, bus: engine.asmr.bus.gain.value };
    });
    expect(ready.loading).toBe(false); expect(ready.music).toBeCloseTo(.2 * 10 ** (-10 / 20), 5); expect(ready.bus).toBeCloseTo(.7, 5);
  } finally {
    release();
    await page.evaluate(async () => {
      const fixture = (window as unknown as { focusFixture?: { engine: any } }).focusFixture;
      await fixture?.engine.stop();
    });
  }
});

test('@live ASMR focus reaches native worklet backgrounds and restores their output', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async bytes => {
    const path = '/src/audio/engine.ts', { AudioEngine } = await import(path);
    const { importBwg } = await import('/src/import/bwg.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const clockPath = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(clockPath);
    const session = importBwg(new Uint8Array(bytes)).session, engine = new AudioEngine();
    session.mode = 'mixed'; session.master = .1; session.tonesMuted = true; session.ambient = 'none';
    session.asmr = { focus: false, level: .5, layers: [makeAsmrLayer('air')] };
    await engine.start(session);
    const context: AudioContext = engine.context, splitter = context.createChannelSplitter(2), analyzer = context.createAnalyser();
    analyzer.fftSize = 4096; engine.bwgBus.connect(splitter); splitter.connect(analyzer, 1);
    const power = async (focus: boolean) => {
      session.asmr!.focus = focus; engine.update(session);
      await waitForAudioTime(context, context.currentTime + .5);
      let sum = 0; const samples = new Float32Array(analyzer.fftSize);
      for (let i = 0; i < 8; i++) {
        await waitForAudioTime(context, context.currentTime + .05);
        analyzer.getFloatTimeDomainData(samples);
        for (const sample of samples) sum += sample * sample;
      }
      return Math.sqrt(sum / (samples.length * 8));
    };
    try {
      const off = await power(false), on = await power(true), restored = await power(false);
      return { off, ratio: on / off, restored: restored / off, nativeBus: engine.bwgBus.gain.value };
    } finally { splitter.disconnect(); analyzer.disconnect(); await engine.stop(); }
  }, makeBwgFixture(undefined, {
    5: constant(5000), 6: constant(5000),
  }));
  expect(result.off).toBeGreaterThan(.005);
  expect(Math.abs(result.ratio - 10 ** (-10 / 20))).toBeLessThan(.025);
  expect(result.restored).toBeGreaterThan(.9); expect(result.restored).toBeLessThan(1.1);
  expect(result.nativeBus).toBe(1);
});

test('native focus ducks noise and bound backgrounds without scaling tones, with exact worker parity', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const { BwgExportSource } = await import('/src/audio/bwg-export-source.ts');
    const preset = parseBwg(new Uint8Array(bytes)), rate = 8000, gain = 10 ** (-10 / 20);
    const rows = [];
    for (const bound of [false, true]) {
      const background = bound ? { name: 'Stereo original fixture', interval: false,
        sample: { rate, channels: [Float32Array.from({ length: 800 }, (_, i) => Math.sin(i * .1) * .4),
          Float32Array.from({ length: 800 }, (_, i) => Math.cos(i * .13) * .2)] } } : undefined;
      const render = (target: number) => {
        const renderer = new BwgRenderer(preset, rate, background); renderer.backgroundGain = target;
        const channels: [Float32Array, Float32Array] = [new Float32Array(rate * 2), new Float32Array(rate * 2)];
        renderer.render(channels[0], channels[1]); return channels;
      };
      const off = render(1), on = render(gain), tones = render(0);
      const worker = new BwgExportSource(preset, rate, [1], background, undefined, gain);
      let parity = 0, isolation = 0, backgroundPower = 0, tonePower = 0;
      try {
        const actual = await worker.read(0, rate * 2);
        for (let ear = 0; ear < 2; ear++) for (let i = rate; i < rate * 2; i++) {
          parity = Math.max(parity, Math.abs(actual[ear][i] - on[ear][i]));
          isolation = Math.max(isolation, Math.abs(on[ear][i] - (tones[ear][i] + (off[ear][i] - tones[ear][i]) * gain)));
          backgroundPower += (off[ear][i] - tones[ear][i]) ** 2; tonePower += tones[ear][i] ** 2;
        }
      } finally { worker.dispose(); }
      rows.push({ bound, parity, isolation, backgroundPower, tonePower });
    }
    const rejected = [];
    for (const gain of [-1, 1.1, NaN, Infinity]) {
      const worker = new BwgExportSource(preset, rate, [1], undefined, undefined, gain);
      try { await worker.ready; rejected.push(false); } catch { rejected.push(true); } finally { worker.dispose(); }
    }
    return { rows, rejected };
  }, makeBwgFixture(undefined, {
    0: constant(10000), 1: constant(10000),
    5: constant(5000), 6: constant(5000),
  }));
  for (const row of result.rows) {
    expect(row.parity).toBe(0); expect(row.isolation).toBeLessThan(2e-8);
    expect(row.backgroundPower).toBeGreaterThan(.01); expect(row.tonePower).toBeGreaterThan(.01);
  }
  expect(result.rejected).toEqual([true, true, true, true]);
});

test('native WAV export carries focus into its worker and restores the original background PCM', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { importBwg } = await import('/src/import/bwg.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const { renderWav } = await import('/src/audio/export.ts');
    const session = importBwg(new Uint8Array(bytes)).session;
    session.mode = 'mixed'; session.master = .1; session.tonesMuted = true; session.ambient = 'none';
    session.asmr = { focus: false, level: .5, layers: [{ ...makeAsmrLayer('air'), pan: -1, motion: 'still' }] };
    const render = async (focus: boolean) => {
      session.asmr!.focus = focus;
      return new DataView(await (await renderWav(session, 1.5)).arrayBuffer());
    };
    const off = await render(false), on = await render(true), restored = await render(false);
    let before = 0, after = 0, error = 0;
    for (let frame = 22050; frame < 66150; frame++) {
      const offset = 44 + frame * 4 + 2;
      before += off.getInt16(offset, true) ** 2; after += on.getInt16(offset, true) ** 2;
      error = Math.max(error, Math.abs(off.getInt16(offset, true) - restored.getInt16(offset, true)));
    }
    return { power: Math.sqrt(before / 44100), ratio: Math.sqrt(after / before), error };
  }, makeBwgFixture(undefined, {
    5: constant(5000), 6: constant(5000),
  }));
  expect(result.power).toBeGreaterThan(10);
  expect(result.ratio).toBeCloseTo(10 ** (-10 / 20), 3);
  expect(result.error).toBe(0);
});
