import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeBwgFixture } from './helpers/bwg';

const point = (value: number, position = 0, weight = 10) => ({ value, position, weight });
const program = makeBwgFixture([{ voices: 1, length: .2, repeats: 2 }, { voices: 1, length: .2, repeats: 1 }], {
  0: [point(1800), point(5800, 10000, 17)],
  2: [point(40), point(70, 10000)],
  3: [point(100), point(140, 10000)],
  36: [point(9000), point(21000, 10000, 19)],
  37: [point(19000), point(49000, 10000, 3)],
  43: [point(900), point(1900, 10000)],
  45: [point(6500), point(1500, 10000)],
});

test('a WAV longer than three minutes has bounded sections, exact frames and continuous tone phase', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { initialSession } = await import('/src/model.ts');
    const original = OfflineAudioContext.prototype.startRendering, lengths: number[] = [];
    OfflineAudioContext.prototype.startRendering = function () { lengths.push(this.length); return original.call(this); };
    try {
      const session = initialSession(); session.minutes = 0; session.ambient = 'none'; session.master = .2;
      Object.assign(session.layers[0], { left: 203.125, right: 219.375, level: 1 });
      const progress: number[] = [];
      const data = await (await renderWav(session, 181, undefined, value => progress.push(value.fraction))).arrayBuffer();
      const view = new DataView(data), rate = 44100;
      const amplitude = (time: number, ear: number, hz: number) => {
        let real = 0, imaginary = 0;
        for (let i = Math.round(time * rate); i < Math.round((time + .8) * rate); i++) {
          const sample = view.getInt16(44 + i * 4 + ear * 2, true) / 32768, angle = 2 * Math.PI * hz * i / rate;
          real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle);
        }
        return 2 * Math.hypot(real, imaginary) / (.8 * rate);
      };
      const windows = [.7, 29.6, 59.6, 89.6, 119.6, 149.6, 179.6, 180.2];
      return { size: data.byteLength, declared: view.getUint32(40, true), riff: view.getUint32(4, true), lengths, progress,
        energy: windows.map(time => [amplitude(time, 0, 203.125), amplitude(time, 1, 219.375)]),
        leakage: amplitude(179.6, 0, 219.375) };
    } finally { OfflineAudioContext.prototype.startRendering = original; }
  });
  expect(result.size).toBe(44 + 181 * 44100 * 4);
  expect(result.declared).toBe(result.size - 44); expect(result.riff).toBe(result.size - 8);
  expect(result.lengths).toHaveLength(7); expect(Math.max(...result.lengths)).toBeLessThan(33.5 * 44100);
  result.lengths.forEach((length, index) => {
    const cursor = index * 30 * 44100, count = Math.min(30 * 44100, 181 * 44100 - cursor);
    const origin = cursor + count - length;
    expect(origin % 128).toBe(0);
    expect(origin * 24000 / 44100).toBe(Math.round(origin * 24000 / 44100));
    if (index) { expect(cursor - origin).toBeGreaterThanOrEqual(3 * 44100); expect(cursor - origin).toBeLessThan(3.5 * 44100); }
  });
  expect(result.progress[0]).toBe(0); expect(result.progress.at(-1)).toBe(1);
  expect(result.progress.every((value, index) => !index || value >= result.progress[index - 1])).toBe(true);
  for (const ears of result.energy) for (const amplitude of ears) expect(amplitude).toBeGreaterThan(.04);
  expect(result.leakage).toBeLessThan(.0001);
});

for (const native of [false, true]) test(`chunked ${native ? 'BWGen' : 'mixed'} WAV follows a whole render at the seam and timer end`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async ({ native, bytes }) => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { exportGraph } = await import('/src/audio/export-graph.ts');
    const { initialSession } = await import('/src/model.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const { BwgRenderer } = await import('/src/audio/bwg-renderer.ts');
    const { makeAsmrLayer } = await import('/src/asmr-state.ts');
    const session = native ? importBwg(new Uint8Array(bytes)).session : initialSession();
    const end = native ? 36 : 32;
    session.master = .25; session.minutes = 0; session.timelineDuration = end;
    session.mode = 'mixed'; session.ambient = 'ocean'; session.ambientLevel = .2;
    session.asmr = { level: .4, layers: [{ ...makeAsmrLayer('cupping'), rate: 1.3, period: 2.7,
      motion: 'wander', pressure: .8, pressurePhase: 80 }] };
    const rate = 44100, frames = (end + 2) * rate;
    let raw: [Float32Array, Float32Array] | undefined;
    if (session.bwg) {
      const renderer = new BwgRenderer(decodeBwg(session.bwg).preset, rate);
      renderer.levels = session.layers.map(layer => layer.level);
      raw = [new Float32Array(frames), new Float32Array(frames)]; renderer.render(raw[0], raw[1]);
    }
    const context = new OfflineAudioContext(2, frames, rate), cleanup = exportGraph(context, session, 0, end, raw);
    const whole = await context.startRendering(); cleanup();
    const expected = [whole.getChannelData(0), whole.getChannelData(1)];
    const view = new DataView(await (await renderWav(session, end + 2)).arrayBuffer());
    let error = 0, energy = 0, peak = 0, after = 0;
    for (let ear = 0; ear < 2; ear++) for (let i = Math.round(29.95 * rate); i < frames; i++) {
      const actual = view.getInt16(44 + i * 4 + ear * 2, true) / 32768;
      const difference = actual - expected[ear][i];
      if (i < end * rate) { error += difference ** 2; energy += expected[ear][i] ** 2; peak = Math.max(peak, Math.abs(difference)); }
      if (i > (end + .05) * rate) after = Math.max(after, Math.abs(actual));
    }
    return { relative: Math.sqrt(error / energy), peak, energy, after };
  }, { native, bytes: program });
  expect(result.energy).toBeGreaterThan(.01); expect(result.relative).toBeLessThan(.03);
  expect(result.peak).toBeLessThan(.006); expect(result.after).toBe(0);
});

test('BWGen WAV respects final hold, voice masking, whole-bus mute and ASMR-only mode', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const session = importBwg(new Uint8Array(bytes)).session;
    session.master = .2;
    const peak = async () => {
      const view = new DataView(await (await renderWav(session, 3)).arrayBuffer());
      let result = 0;
      for (let i = 2 * 44100; i < 3 * 44100; i++) result = Math.max(result, Math.abs(view.getInt16(44 + i * 4, true)));
      return result;
    };
    const finite = await peak();
    const modified = new Uint8Array(bytes); modified[1760] = 1;
    session.bwg = importBwg(modified).session.bwg;
    const hold = await peak(); session.tonesMuted = true;
    const voicesMuted = await peak(); session.bwgMuted = true;
    const busMuted = await peak(); session.bwgMuted = false; session.mode = 'asmr';
    const asmrOnly = await peak();
    return { finite, hold, voicesMuted, busMuted, asmrOnly };
  }, makeBwgFixture([{ voices: 1, length: .02, repeats: 1 }], {
    5: [point(1800), point(1800, 10000)], 6: [point(1800), point(1800, 10000)],
  }));
  expect(result.finite).toBe(0); expect(result.hold).toBeGreaterThan(100);
  expect(result.voicesMuted).toBeGreaterThan(0); expect(result.voicesMuted).toBeLessThan(result.hold);
  expect(result.busMuted).toBe(0); expect(result.asmrOnly).toBe(0);
});

test('native WAV resolves generated and locally bound background sounds with the saved source preference', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async bytes => {
    const { renderWav } = await import('/src/audio/export.ts');
    const { wavHeader, wavPcm } = await import('/src/audio/wav-encoding.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const { backgroundAssets } = await import('/src/background-assets.ts');
    const input = new Uint8Array(bytes);
    input.set(new TextEncoder().encode('bkgnd.dll'), 1320); new DataView(input.buffer).setUint32(1316, 2, true);
    const session = importBwg(input).session; session.tonesMuted = true;
    const render = async () => new Uint8Array(await (await renderWav(session, .7)).arrayBuffer());
    session.bwgBackgroundSource = 'generated'; const generated = await render();
    session.bwgBackgroundSource = 'recording'; const missing = await render();
    const sample = Float32Array.from({ length: 11025 }, (_, i) => Math.sin(i * 2 * Math.PI * 330 / 44100) * .25);
    const file = new File([wavHeader(sample.length), wavPcm(sample, sample)], 'original-recording.wav', { type: 'audio/wav' });
    await backgroundAssets.bindWave(decodeBwg(session.bwg).preset, file);
    const recording = await render(); session.bwgBackgroundSource = 'auto'; const auto = await render();
    session.bwgBackgroundSource = 'generated'; const explicit = await render();
    session.bwgMuted = true; const muted = await render();
    const audible = (bytes: Uint8Array) => bytes.subarray(44).some(value => value !== 0);
    const same = (a: Uint8Array, b: Uint8Array) => a.every((value, index) => value === b[index]);
    return { generated: audible(generated), recording: audible(recording), missing: audible(missing), muted: audible(muted),
      auto: same(recording, auto), explicit: same(generated, explicit), distinct: !same(generated, recording), bound: backgroundAssets.count };
  }, makeBwgFixture([{ voices: 1, length: .2, repeats: 1 }], {
    0: [point(8000), point(8000, 10000)], 1: [point(8000), point(8000, 10000)],
  }));
  expect(result).toEqual({ generated: true, recording: true, missing: false, muted: false, auto: true, explicit: true, distinct: true, bound: 1 });
});

test('streamed WAV has exact download bytes and aborts its writer on cancellation or write/close failure', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderWav, writeWav } = await import('/src/audio/export.ts');
    const { initialSession } = await import('/src/model.ts');
    const session = initialSession(); session.minutes = 0; session.ambient = 'none';
    const parts: ArrayBuffer[] = []; let closed = 0, aborted = 0;
    const writer = { write: async (bytes: ArrayBuffer) => { parts.push(bytes); },
      close: async () => { closed++; }, abort: async () => { aborted++; } };
    const seconds = 30 + 1 / 44100;
    await writeWav(session, seconds, writer);
    const file = new Uint8Array(await new Blob(parts).arrayBuffer());
    const download = new Uint8Array(await (await renderWav(session, seconds)).arrayBuffer());
    const cases = [];
    for (const failure of ['cancel', 'write', 'close']) {
      const controller = new AbortController(); let closes = 0, aborts = 0, writes = 0;
      let name = '', message = '';
      try {
        await writeWav(session, failure === 'cancel' ? 61 : .1, {
          write: async () => { writes++; if (failure === 'write' && writes === 2) throw new Error('Storage full'); },
          close: async () => { closes++; if (failure === 'close') throw new Error('Commit failed'); },
          abort: async () => { aborts++; },
        }, { signal: controller.signal, onProgress: value => { if (failure === 'cancel' && value.completedFrames > 0) controller.abort(); } });
      } catch (error) { name = (error as Error).name; message = (error as Error).message; }
      cases.push({ failure, closes, aborts, writes, name, message });
    }
    return { closed, aborted, same: file.length === download.length && file.every((value, index) => value === download[index]), cases };
  });
  expect(result).toMatchObject({ closed: 1, aborted: 0, same: true });
  expect(result.cases[0]).toMatchObject({ name: 'AbortError', closes: 0, aborts: 1, writes: 2 });
  expect(result.cases[1]).toMatchObject({ message: 'Storage full', closes: 0, aborts: 1 });
  expect(result.cases[2]).toMatchObject({ message: 'Commit failed', closes: 1, aborts: 1 });
});

test('three-hour streaming stays bounded and validates RIFF limits and non-finite PCM', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { writeWav, renderWav, MAX_EXPORT_SECONDS, MAX_FILE_EXPORT_SECONDS } = await import('/src/audio/export.ts');
    const { wavHeader, wavBytes, wavPcm } = await import('/src/audio/wav-encoding.ts');
    const { initialSession } = await import('/src/model.ts');
    const session = initialSession(); session.master = 0; session.minutes = 0;
    const controller = new AbortController(); let header: DataView | undefined, maximum = 0, closed = 0, aborted = 0;
    const errors: string[] = [];
    try {
      await writeWav(session, MAX_FILE_EXPORT_SECONDS, {
        write: async bytes => { if (!header) header = new DataView(bytes); else maximum = Math.max(maximum, bytes.byteLength); },
        close: async () => { closed++; }, abort: async () => { aborted++; },
      }, { signal: controller.signal, onProgress: value => { if (value.completedFrames) controller.abort(); } });
    } catch (error) { errors.push((error as Error).name); }
    for (const call of [() => renderWav(session, MAX_EXPORT_SECONDS + 1),
      () => wavBytes(MAX_FILE_EXPORT_SECONDS + 1), () => wavHeader(2 ** 32),
      () => wavPcm(new Float32Array([NaN]), new Float32Array(1)),
      () => wavPcm(new Float32Array(1), new Float32Array(1), 1, 1)]) {
      try { await call(); } catch (error) { errors.push((error as Error).message); }
    }
    const pcm = new DataView(wavPcm(new Float32Array([-2, 2]), new Float32Array([.5, -.5])));
    return { maximum, closed, aborted, errors, size: header!.getUint32(40, true) + 44,
      expected: wavBytes(10800), pcm: [0, 2, 4, 6].map(offset => pcm.getInt16(offset, true)) };
  });
  expect(result.maximum).toBeLessThanOrEqual(30 * 44100 * 4);
  expect(result.size).toBe(44 + 10800 * 44100 * 4); expect(result.size).toBe(result.expected);
  expect(result).toMatchObject({ closed: 0, aborted: 1, pcm: [-32768, 16384, 32767, -16384] });
  expect(result.errors).toHaveLength(6); expect(result.errors[0]).toBe('AbortError');
});

test('export dialog offers full sessions, file estimates and direct saving without a download', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { setupAudioExport } = await import('/src/export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    const session = initialSession(); session.minutes = 90; session.ambient = 'none';
    const saved = { parts: [] as ArrayBuffer[], closed: 0, aborted: 0, notice: '' };
    Object.assign(window, { exportSaved: saved });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => ({
      write: async (bytes: ArrayBuffer) => { saved.parts.push(bytes); }, close: async () => {
        await new Promise<void>(resolve => { Object.assign(window, { finishExportSave: resolve }); }); saved.closed++;
      },
      abort: async () => { saved.aborted++; },
    }) }) });
    document.querySelector('#render-audio')?.remove();
    const button = document.createElement('button'); button.id = 'render-audio'; button.textContent = 'Test WAV';
    button.style.cssText = 'position:fixed;right:20px;top:20px;z-index:10000'; document.body.append(button);
    setupAudioExport({ session: () => session, music: () => undefined, notify: message => { saved.notice = message; } });
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#render-audio').click();
  const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true }), duration = dialog.getByLabel('Duration in seconds');
  await expect(dialog.getByLabel('Save directly to a file')).toBeChecked();
  await expect(duration).toHaveValue('5400'); await expect(duration).toHaveAttribute('max', '10800');
  await dialog.getByLabel('Save directly to a file').uncheck();
  await expect(duration).toHaveValue('3600'); await expect(dialog.getByRole('button', { name: 'Full session', exact: true })).toBeDisabled();
  await dialog.getByLabel('Save directly to a file').check();
  await dialog.getByRole('button', { name: 'Full session', exact: true }).click(); await expect(duration).toHaveValue('5400');
  await expect(dialog.locator('#export-estimate')).toContainText('908.4 MiB');
  await duration.fill('.1'); await dialog.getByRole('button', { name: 'Render WAV', exact: true }).click();
  await expect(dialog.locator('#audio-export-status')).toHaveText('Finishing the saved file…');
  await expect(dialog.getByRole('button', { name: 'Discard export', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishExportSave?: unknown }).finishExportSave)).toBe('function');
  await page.evaluate(() => (window as unknown as { finishExportSave: () => void }).finishExportSave());
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const saved = (window as unknown as { exportSaved: { parts: ArrayBuffer[]; closed: number; aborted: number; notice: string } }).exportSaved;
    const bytes = await new Blob(saved.parts).arrayBuffer();
    return { closed: saved.closed, aborted: saved.aborted, notice: saved.notice, size: bytes.byteLength,
      header: new TextDecoder().decode(bytes.slice(0, 4)) };
  });
  expect(downloads).toBe(0); expect(result).toMatchObject({ closed: 1, aborted: 0, header: 'RIFF', size: 17684, notice: 'WAV file saved.' });
});

for (const colorScheme of ['light', 'dark'] as const) test(`${colorScheme} export dialog fits narrow screens and remains accessible`, async ({ page }) => {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' }); await page.goto('/');
  await page.locator('#render-audio').click();
  const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
  await expect(dialog).toBeVisible();
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await dialog.getByLabel('File format').selectOption('flac');
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.locator('#render-audio')).toBeFocused();
});

