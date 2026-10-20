import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const format of ['wav', 'flac']) test(`${format} dialog includes local music without storing or uploading the file`, async ({ page }) => {
  await page.goto('/');
  const bytes = await readFile('public/audio/asmr/hand-rubbing.ogg'), name = 'Local <track> & calm.ogg';
  const requests: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') requests.push(request.url()); });
  await page.locator('#music-file').setInputFiles({ name, mimeType: 'audio/ogg', buffer: bytes });
  await expect(page.locator('#music-name')).toHaveText(name);
  await page.locator('#render-audio').click();
  const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
  await expect(dialog.getByLabel('Include local music')).toBeChecked();
  await expect(dialog.locator('#export-music-info')).toContainText(name);
  await expect(dialog.locator('#export-music-info track')).toHaveCount(0);
  await dialog.getByLabel('File format').selectOption(format);
  await dialog.getByLabel('Duration in seconds').fill('.1');
  if (format === 'flac') await expect(dialog.locator('#export-estimate')).toContainText('FLAC size depends');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: `Render ${format.toUpperCase()}`, exact: true }).click()]);
  expect(download.suggestedFilename()).toBe(`Quiet morning.${format}`);
  const data = await readFile((await download.path())!);
  expect(data.toString('ascii', 0, 4)).toBe(format === 'wav' ? 'RIFF' : 'fLaC');
  const decoded = await page.evaluate(async bytes => {
    const context = new OfflineAudioContext(2, 1, 44100), result = await context.decodeAudioData(new Uint8Array(bytes).buffer);
    return { frames: result.length, channels: result.numberOfChannels };
  }, Array.from(data));
  expect(decoded).toEqual({ frames: 4410, channels: 2 });
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  const [preset] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  expect(await readFile((await preset.path())!, 'utf8')).not.toContain(name);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(name);
  expect(requests).toEqual([]);
});

test('included damaged music reports an error and excluding it allows retry without losing the session', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { setupAudioExport } = await import('/src/export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    document.querySelector('#render-audio')?.remove();
    const button = document.createElement('button'); button.id = 'render-audio'; button.textContent = 'Test export';
    button.style.cssText = 'position:fixed;right:20px;top:20px;z-index:10000'; document.body.append(button);
    const music = new File(['broken audio'], 'Broken.wav');
    setupAudioExport({ session: initialSession, music: () => music, notify: () => {} });
  });
  await page.locator('#render-audio').click();
  const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
  await dialog.getByLabel('File format').selectOption('flac');
  await dialog.getByLabel('Duration in seconds').fill('.1');
  await dialog.getByRole('button', { name: 'Render FLAC', exact: true }).click();
  await expect(dialog.locator('#audio-export-status')).toContainText('could not be decoded');
  await expect(dialog.getByLabel('File format')).toBeEnabled();
  await dialog.getByLabel('Include local music').uncheck();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Render FLAC', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('Quiet morning.flac');
  await expect(dialog).toHaveCount(0);
});

test('discarded FLAC stops its worker and cannot download or finish later', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    Object.assign(window, { flacTerminated: 0 });
    window.Worker = class extends NativeWorker {
      private flac: boolean;
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.flac = String(url).includes('flac-export-worker'); }
      postMessage(message: unknown, transfer: Transferable[]): void;
      postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        if (this.flac && (message as { type: string }).type === 'init') return;
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
      terminate(): void {
        if (this.flac) (window as unknown as { flacTerminated: number }).flacTerminated++;
        super.terminate();
      }
    };
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#render-audio').click();
  const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
  await dialog.getByLabel('File format').selectOption('flac');
  await dialog.getByLabel('Duration in seconds').fill('.1');
  const worker = page.waitForEvent('worker', worker => worker.url().includes('flac-export-worker'));
  await dialog.getByRole('button', { name: 'Render FLAC', exact: true }).click(); await worker;
  await expect(dialog.getByLabel('File format')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Discard export', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { flacTerminated: number }).flacTerminated)).toBe(1);
  expect(downloads).toBe(0);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});
