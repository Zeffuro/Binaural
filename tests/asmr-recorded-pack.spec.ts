import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { loadAsmrExperience } from './helpers/asmr-discovery';
import type { AsmrSettings } from '../src/asmr-state';

interface PackRecipe {
  id: string; name: string; group: string; minutes: number; light: string; settings: AsmrSettings; freshIds: boolean;
}

const recordingIds = ['recorded-blanket', 'recorded-zipper', 'recorded-sketchbook',
  'recorded-sketching', 'recorded-mist', 'recorded-running-water'];
const presetIds = ['blanket-folds', 'blanket-left', 'blanket-right', 'zipper-details', 'pencil-studies',
  'sketchbook-turns', 'paper-and-pencil-hour', 'mist-at-the-temples', 'water-at-the-basin',
  'fresh-towels', 'unpacking-a-sketchbook', 'basin-and-cloth'];
const canonical = (settings: { layers: { id: string }[]; focus?: boolean }) =>
  ({ ...settings, focus: settings.focus ?? false, layers: settings.layers.map(({ id: _id, ...layer }) => layer) });

async function shared(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  const session = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    return readSharedSession(new URL(link).hash);
  }, link);
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  return { link, session };
}

test('all six original FLAC recordings decode natively and preserve paired waveform scale through the real loader', async ({ page }, testInfo) => {
  await page.goto('/');
  const results = await page.evaluate(async ids => {
    const assetsPath = '/src/audio/asmr-assets.ts', statePath = '/src/asmr-state.ts';
    const { prepareAsmrRecordings, recordedAsmrBuffer } = await import(assetsPath);
    const { recordedAsmrSounds, makeAsmrLayer } = await import(statePath), results = [];
    for (const id of ids) {
      const sound = recordedAsmrSounds.find((sound: { id: string }) => sound.id === id)!;
      const response = await fetch(`/audio/asmr/${sound.file}`), bytes = await response.arrayBuffer(), byteLength = bytes.byteLength;
      const native = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes);
      await prepareAsmrRecordings({ level: 1, layers: [makeAsmrLayer(id)] });
      const loaded: AudioBuffer = recordedAsmrBuffer(id), source = Array.from({ length: native.numberOfChannels }, (_, ear) => native.getChannelData(ear));
      const actual = Array.from({ length: loaded.numberOfChannels }, (_, ear) => loaded.getChannelData(ear));
      const first = Math.ceil(native.sampleRate * .05), last = native.length - first;
      let dot = 0, energy = 0, peak = 0, finite = true, difference = 0;
      const means = actual.map(data => data.reduce((sum, value) => sum + value, 0) / data.length);
      for (let frame = 0; frame < loaded.length; frame++) {
        peak = Math.max(peak, actual.reduce((sum, data) => sum + Math.abs(data[frame]), 0));
        for (let ear = 0; ear < actual.length; ear++) {
          finite &&= Number.isFinite(actual[ear][frame]);
          if (frame >= first && frame < last) { dot += actual[ear][frame] * source[ear][frame]; energy += source[ear][frame] ** 2; }
        }
        if (actual.length === 2) difference += (actual[0][frame] - actual[1][frame]) ** 2;
      }
      // Fit one scalar across both ears; an ear swap, collapse or channel-specific gain cannot pass.
      const gain = dot / energy; let residual = 0, sourceDifference = 0;
      for (let frame = first; frame < last; frame++) for (let ear = 0; ear < actual.length; ear++) {
        residual = Math.max(residual, Math.abs(actual[ear][frame] - source[ear][frame] * gain));
        if (ear === 1) sourceDifference += (source[0][frame] - source[1][frame]) ** 2;
      }
      results.push({ id, file: sound.file, bytes: byteLength, channels: loaded.numberOfChannels,
        nativeChannels: native.numberOfChannels, frames: loaded.length, nativeFrames: native.length,
        duration: loaded.duration, gain, residual, energy, peak, means, finite, difference, sourceDifference,
        edges: actual.every(data => data[0] === 0 && data.at(-1) === 0) });
    }
    return results;
  }, recordingIds);
  await testInfo.attach('original-flac-loader.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  const { clips } = JSON.parse(await readFile('public/audio/asmr/credits.json', 'utf8'));
  expect(results.map(result => result.id)).toEqual(recordingIds);
  for (const item of results) {
    const clip = clips.find((clip: { file: string }) => clip.file === item.file), diagnostic = JSON.stringify(item);
    expect(clip, item.id).toBeDefined(); expect(clip.format).toBe('FLAC');
    expect(item.channels, diagnostic).toBe(clip.channels); expect(item.nativeChannels).toBe(item.channels);
    expect(item.frames).toBe(item.nativeFrames); expect(Math.abs(item.duration - clip.durationSeconds)).toBeLessThan(.001);
    expect(item.bytes).toBe(clip.bytes); expect(item.bytes).toBeGreaterThan(0);
    expect(item.bytes).toBeLessThanOrEqual(2 * 1024 * 1024); expect(item.duration).toBeLessThanOrEqual(60);
    expect(item.finite).toBe(true); expect(item.edges).toBe(true); expect(item.energy, diagnostic).toBeGreaterThan(.01);
    expect(item.peak).toBeGreaterThan(.001); expect(item.peak).toBeLessThanOrEqual(.700001);
    expect(item.gain, diagnostic).toBeGreaterThan(0); expect(item.gain, diagnostic).toBeLessThanOrEqual(1.000001);
    expect(item.residual, diagnostic).toBeLessThan(.000001);
    for (const mean of item.means) expect(Math.abs(mean), diagnostic).toBeLessThan(.02);
    if (item.sourceDifference > .01) expect(item.difference, diagnostic).toBeGreaterThan(.001);
  }
});

test('all twelve everyday recording experiences keep source IDs, flow, duration and lights through discovery and session round trips', async ({ page }) => {
  test.setTimeout(180000); await page.goto('/');
  const recipes: PackRecipe[] = await page.evaluate(async () => {
    const path = '/src/asmr-recorded-experiences.ts', { asmrRecordedExperiences } = await import(path);
    return asmrRecordedExperiences.map((recipe: { id: string; name: string; group: string; minutes: number; light: string; make: () => any }) => {
      const settings = recipe.make(), again = recipe.make();
      return { id: recipe.id, name: recipe.name, group: recipe.group, minutes: recipe.minutes, light: recipe.light, settings,
        freshIds: settings.layers.every((layer: { id: string }, index: number) => layer.id !== again.layers[index].id) };
    });
  });
  expect(recipes.map(recipe => recipe.id)).toEqual(presetIds);
  expect(recipes.map(recipe => recipe.minutes)).toEqual([30, 20, 20, 20, 45, 30, 60, 30, 30, 45, 45, 60]);
  expect([...new Set(recipes.flatMap(recipe => recipe.settings.layers.map((layer: { sound: string }) => layer.sound)))].sort()).toEqual([...recordingIds].sort());
  expect(recipes.flatMap(recipe => recipe.settings.layers).filter(layer => layer.spatial)).toHaveLength(1);
  for (const recipe of recipes) {
    expect(recipe.group).toBe('Everyday recordings'); expect(recipe.freshIds).toBe(true); expect(recipe.light).toMatch(/^gesture-/);
    expect(recipe.settings.layers.length).toBeGreaterThanOrEqual(1); expect(recipe.settings.layers.length).toBeLessThanOrEqual(2);
    const variation = recipe.settings.variation!;
    expect(variation.mode).toMatch(/^(natural|turns)$/); expect(variation.seed).toBeGreaterThan(0);
    expect(variation.phraseSeconds).toBeGreaterThanOrEqual(4); expect(variation.turnSeconds).toBe(90);
    for (const layer of recipe.settings.layers) expect(recordingIds, recipe.id).toContain(layer.sound);
    await page.locator('#asmr-browse').click(); await page.locator('#preset-search').fill('Everyday recordings');
    await expect(page.locator('.explore-card')).toHaveCount(12);
    const favorite = page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true });
    await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-load-preset="asmr-${recipe.id}"]`).click();
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.locator('#playing-title')).toHaveText(recipe.name); await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    for (const [index, layer] of recipe.settings.layers.entries()) await expect(page.getByLabel(`Sound ${index + 1} trigger`, { exact: true })).toHaveValue(layer.sound);
    await expect(page.locator('#status')).toHaveText('Ready when you are'); await expect(page.locator('#trigger-enable')).not.toBeChecked();
    const { link, session } = await shared(page);
    expect(session.mode, recipe.id).toBe('asmr'); expect(session.minutes, recipe.id).toBe(recipe.minutes);
    expect(canonical(session.asmr), recipe.id).toEqual(canonical(recipe.settings));
    expect(session.visual.triggers.brightness).toBe(.3); expect(session.visual.triggers).not.toHaveProperty('enabled');
    await loadAsmrExperience(page, recipe.id);
    await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.locator('#trigger-enable')).toBeChecked();
    await page.locator('#preset-name').fill(recipe.name); await page.locator('#save-preset').click();
    const saved = await page.evaluate(name => JSON.parse(localStorage.getItem('binaural.presets.v1')!).find((entry: { name: string }) => entry.name === name), recipe.name);
    expect(canonical(saved.asmr), recipe.id).toEqual(canonical(recipe.settings));
    await page.reload(); await page.locator('#asmr-browse').click(); await page.locator('#preset-favorites').check();
    await expect(page.getByRole('button', { name: `Favorite: ${recipe.name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#close-explorer').click(); await page.locator('.saved-preset').filter({ hasText: recipe.name }).click();
    await expect(page.locator('#trigger-enable')).not.toBeChecked();
    expect(canonical((await shared(page)).session.asmr), recipe.id).toEqual(canonical(recipe.settings));
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.locator('#notice')).toContainText('Shared session loaded');
    await expect(page.locator('#minutes')).toHaveValue(String(recipe.minutes));
    expect(canonical((await shared(page)).session.asmr), recipe.id).toEqual(canonical(recipe.settings));
    if (await page.locator('#asmr-mixer').getAttribute('open') === null) await page.locator('#asmr-mixer > summary').click();
    await page.locator('#asmr-level').focus();
    await page.locator('#asmr-level').evaluate((element: HTMLInputElement) => {
      element.value = '0.11'; element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#asmr-level')).toHaveValue('0.11');
    await page.locator('#import-file').setInputFiles({ name: `${recipe.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await expect(page.locator('#import-file')).toHaveValue(''); await expect(page.locator('#asmr-level')).toHaveValue('0.5');
    const imported = (await shared(page)).session;
    expect(canonical(imported.asmr), recipe.id).toEqual(canonical(recipe.settings)); expect(imported.visual).toEqual(session.visual);
    await expect(page.locator('#status')).toHaveText('Ready when you are'); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  }
});

test('actual original recordings retain seeded turns and room tails across every frame of sectioned 31 second WAV and FLAC', async ({ page }, testInfo) => {
  test.setTimeout(180000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', graphPath = '/src/audio/export-graph.ts';
    const exportPath = '/src/audio/export.ts', assetsPath = '/src/audio/asmr-assets.ts';
    const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { exportGraph } = await import(graphPath), { renderWav, renderFlac } = await import(exportPath);
    const { prepareAsmrRecordings } = await import(assetsPath), rate = 44100, frames = 31 * rate;
    const session = initialSession(); session.mode = 'asmr'; session.minutes = 0; session.master = .8; session.ambient = 'none';
    session.asmr = { level: .5, space: { amount: .18, size: 1.2, warmth: .65 },
      variation: { mode: 'turns', seed: 6733, amount: .7, phraseSeconds: 6, turnSeconds: 15 }, layers: [
        { ...makeAsmrLayer('recorded-blanket'), level: .55, pan: -.8, motion: 'still', tone: .7, rate: .85 },
        { ...makeAsmrLayer('recorded-sketching'), level: .5, pan: .8, motion: 'still', tone: .8, rate: .95 },
      ] };
    await prepareAsmrRecordings(session.asmr);
    const context = new OfflineAudioContext(2, frames, rate), cleanup = exportGraph(context, session, 0, undefined);
    const full = await context.startRendering(); cleanup();
    const wav = new DataView(await (await renderWav(session, 31)).arrayBuffer());
    const flac = await new OfflineAudioContext(2, 1, rate).decodeAudioData(await (await renderFlac(session, 31)).arrayBuffer());
    let wavError = 0, flacError = 0, boundaryError = 0, energy = 0, peak = 0, finite = true;
    const turns = Array.from({ length: 2 }, () => [0, 0]);
    for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < 2; ear++) {
      const expected = full.getChannelData(ear)[frame], a = wav.getInt16(44 + frame * 4 + ear * 2, true) / 32768;
      const b = flac.getChannelData(ear)[frame], error = Math.max(Math.abs(a - expected), Math.abs(b - expected));
      wavError = Math.max(wavError, Math.abs(a - expected)); flacError = Math.max(flacError, Math.abs(b - expected));
      if (Math.abs(frame / rate - 30) < .1) boundaryError = Math.max(boundaryError, error);
      finite &&= Number.isFinite(expected) && Number.isFinite(a) && Number.isFinite(b);
      energy += expected ** 2; peak = Math.max(peak, Math.abs(expected));
      if (frame > 3 * rate && frame < 12 * rate) turns[0][ear] += expected ** 2;
      if (frame > 18 * rate && frame < 27 * rate) turns[1][ear] += expected ** 2;
    }
    return { wavError, flacError, boundaryError, energy, peak, finite, turns, wavBytes: wav.byteLength,
      flacFrames: flac.length, flacChannels: flac.numberOfChannels };
  });
  await testInfo.attach('original-recording-section-parity.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const diagnostic = JSON.stringify(result);
  expect(result.wavBytes).toBe(44 + 31 * 44100 * 4); expect(result.flacFrames).toBe(31 * 44100); expect(result.flacChannels).toBe(2);
  expect(result.finite).toBe(true); expect(result.energy, diagnostic).toBeGreaterThan(.1); expect(result.peak).toBeLessThan(1);
  expect(result.wavError, diagnostic).toBeLessThan(.00015); expect(result.flacError, diagnostic).toBeLessThan(.00015);
  expect(result.boundaryError, diagnostic).toBeLessThan(.00015);
  for (const turn of result.turns) expect(Math.max(...turn), diagnostic).toBeGreaterThan(Math.min(...turn) * 2);
  expect((result.turns[0][0] - result.turns[0][1]) * (result.turns[1][0] - result.turns[1][1]), diagnostic).toBeLessThan(0);
});

test('@live original FLAC preview stops while loading, rejects a 503 and retries with real stereo audio-clock progress', async ({ page }, testInfo) => {
  test.setTimeout(60000); let release!: () => void, seen = false;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/audio/asmr/blanket-movement.flac', async route => { seen = true; await blocked; await route.continue(); });
  await page.goto('/'); await page.locator('h1').click();
  await page.evaluate(async () => {
    const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts', previewPath = '/src/audio/asmr-preview.ts';
    const enginePath = '/src/audio/engine.ts', clockPath = '/tests/helpers/audio-clock.ts';
    const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const { AsmrPreview } = await import(previewPath), { AudioEngine } = await import(enginePath);
    const { waitForAudioTime } = await import(clockPath), session = initialSession(), engines: any[] = [];
    session.mode = 'asmr'; session.minutes = 0; session.master = .4; session.ambient = 'none';
    session.asmr = { level: .5, layers: [{ ...makeAsmrLayer('recorded-blanket'), motion: 'still', level: .7 }] };
    const preview = new AsmrPreview(() => {}, () => { const engine = new AudioEngine(); engines.push(engine); return engine; });
    Object.assign(window, { originalPreview: { session, preview, engines, waitForAudioTime } });
    (window as any).originalPreview.pending = preview.start(session, session.asmr.layers[0].id);
  });
  try {
    await expect.poll(() => seen).toBe(true); await page.evaluate(async () => (window as any).originalPreview.preview.stop());
    release(); await page.evaluate(async () => (window as any).originalPreview.pending);
    expect(await page.evaluate(() => (window as any).originalPreview.preview.state.phase)).toBe('idle');
    expect(await page.evaluate(() => (window as any).originalPreview.engines.every((engine: any) => !engine.context || engine.context.state === 'closed'))).toBe(true);
    let fail = true, attempts = 0;
    await page.route('**/audio/asmr/zipper-slide.flac', route => { attempts++; return fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(); });
    const error = await page.evaluate(async () => {
      const { session, preview } = (window as any).originalPreview; session.asmr.layers[0].sound = 'recorded-zipper';
      try { await preview.start(session, session.asmr.layers[0].id); return 'Unexpected successful preview'; }
      catch (failure) { return (failure as Error).message; }
    });
    expect(error).toContain('Could not load Zipper touches');
    expect(await page.evaluate(() => (window as any).originalPreview.preview.state.phase)).toBe('idle');
    expect(await page.evaluate(() => (window as any).originalPreview.preview.state.error)).toBe(error);
    fail = false;
    const result = await page.evaluate(async () => {
      const { session, preview, engines, waitForAudioTime } = (window as any).originalPreview;
      await preview.start(session, session.asmr.layers[0].id);
      const engine = engines.at(-1), context: AudioContext = engine.context, split = context.createChannelSplitter(2);
      const taps = [context.createAnalyser(), context.createAnalyser()]; engine.transport.connect(split);
      taps.forEach((tap, ear) => { tap.fftSize = 8192; split.connect(tap, ear); });
      const began = context.currentTime, ears = taps.map(() => ({ finite: true, energy: 0, peak: 0 }));
      for (let step = 1; step <= 8; step++) {
        await waitForAudioTime(context, began + step * .25, 10000);
        taps.forEach((tap, ear) => { const pcm = new Float32Array(8192); tap.getFloatTimeDomainData(pcm);
          ears[ear].finite &&= pcm.every(Number.isFinite);
          ears[ear].energy += pcm.reduce((sum, value) => sum + value ** 2, 0);
          ears[ear].peak = Math.max(ears[ear].peak, ...pcm.map(Math.abs)); });
      }
      const phase = preview.state.phase, progress = context.currentTime - began;
      await preview.stop(); split.disconnect(); taps.forEach(tap => tap.disconnect());
      return { ears, progress, phase, stopped: preview.state.phase, closed: context.state };
    });
    await testInfo.attach('original-recording-preview.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(attempts).toBe(2); expect(result.phase).toBe('playing'); expect(result.progress).toBeGreaterThanOrEqual(2);
    for (const ear of result.ears) { expect(ear.finite).toBe(true); expect(ear.energy).toBeGreaterThan(.000001); expect(ear.peak).toBeLessThan(1); }
    expect(result.stopped).toBe('idle'); expect(result.closed).toBe('closed');
  } finally { release(); await page.evaluate(async () => (window as any).originalPreview?.preview.stop()); }
});

test('everyday recording discovery and native 3D controls fit 320px and remain keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    await page.locator('#asmr-browse').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#preset-search')).toBeFocused(); await page.locator('#preset-search').fill('Everyday recordings');
    await expect(page.locator('.explore-card')).toHaveCount(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#preset-explorer').analyze()).violations).toEqual([]);
    const load = page.locator('[data-load-preset="asmr-mist-at-the-temples"]'); await load.focus(); await page.keyboard.press('Enter');
    const decline = page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Not now', exact: true });
    await decline.focus(); await page.keyboard.press('Enter');
    if (await page.locator('.asmr-advanced').getAttribute('open') === null) {
      await page.locator('.asmr-advanced summary').focus(); await page.keyboard.press('Enter');
    }
    await expect(page.getByLabel('Sound 1 sound space', { exact: true })).toHaveValue('hrtf');
    await expect(page.getByLabel('Sound 1 headphone profile', { exact: true })).toHaveValue('native');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
    await expect(page.locator('#status')).toHaveText('Ready when you are'); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  }
});
