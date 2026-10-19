import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';
import { makeWaveFixture } from './helpers/wave';

function preset(): number[] {
  const fixed = (value: number) => [{ value, position: 0 }, { value, position: 10000 }];
  const bytes = new Uint8Array(makeBwgFixture(undefined, { 0: fixed(10000), 1: fixed(10000), 39: fixed(0) }));
  new DataView(bytes.buffer).setUint32(1316, 1, true);
  bytes.set(new TextEncoder().encode('Bkgnd.dll'), 1320);
  return Array.from(bytes);
}

test('every known background resolves to an original approximation without imported assets', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { BackgroundAssets } = await import('/src/background-assets.ts');
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { packEntries, backgroundReference } = await import('/src/import/bwg-background.ts');
    const assets = new BackgroundAssets(); await assets.ready; await assets.clear();
    const results = [];
    for (const file of ['Bkgnd.dll', 'Bgextra.dll']) {
      for (const entry of packEntries(file)) {
        const bytes = new Uint8Array(data);
        bytes.fill(0, 1320, 1580); bytes.set(new TextEncoder().encode(file), 1320);
        new DataView(bytes.buffer).setUint32(1316, entry.id, true);
        const preset = parseBwg(bytes), reference = backgroundReference(preset);
        const background = await assets.resolve(preset);
        results.push({ id: reference.approximation, name: background.name, kind: background.kind,
          interval: background.interval, expectedInterval: reference.interval,
          rate: background.sample.rate, nonzero: background.sample.channels[0].some(value => value !== 0),
          noRecording: !await assets.resolve(preset, 'recording') });
      }
    }
    const unknown = parseBwg(new Uint8Array(data)); unknown.background = 'custom.wav';
    return { results, count: assets.count, unknown: await assets.resolve(unknown), unknownGenerated: await assets.resolve(unknown, 'generated') };
  }, preset());
  expect(result.results).toHaveLength(17);
  expect(new Set(result.results.map(row => row.id)).size).toBe(17);
  expect(result.results.every(row => row.kind === 'generated' && row.rate === 24000 && row.nonzero && row.noRecording && row.interval === row.expectedInterval)).toBe(true);
  expect(result.count).toBe(0);
  expect(result.unknown).toBeUndefined();
  expect(result.unknownGenerated).toBeUndefined();
});

test('automatic source prefers imported recordings and explicit choices survive preset JSON', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ data, wave }) => {
    const { BackgroundAssets } = await import('/src/background-assets.ts');
    const { parseBwg } = await import('/src/import/bwg-format.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { parseSession } = await import('/src/model.ts');
    const assets = new BackgroundAssets(), preset = parseBwg(new Uint8Array(data));
    await assets.bindWave(preset, new File([new Uint8Array(wave)], 'own.wav'));
    const auto = await assets.resolve(preset), generated = await assets.resolve(preset, 'generated'), recording = await assets.resolve(preset, 'recording');
    const session = importBwg(new Uint8Array(data)).session;
    const policies = ['auto', 'generated', 'recording'].map(source => parseSession(JSON.parse(JSON.stringify({ ...session, bwgBackgroundSource: source }))).bwgBackgroundSource);
    const rejects = [null, false, {}, ['auto'], 'other'].map(source => {
      try { parseSession({ ...session, bwgBackgroundSource: source }); return false; } catch { return true; }
    });
    await assets.clear();
    return { auto: auto.kind, generated: generated.kind, recording: recording.kind, count: assets.count, policies, rejects,
      fallback: (await assets.resolve(preset)).kind, missing: !await assets.resolve(preset, 'recording') };
  }, { data: preset(), wave: makeWaveFixture().bytes });
  expect(result).toEqual({ auto: 'recording', generated: 'generated', recording: 'recording', count: 0,
    policies: ['auto', 'generated', 'recording'], rejects: [true, true, true, true, true], fallback: 'generated', missing: true });
});

test('generated alternatives are selectable normally and source preferences persist without autoplay', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#ambient option')).toHaveCount(22);
  await page.locator('#ambient').selectOption('wind');
  await page.locator('#save-preset').click();
  await page.reload(); await page.locator('[data-saved="0"]').click();
  await expect(page.locator('#ambient')).toHaveValue('wind');
  await page.locator('#import-file').setInputFiles({ name: 'background.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(preset()) });
  await expect(page.getByRole('dialog')).toContainText('A built-in sound plays');
  await page.locator('#accept-import').click();
  await expect(page.locator('#bwg-background-status')).toContainText('Built-in: Night noises');
  await page.locator('#bwg-background-source').selectOption('recording');
  await expect(page.locator('#bwg-background-status')).toContainText('Missing: Night noises');
  await page.locator('#bwg-background-source').selectOption('generated');
  await expect(page.locator('#bwg-background-status')).toContainText('Built-in: Night noises');
  await page.locator('#save-preset').click();
  await page.reload(); await page.locator('[data-saved="1"]').click();
  await expect(page.locator('#bwg-background-source')).toHaveValue('generated');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await expect(page.locator('#bwg-background-source')).toBeDisabled();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#make-static').click();
  const exported = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await exported; const { readFile } = await import('node:fs/promises');
  expect(JSON.parse(await readFile((await download.path())!, 'utf8')).bwgBackgroundSource).toBeUndefined();
});

test('download-free approximation reaches the AudioWorklet and obeys finite completion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async data => {
    const { BackgroundAssets } = await import('/src/background-assets.ts');
    const { importBwg } = await import('/src/import/bwg.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const { default: url } = await import('/src/audio/bwg-worklet.ts?worker&url');
    const bytes = new Uint8Array(data); new DataView(bytes.buffer).setUint32(420, 1, true);
    const preset = decodeBwg(importBwg(bytes).session.bwg).preset;
    const assets = new BackgroundAssets(); await assets.clear();
    const background = await assets.resolve(preset);
    const context = new OfflineAudioContext(2, 48000, 48000);
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, 'bwg-sequence', { numberOfInputs: 0,
      outputChannelCount: [2], processorOptions: { preset, background } });
    node.connect(context.destination); const pcm = await context.startRendering();
    let power = 0, ended = 0;
    for (const channel of [pcm.getChannelData(0), pcm.getChannelData(1)]) {
      for (let i = 0; i < channel.length; i++) {
        if (i < 28000) power += channel[i] ** 2;
        if (i > 30000) ended += channel[i] ** 2;
      }
    }
    return { kind: background.kind, count: assets.count, power, ended };
  }, preset());
  expect(result.kind).toBe('generated'); expect(result.count).toBe(0);
  expect(result.power).toBeGreaterThan(1); expect(result.ended).toBe(0);
});

test('normal ambience uses the generated PCM and retains pause and audio-clock stop', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
    const { makeGeneratedBackground } = await import('/src/audio/generated-backgrounds.ts');
    const session = initialSession(); session.ambient = 'wind'; session.ambientLevel = 1; session.minutes = 0.02;
    const engine = new AudioEngine(); await engine.start(session);
    const context = engine.context, source = engine.noise;
    const match = source.buffer.getChannelData(0)[1000] === makeGeneratedBackground('wind').channels[0][1000];
    await engine.pause(); const before = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 150)); const frozen = context.currentTime === before;
    await engine.resume();
    await new Promise(resolve => setTimeout(resolve, 1400));
    const finished = engine.remaining === 0;
    await engine.stop(); return { match, frozen, finished };
  });
  expect(result).toEqual({ match: true, frozen: true, finished: true });
});
