import { expect, test } from '@playwright/test';

test('boost doubles quiet WAV output through the protected master graph', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const { initialSession } = await import('/src/model.ts');
    const { renderWav } = await import('/src/audio/export.ts');
    const session = initialSession();
    session.minutes = 0; session.ambient = 'none'; session.master = 1; session.layers[0].level = .02;
    const energy = (data: Float32Array): number => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    const wavLevel = async (): Promise<number> => {
      const view = new DataView(await (await renderWav(session, 1.2)).arrayBuffer());
      const samples = new Float32Array(22050);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + (26460 + i) * 4, true) / 32768;
      return energy(samples);
    };
    const normalWav = await wavLevel(); session.volumeBoost = true; session.master = 2;
    const boostedWav = await wavLevel();
    return { normalWav, boostedWav };
  });
  expect(result.normalWav).toBeGreaterThan(.001); expect(result.boostedWav / result.normalWav).toBeCloseTo(2, 2);
});

test('@live boost doubles quiet playback and preserves master mute', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts'), { initialSession } = await import('/src/model.ts');
    const clockPath = '/tests/helpers/audio-clock.ts', { waitForAudioTime } = await import(clockPath);
    const session = initialSession();
    session.minutes = 0; session.ambient = 'none'; session.master = 1; session.volumeBoost = true; session.layers[0].level = .02;
    const energy = (data: Float32Array): number => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    const engine = new AudioEngine(); await engine.start(session);
    const internals = engine as unknown as { context: AudioContext; gate: GainNode };
    const splitter = internals.context.createChannelSplitter(2), analysers = [0, 1].map(ear => {
      const analyser = internals.context.createAnalyser(); analyser.fftSize = 8192; splitter.connect(analyser, ear); return analyser;
    });
    internals.gate.connect(splitter);
    const read = async (): Promise<number[]> => {
      await waitForAudioTime(internals.context, internals.context.currentTime + 1.25);
      return analysers.map(analyser => {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); return energy(samples);
      });
    };
    try {
      const normalLive = await read(), normalTime = internals.context.currentTime;
      session.master = 2; engine.update(session);
      const boostedLive = await read(), boostedTime = internals.context.currentTime;
      session.master = 0; engine.update(session);
      return { normalLive, boostedLive, normalTime, boostedTime, muted: await read() };
    } finally { internals.gate.disconnect(splitter); splitter.disconnect(); analysers.forEach(analyser => analyser.disconnect()); await engine.stop(); }
  });
  for (const ear of [0, 1]) {
    expect(result.normalLive[ear]).toBeGreaterThan(.001);
    expect(result.boostedLive[ear] / result.normalLive[ear], JSON.stringify(result)).toBeCloseTo(2, 1);
    expect(result.muted[ear]).toBeLessThan(.00001);
  }
});

test('WAV export encodes stereo PCM and preserves every ear route', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { initialSession } = await import('/src/model.ts');
    const results = [];
    for (const route of ['binaural', 'mixed', 'left', 'right']) {
      const session = initialSession();
      session.minutes = 0; session.ambient = 'none'; session.master = 0.5;
      Object.assign(session.layers[0], { level: 1, route, left: 200, right: 210 });
      const blob = await renderWav(session, 1.2);
      const bytes = await blob.arrayBuffer();
      const view = new DataView(bytes);
      const amplitude = (channel: number, hz: number): number => {
        let re = 0, im = 0;
        for (let i = 26460; i < 48510; i++) {
          const value = view.getInt16(44 + i * 4 + channel * 2, true) / 32768;
          re += value * Math.cos(2 * Math.PI * hz * i / 44100);
          im += value * Math.sin(2 * Math.PI * hz * i / 44100);
        }
        return 2 * Math.hypot(re, im) / 22050;
      };
      results.push({ route, type: blob.type, size: bytes.byteLength,
        header: new TextDecoder().decode(bytes.slice(0, 4)), channels: view.getUint16(22, true),
        rate: view.getUint32(24, true), bits: view.getUint16(34, true),
        amplitudes: [amplitude(0, 200), amplitude(0, 210), amplitude(1, 200), amplitude(1, 210)] });
    }
    return results;
  });
  const base = results[0].amplitudes[0];
  expect(base).toBeGreaterThan(0.1);
  expect(base).toBeLessThan(0.2);
  const expected = [[1, 0, 0, 1], [0.5, 0.5, 0.5, 0.5], [1, 0, 0, 0], [0, 0, 0, 1]];
  results.forEach((result, index) => {
    expect(result).toMatchObject({ type: 'audio/wav', header: 'RIFF', channels: 2, rate: 44100, bits: 16, size: 211724 });
    result.amplitudes.forEach((amplitude, channel) => expect(amplitude / base).toBeCloseTo(expected[index][channel], 3));
  });
});

test('export applies timeline automation, tone mute, master gain and timer fade', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { initialSession } = await import('/src/model.ts');
    const session = initialSession();
    session.minutes = 0; session.ambient = 'none'; session.master = 0.5;
    session.timelineDuration = 2;
    session.layers[0].level = 1;
    session.layers[0].automation = {
      left: [{ time: 0, value: 200, curve: 'step' }, { time: 1, value: 400, curve: 'step' }],
      right: [{ time: 0, value: 210, curve: 'step' }],
      leftLevel: [{ time: 0, value: 1, curve: 'step' }],
      rightLevel: [{ time: 0, value: 0, curve: 'step' }],
    };
    const view = new DataView(await (await renderWav(session, 2.2)).arrayBuffer());
    const energy = (start: number, end: number, channel = 0): number => {
      let sum = 0, count = 0;
      for (let frame = Math.round(start * 44100); frame < Math.round(end * 44100); frame++) {
        sum += (view.getInt16(44 + frame * 4 + channel * 2, true) / 32768) ** 2;
        count++;
      }
      return Math.sqrt(sum / count);
    };
    const amplitude = (hz: number, start: number): number => {
      let re = 0, im = 0;
      for (let i = Math.round(start * 44100); i < Math.round((start + 0.1) * 44100); i++) {
        const value = view.getInt16(44 + i * 4, true) / 32768;
        re += value * Math.cos(2 * Math.PI * hz * i / 44100);
        im += value * Math.sin(2 * Math.PI * hz * i / 44100);
      }
      return Math.hypot(re, im) / 4410;
    };
    session.tonesMuted = true;
    const muted = new Int16Array(await (await renderWav(session, 0.3)).arrayBuffer(), 44);
    session.tonesMuted = false; session.master = 0; session.ambient = 'white';
    const zero = new Int16Array(await (await renderWav(session, 0.3)).arrayBuffer(), 44);
    return { early: energy(0.7, 0.8), late: energy(1.8, 1.9), after: energy(2.05, 2.15),
      right: energy(0.6, 0.8, 1), oldBefore: amplitude(200, 0.7), newBefore: amplitude(400, 0.7),
      oldAfter: amplitude(200, 1.2), newAfter: amplitude(400, 1.2),
      muted: muted.every(value => value === 0), zero: zero.every(value => value === 0) };
  });
  expect(result.early).toBeGreaterThan(0.05);
  expect(result.late).toBeLessThan(result.early / 3);
  expect(result.after).toBe(0);
  expect(result.right).toBe(0);
  expect(result.oldBefore).toBeGreaterThan(result.newBefore * 10);
  expect(result.newAfter).toBeGreaterThan(result.oldAfter * 10);
  expect(result.muted).toBe(true);
  expect(result.zero).toBe(true);
});

test('all ordinary background choices export deterministic PCM and survive tone mute', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { initialSession, ambients } = await import('/src/model.ts');
    const session = initialSession();
    session.minutes = 0; session.tonesMuted = true; session.master = 1; session.ambientLevel = 1;
    const results = [];
    for (const ambient of ambients.filter((item: string) => item !== 'none')) {
      session.ambient = ambient;
      const first = new Uint8Array(await (await renderWav(session, 1)).arrayBuffer());
      const second = new Uint8Array(await (await renderWav(session, 1)).arrayBuffer());
      const view = new DataView(first.buffer);
      let peak = 0;
      for (let offset = 44; offset < first.length; offset += 2) peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
      results.push({ ambient, same: first.every((value, index) => value === second[index]), peak });
    }
    return results;
  });
  expect(result).toHaveLength(21);
  for (const item of result) {
    expect(item.same, item.ambient).toBe(true);
    expect(item.peak, item.ambient).toBeGreaterThan(0);
    expect(item.peak, item.ambient).toBeLessThan(32767);
  }
});

test('export rejects invalid sessions and duration bounds before rendering', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderWav, MAX_EXPORT_SECONDS } = await import('/src/audio/export.ts');
    const { initialSession } = await import('/src/model.ts');
    const session = initialSession();
    const errors = [];
    for (const seconds of [NaN, Infinity, -1, 0, 0.01, MAX_EXPORT_SECONDS + .01]) {
      try { await renderWav(session, seconds); } catch (error) { errors.push(String(error)); }
    }
    try { await renderWav({ ...session, bwg: { invalid: true } } as unknown as typeof session, 1); } catch (error) { errors.push(String(error)); }
    try { await renderWav({ ...session, master: NaN }, 1); } catch (error) { errors.push(String(error)); }
    const abort = new AbortController(); abort.abort();
    try { await renderWav(session, 1, abort.signal); } catch (error) { errors.push((error as Error).name); }
    const running = new AbortController();
    const pending = renderWav(session, 1, running.signal);
    running.abort();
    try { await pending; } catch (error) { errors.push((error as Error).name); }
    return errors;
  });
  expect(result).toHaveLength(10);
  expect(result.slice(0, 6).every(message => message.includes('duration'))).toBe(true);
  expect(result[6]).toContain('BWGen');
  expect(result[7]).toContain('Invalid preset');
  expect(result[8]).toBe('AbortError');
  expect(result[9]).toBe('AbortError');
});

test('audio export dialog downloads a real WAV and offers the selected local music', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { setupAudioExport } = await import('/src/export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    document.querySelector('#render-audio')?.remove();
    const button = document.createElement('button'); button.id = 'render-audio'; button.textContent = 'Test WAV';
    button.style.cssText = 'position:fixed;right:20px;top:20px;z-index:10000'; document.body.append(button);
    const session = initialSession(); session.minutes = 0; session.ambient = 'none';
    setupAudioExport({ session: () => session, music: () => undefined, notify: () => {} });
  });
  await page.locator('#render-audio').click();
  await expect(page.getByRole('dialog', { name: 'Export audio' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByLabel('Duration in seconds').fill('0.1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Render WAV' }).click();
  expect((await download).suggestedFilename()).toBe('Quiet morning.wav');
  await expect(page.locator('dialog[aria-label="Export audio"]')).toHaveCount(0);
  const message = await page.evaluate(async () => {
    const { setupAudioExport } = await import('/src/export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    document.querySelector('#render-audio')!.remove();
    const button = document.createElement('button'); button.id = 'render-audio'; document.body.append(button);
    const music = new File(['invalid'], 'Local track.wav');
    setupAudioExport({ session: initialSession, music: () => music, notify: () => {} });
    button.click();
    return document.querySelector('dialog[open] #export-music-info')!.textContent;
  });
  expect(message).toContain('Local track.wav');
  await expect(page.locator('dialog[open]').getByLabel('Include local music')).toBeChecked();
});

test('discard suppresses the WAV download while a browser render finishes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { setupAudioExport } = await import('/src/export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    document.querySelector('#render-audio')?.remove();
    const button = document.createElement('button'); button.id = 'render-audio'; button.textContent = 'Test WAV';
    button.style.cssText = 'position:fixed;right:20px;top:20px;z-index:10000'; document.body.append(button);
    setupAudioExport({ session: initialSession, music: () => undefined, notify: () => {} });
    const original = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function () {
      const result = await original.call(this);
      await new Promise(resolve => setTimeout(resolve, 300));
      return result;
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#render-audio').click();
  await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByLabel('Duration in seconds').fill('0.1');
  await page.getByRole('button', { name: 'Render WAV' }).click();
  await page.getByRole('button', { name: 'Discard export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export audio' })).toHaveCount(0);
  expect(downloads).toBe(0);
  await page.locator('#render-audio').click();
  await expect(page.getByRole('dialog', { name: 'Export audio' })).toBeVisible();
});
