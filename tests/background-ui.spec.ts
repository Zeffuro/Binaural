import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';
import { makeWaveFixture, makeWavePack } from './helpers/wave';

function preset(): number[] {
  const fixed = (value: number) => [{ value, position: 0 }, { value, position: 10000 }];
  const bytes = new Uint8Array(makeBwgFixture(undefined, { 0: fixed(10000), 1: fixed(10000), 39: fixed(0) }));
  new DataView(bytes.buffer).setUint32(1316, 1, true);
  bytes.set(new TextEncoder().encode('Bkgnd.dll'), 1320);
  return Array.from(bytes);
}

test('background sound packs restore matching presets, survive reload and can be cleared', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'background.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(preset()) });
  await page.locator('#accept-import').click();
  await expect(page.locator('#bwg-background-status')).toContainText('Built-in: Night noises');
  await page.locator('#bwg-pack-file').setInputFiles({ name: 'Bkgnd.dll', mimeType: 'application/octet-stream', buffer: Buffer.from(makeWavePack()) });
  await expect(page.locator('#bwg-background-status')).toContainText('Ready: Night noises');
  await expect(page.locator('#bwg-background-count')).toContainText('6 imported recordings');
  await page.locator('#save-preset').click();
  await page.reload();
  await page.locator('[data-saved="0"]').click();
  await expect(page.locator('#bwg-background-status')).toContainText('Ready: Night noises');
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect(page.locator('#bwg-pack-button')).toBeDisabled();
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.locator('#play').click();
  await expect(page.locator('#bwg-clear-assets')).toBeEnabled();
  await page.locator('#bwg-clear-assets').click();
  await expect(page.locator('#bwg-background-status')).toContainText('Built-in: Night noises');
  await expect(page.locator('#bwg-background-count')).toContainText('0 imported recordings');
});

test('a replacement WAV follows the imported background path and malformed replacements keep it ready', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles({ name: 'background.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(preset()) });
  await page.locator('#accept-import').click();
  await page.locator('#bwg-wave-file').setInputFiles({ name: 'own-field-recording.wav', mimeType: 'audio/wav', buffer: Buffer.from(makeWaveFixture().bytes) });
  await expect(page.locator('#bwg-background-status')).toContainText('Ready: own-field-recording.wav');
  await page.locator('#bwg-wave-file').setInputFiles({ name: 'damaged.wav', mimeType: 'audio/wav', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.locator('#notice')).toContainText('damaged WAV');
  await expect(page.locator('#bwg-background-status')).toContainText('Ready: own-field-recording.wav');
});

for (const continues of [false, true]) test(`AudioWorklet background ${continues ? 'holds final values' : 'stops on the program clock'}`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ data, wave, continues }) => {
    const { importBwg } = await import('/src/import/bwg.ts');
    const { decodeBwg } = await import('/src/import/bwg-program.ts');
    const { BackgroundAssets } = await import('/src/background-assets.ts');
    const { default: url } = await import('/src/audio/bwg-worklet.ts?worker&url');
    const bytes = new Uint8Array(data), view = new DataView(bytes.buffer);
    view.setUint32(420, 1, true);
    bytes[1760] = continues ? 1 : 0;
    const session = importBwg(bytes).session, preset = decodeBwg(session.bwg).preset;
    const assets = new BackgroundAssets();
    await assets.bindWave(preset, new File([new Uint8Array(wave)], 'fixture.wav'));
    const context = new OfflineAudioContext(2, 48000, 48000);
    await context.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(context, 'bwg-sequence', { numberOfInputs: 0,
      outputChannelCount: [2], processorOptions: { preset, background: await assets.resolve(preset) } });
    node.connect(context.destination);
    const buffer = await context.startRendering();
    let power = 0, end = 0, stereoError = 0;
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < left.length; i++) {
      if (i < 20000) power += left[i] ** 2;
      if (i > 30000) end += left[i] ** 2 + right[i] ** 2;
      stereoError = Math.max(stereoError, Math.abs(left[i] - right[i]));
    }
    await assets.clear();
    return { power, end, stereoError };
  }, { data: preset(), wave: makeWaveFixture().bytes, continues });
  expect(result.power).toBeGreaterThan(100);
  if (continues) expect(result.end).toBeGreaterThan(100);
  else expect(result.end).toBe(0);
  expect(result.stereoError).toBe(0);
});
