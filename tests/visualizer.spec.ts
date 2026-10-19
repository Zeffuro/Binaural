import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

function musicWave(): Buffer {
  const bytes = Buffer.alloc(44 + 48000 * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(96000, 40);
  for (let i = 0; i < 48000; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 48000) * 24000), 44 + i * 2);
  return bytes;
}

test('all music patterns and moodscapes render and animate only when requested', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('.scene-drawing');
  for (const mode of ['spectrum', 'scope', 'orbits', 'aurora', 'water']) {
    await page.getByLabel('Scene', { exact: true }).selectOption(mode);
    await expect(canvas).toBeVisible();
    const first = await canvas.getAttribute('data-frame');
    await page.waitForTimeout(100);
    await expect(canvas).toHaveAttribute('data-frame', first!);
    const pixels = await canvas.evaluate((node: HTMLCanvasElement) => {
      const data = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data;
      const colors = new Set(); for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    expect(pixels).toBeGreaterThan(1);
    await page.getByLabel('Animate without audio').check();
    await expect.poll(() => canvas.getAttribute('data-frame')).not.toBe(first);
    await page.getByLabel('Animate without audio').uncheck();
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/scene-${mode}-${test.info().project.name}.png` });
  }
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.getByRole('button', { name: 'Open visualization' }).click();
  await expect(page.getByRole('dialog', { name: 'Immersive visualization' })).toBeVisible();
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Close visualization' }).click();
  await expect(page.locator('#scene-preview .scene-drawing')).toBeVisible();
});

test('music alone drives the output analyzer and pause freezes the scene', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Background sound', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Mute tone layers' }).click();
  await expect(page.locator('[data-field=level]')).toHaveValue('0');
  await page.locator('#music-file').setInputFiles({ name: 'music.wav', mimeType: 'audio/wav', buffer: musicWave() });
  await expect(page.locator('#music-name')).toHaveText('music.wav');
  await page.getByLabel('Music level').fill('1');
  await page.getByLabel('Master volume').fill('1');
  await page.getByLabel('Scene', { exact: true }).selectOption('spectrum');
  await page.getByRole('button', { name: 'Start listening' }).click();
  const canvas = page.locator('.scene-drawing');
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy'))).toBeGreaterThan(0.05);
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const frozen = await canvas.getAttribute('data-frame');
  await page.waitForTimeout(250);
  await expect(canvas).toHaveAttribute('data-frame', frozen!);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => canvas.getAttribute('data-frame')).not.toBe(frozen);
  await page.getByLabel('Master volume').fill('0');
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy'))).toBeLessThan(0.001);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('local moodscape images stay local, survive a bad replacement and can be removed', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url()); });
  await page.goto('/');
  await page.locator('#scene-file').setInputFiles({ name: 'landscape.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#204f49"/><circle cx="240" cy="50" r="20" fill="#e2d8a5"/></svg>') });
  await expect(page.locator('.scene-media img')).toBeVisible();
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('local');
  await page.locator('#scene-file').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.locator('#scene-status')).toContainText('could not be opened');
  await expect(page.locator('.scene-media img')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.scene-media img').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Remove file', exact: true }).click();
  await expect(page.locator('.scene-media img')).toHaveCount(0);
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('off');
  expect(external).toEqual([]);
  await expect(page.getByRole('link', { name: "Browse BWGen's library" })).toHaveAttribute('href', 'https://www.bwgen.com/presets.html');
});

test('reduced motion and Escape freeze standalone scenes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
  await page.getByLabel('Animate without audio').check();
  const canvas = page.locator('.scene-drawing');
  const before = await canvas.getAttribute('data-frame');
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frame', before!);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => canvas.getAttribute('data-frame')).not.toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Animate without audio')).not.toBeChecked();
  const stopped = await canvas.getAttribute('data-frame');
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frame', stopped!);
});

test('local video is muted, pauses when hidden, and respects reduced motion', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scene-file').setInputFiles(fileURLToPath(new URL('./fixtures/moodscape.webm', import.meta.url)));
  const video = page.locator('.scene-media video');
  await expect(video).toBeVisible();
  expect(await video.evaluate((node: HTMLVideoElement) => node.muted && node.loop && node.paused)).toBe(true);
  await page.getByLabel('Animate without audio').check();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
  await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await page.getByLabel('Scene', { exact: true }).selectOption('local');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  const time = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
  await page.waitForTimeout(150);
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBe(time);
  await page.getByRole('button', { name: 'Remove file', exact: true }).click();
  await expect(video).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(page.locator('#scene-status')).toHaveText('File removed.');
});

test('a pending play aborted by removal cannot replace the removal status', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scene-file').setInputFiles(fileURLToPath(new URL('./fixtures/moodscape.webm', import.meta.url)));
  await expect(page.locator('.scene-media video')).toBeVisible();
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Playback interrupted', 'AbortError')), 250));
  });
  await page.getByLabel('Animate without audio').check();
  await page.getByRole('button', { name: 'Remove file', exact: true }).click();
  await page.waitForTimeout(350);
  await expect(page.locator('#scene-status')).toHaveText('File removed.');
});

