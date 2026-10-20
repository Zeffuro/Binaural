import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

interface VideoUiState { starts: number; pauses: number; disposed: number; allowed: boolean; aborts: number; release?: () => void }
declare global { interface Window { videoUi: VideoUiState } }

async function mount(page: Page, allowed = true): Promise<void> {
  await page.goto('/credits.html');
  await page.evaluate(async allowed => {
    await import('/src/style.css'); await import('/src/experience.css'); await import('/src/theme.css');
    const { setupVideoExport } = await import('/src/video-export-controls.ts');
    const { initialSession } = await import('/src/model.ts');
    document.body.innerHTML = '<button id="record-video">Export video</button><label for="scene-mode">Scene</label><select id="scene-mode"><option>Choose a visual</option></select>';
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: class { static isTypeSupported() { return true; } } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => { throw new Error('Unexpected capture permissions'); } });
    const state = window.videoUi = { starts: 0, pauses: 0, disposed: 0, allowed, aborts: 0 };
    setupVideoExport({ session: initialSession, remaining: () => undefined, busy: () => false,
      ensurePlaying: async () => { state.starts++; await new Promise<void>(resolve => { window.videoUi.release = resolve; }); },
      playPause: async () => { state.pauses++; }, captureAudio: () => { throw new Error('Audio capture should not start'); }, notify: () => {},
      visual: { createCapture(width, height) {
        if (!state.allowed) throw new Error('Choose a visual before recording.');
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        return { canvas, draw() { if (!state.allowed) throw new Error('Consent was removed.'); const context = canvas.getContext('2d')!; context.fillStyle = '#346654'; context.fillRect(0, 0, width, height); },
          dispose() { state.disposed++; } };
      } },
    });
  }, allowed);
}

for (const theme of ['light', 'dark']) test(`${theme} video controls fit small screens, validate readiness and never start on open`, async ({ page }) => {
  await mount(page);
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await page.locator('#record-video').click();
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await expect(dialog.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Video format')).toHaveValue('video/webm;codecs=vp9,opus');
  await dialog.getByLabel('Resolution').selectOption('854x480'); await dialog.getByLabel('Frame rate').selectOption('24');
  await expect(dialog.locator('#video-export-preview canvas')).toHaveAttribute('width', '854');
  await dialog.getByRole('button', { name: '5 minutes', exact: true }).click();
  await expect(dialog.getByLabel('Maximum recording seconds')).toHaveValue('300');
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  }
  expect(await page.evaluate(() => window.videoUi.starts)).toBe(0);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.locator('#record-video')).toBeFocused();
  expect(await page.evaluate(() => window.videoUi.disposed)).toBeGreaterThan(0);
});

test('video readiness and unsupported formats produce a useful dialog without starting listening', async ({ page }) => {
  await mount(page, false); await page.locator('#record-video').click();
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await expect(dialog.getByRole('button', { name: 'Start recording', exact: true })).toBeDisabled();
  await expect(dialog.locator('#video-export-status')).toContainText('Choose a visual');
  await page.evaluate(() => { window.videoUi.allowed = true; });
  await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Choose a visual', exact: true }).click();
  await expect(page.locator('#scene-mode')).toBeFocused();
  await page.evaluate(() => { Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined }); });
  await page.locator('#record-video').click();
  await expect(dialog.locator('#video-export-status')).toContainText('unavailable');
  await expect(dialog.getByRole('button', { name: 'Start recording', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.videoUi.starts)).toBe(0);
});

test('discard during playback preparation aborts the chosen temporary file and releases preview', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => ({
      write: async () => { throw new Error('Unexpected file write'); }, close: async () => { throw new Error('Unexpected commit'); },
      abort: async () => { window.videoUi.aborts++; },
    }) }) });
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#record-video').click();
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await dialog.getByLabel('Save directly to a video file').check();
  await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.videoUi.starts)).toBe(1);
  await dialog.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.evaluate(() => window.videoUi.release!());
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.videoUi.aborts)).toBe(1);
  expect(downloads).toBe(0);
  await page.locator('#record-video').click(); await expect(dialog).toBeVisible();
});

test('@live app video export records local music and calm visuals, pauses, finishes and leaves listening running', async ({ page }) => {
  test.setTimeout(60_000); await page.goto('/');
  await page.locator('button[data-visual-quick=calm]').click();
  await page.locator('#music-file').setInputFiles({ name: 'local-music.ogg', mimeType: 'audio/ogg', buffer: await readFile('public/audio/asmr/hand-rubbing.ogg') });
  await expect(page.locator('#music-name')).toHaveText('local-music.ogg');
  await page.locator('#record-video').click();
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await dialog.getByLabel('Resolution').selectOption('854x480');
  await dialog.getByLabel('Maximum recording seconds').fill('10');
  await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect.poll(() => dialog.locator('#video-export-progress').evaluate(node => (node as HTMLProgressElement).value)).toBeGreaterThan(.06);
  await dialog.getByRole('button', { name: 'Pause listening', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await expect(dialog.locator('#video-export-status')).toContainText('paused');
  const frozen = await dialog.locator('#video-export-progress').evaluate(node => (node as HTMLProgressElement).value);
  await page.waitForTimeout(250);
  expect(await dialog.locator('#video-export-progress').evaluate(node => (node as HTMLProgressElement).value)).toBeCloseTo(frozen, 2);
  await dialog.getByRole('button', { name: 'Resume listening', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect.poll(() => dialog.locator('#video-export-progress').evaluate(node => (node as HTMLProgressElement).value)).toBeGreaterThan(frozen + .05);
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Finish video', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Quiet morning\.(webm|mp4)$/);
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(1000);
  await expect(dialog).toHaveCount(0); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('@live direct video save can retry a failed commit with listening controls enabled', async ({ page }) => {
  test.setTimeout(60_000); await page.goto('/');
  await page.evaluate(() => {
    const state = { closes: 0, aborts: 0, bytes: 0 };
    Object.assign(window, { videoSave: state });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => ({
      write: async (data: ArrayBuffer) => { state.bytes += data.byteLength; },
      close: async () => { if (++state.closes === 1) throw new Error('Save failed. Please retry.'); },
      abort: async () => { state.aborts++; },
    }) }) });
  });
  await page.locator('button[data-visual-quick=calm]').click(); await page.locator('#record-video').click();
  const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
  await dialog.getByLabel('Resolution').selectOption('854x480'); await dialog.getByLabel('Maximum recording seconds').fill('1');
  await dialog.getByLabel('Save directly to a video file').check();
  await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(dialog.locator('#video-export-status')).toHaveText('Save failed. Please retry.');
  await expect(dialog.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
  await dialog.getByLabel('Maximum recording seconds').fill('10');
  await dialog.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Pause listening', exact: true })).toBeEnabled();
  await expect.poll(() => dialog.locator('#video-export-progress').evaluate(node => (node as HTMLProgressElement).value)).toBeGreaterThan(.05);
  await dialog.getByRole('button', { name: 'Finish video', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => (window as unknown as { videoSave: { closes: number; aborts: number; bytes: number } }).videoSave);
  expect(saved.closes).toBe(2); expect(saved.aborts).toBe(1); expect(saved.bytes).toBeGreaterThan(1000);
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});
