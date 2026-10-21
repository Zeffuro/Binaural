import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import { browserLaunchOptions } from './browser-options.mjs';
import { makeBwgFixture } from '../tests/helpers/bwg.ts';
import { setSources } from '../tests/helpers/listening-sources.ts';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
function expectShortWav(wav) {
  expect(wav.length).toBe(176444);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(wav.readUInt32LE(16)).toBe(16);
  expect(wav.readUInt16LE(20)).toBe(1); expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(44100); expect(wav.readUInt32LE(28)).toBe(176400);
  expect(wav.readUInt16LE(32)).toBe(4); expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.toString('ascii', 36, 40)).toBe('data');
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  expect(wav.subarray(44).some(value => value !== 0)).toBe(true);
}
let mount = '/Binaural/';
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(mount)) throw new Error('Outside mount');
    const file = resolve(root, path.slice(mount.length) || 'index.html');
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Missing file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const prefix of ['/Binaural/', '/']) {
    mount = prefix;
    for (const [name, launcher] of [['chromium', chromium], ['firefox', firefox]]) {
      const browser = await launcher.launch(browserLaunchOptions(name));
      try {
        const page = await browser.newPage({ colorScheme: 'dark' });
        const errors = [], badResponses = [], outside = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) badResponses.push(response.url()); });
        page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + prefix)) outside.push(request.url()); });
        await page.goto(origin + prefix);
        await expect(page.locator('h1')).toContainText('Find your own');
        expect((await page.request.get(origin + prefix + 'missing.js')).status()).toBe(404);
        await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
        await page.getByLabel('How long?', { exact: true }).selectOption('10');
        await page.getByLabel('A visual atmosphere', { exact: true }).selectOption('aurora');
        await page.getByRole('button', { name: 'Load session', exact: true }).click();
        await expect(page.locator('#minutes')).toHaveValue('10');
        await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.getByRole('button', { name: 'Explore all presets' }).click();
        await page.getByLabel('With visual settings', { exact: true }).check();
        await expect(page.locator('.explore-card')).toHaveCount(59);
        await page.locator('[data-load-preset="forest-clearing"]').click();
        await expect(page.locator('#ambient')).toHaveValue('wind');
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.locator('#edit-timeline').click();
        await page.getByLabel('Duration in seconds', { exact: true }).fill('4');
        await page.getByRole('button', { name: 'Add automation to this layer' }).click();
        await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('240');
        await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
        await expect(page.locator('#timeline-info')).toBeVisible();
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await setSources(page, 'asmr');
        for (const id of ['glass-lantern', 'red-sweep', 'rose-brushes', 'paper-prism', 'blue-droplets', 'torch-whisper']) {
          await page.locator('#asmr-browse').click(); await page.locator(`[data-load-preset="asmr-${id}"]`).click();
          if (id === 'glass-lantern') await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
          await expect(page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })).toHaveCount(0);
          await expect(page.locator('[data-asmr]')).toHaveCount(2);
          await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked();
        }
        await page.locator('#asmr-browse').click(); await page.locator('[data-load-preset="asmr-hands-close"]').click();
        const recording = page.waitForResponse(origin + prefix + 'audio/asmr/hand-rubbing.ogg');
        await page.locator('#asmr-only').click(); await page.locator('#play').click();
        const recordedResponse = await recording;
        expect(recordedResponse.ok()).toBe(true); expect(recordedResponse.headers()['content-type']).toBe('audio/ogg');
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        await page.locator('#play').click();
        await page.locator('#asmr-browse').click(); await page.locator('[data-load-preset="asmr-hairbrush-unhurried"]').click();
        await expect(page.locator('#asmr-flow')).toHaveValue('natural');
        const hairRecording = page.waitForResponse(origin + prefix + 'audio/asmr/hair-brushing.mp3');
        await page.locator('#play').click();
        const hairResponse = await hairRecording;
        expect(hairResponse.ok()).toBe(true); expect(hairResponse.headers()['content-type']).toBe('audio/mpeg');
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        await page.locator('#play').click();
        await page.locator('#asmr-flow').selectOption('steady');
        await page.locator('#asmr-browse').click(); await page.locator('[data-load-preset="asmr-brush-in-front"]').click();
        await expect(page.locator('#trigger-sync-asmr')).toBeChecked();
        await page.locator('#play').click(); await page.locator('.scene-drawing').scrollIntoViewIfNeeded();
        await expect.poll(async () => Number(await page.locator('.scene-drawing').getAttribute('data-cues'))).toBeGreaterThan(0);
        await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        await page.locator('#play').click();
        await page.locator('#asmr-browse').click(); await page.locator('[data-load-preset="asmr-hands-close"]').click();
        await page.getByLabel('Enable light triggers', { exact: true }).uncheck();
        await page.locator('[data-visual-quick=calm]').click();
        await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
        await page.locator('[data-visual-quick=triggers]').click();
        await expect(page.locator('#visual-dock-fullscreen')).toBeDisabled();
        await page.getByLabel('Enable light triggers', { exact: true }).check();
        const triggerIds = await page.locator('#trigger-preset option:not([disabled])').evaluateAll(nodes => nodes.map(node => node.value));
        expect(triggerIds).toHaveLength(26);
        for (const id of triggerIds) {
          await page.locator('#trigger-preset').selectOption(id);
          await expect(page.locator('.scene-drawing')).toBeVisible();
        }
        await page.locator('#trigger-preset').selectOption('prism-lantern');
        await page.getByLabel('Animate without audio', { exact: true }).check();
        await page.locator('.scene-drawing').scrollIntoViewIfNeeded();
        await expect.poll(async () => Number(await page.locator('.scene-drawing').getAttribute('data-light'))).toBeGreaterThan(0);
        await page.getByLabel('Animate without audio', { exact: true }).uncheck();
        await page.locator('[data-visual-quick=calm]').click();
        await page.locator('#visual-dock .scene-drawing').dblclick();
        await expect(page.getByRole('dialog', { name: 'Immersive visualization' })).toBeVisible();
        const immersiveAudio = page.locator('.scene-stage').getByRole('group', { name: 'Audio controls', exact: true });
        await immersiveAudio.getByRole('button', { name: 'Play audio', exact: true }).click();
        await expect(page.locator('#status')).toHaveText('● Listening');
        await immersiveAudio.getByRole('button', { name: 'Pause audio', exact: true }).click();
        await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        await immersiveAudio.getByRole('button', { name: 'Stop audio', exact: true }).click();
        await page.locator('.scene-stage .scene-drawing').dblclick();
        await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
        for (const id of ['forest-slope', 'mountain-dawn', 'autumn-meadow']) {
          await page.getByLabel('Scene', { exact: true }).selectOption(`nature:${id}`);
          await expect(page.locator('#scene-status')).toContainText('Use Look around');
          await expect(page.locator('.scene-panorama')).toBeVisible();
        }
        await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
        await expect(page.locator('.scene-milkdrop')).not.toBeVisible();
        await page.getByLabel('Enable MilkDrop visuals').check();
        const canvas = page.locator('.scene-milkdrop');
        await expect.poll(() => canvas.getAttribute('data-frames'), { timeout: 15000 }).not.toBeNull();
        await page.getByLabel('Animate without audio').check();
        for (const id of ['liquid-beats', 'deep-blue', 'gentle-happiness', 'alien-fish-pond', 'blue-mountains', 'cool-morning']) {
          await page.getByLabel('MilkDrop preset').selectOption(id);
          await expect(canvas).toHaveAttribute('data-preset', id);
          await canvas.scrollIntoViewIfNeeded();
          await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(2);
        }
        await page.getByLabel('Animate without audio').uncheck();
        await page.getByRole('button', { name: 'Share session link' }).click();
        const shared = await page.getByLabel('Session link', { exact: true }).inputValue();
        await page.getByRole('button', { name: 'Close share', exact: true }).click();
        await page.goto('about:blank');
        await page.goto(shared);
        await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('milkdrop');
        await expect(page.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
        await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.locator('#render-audio').click();
        await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByLabel('Duration in seconds', { exact: false }).fill('1');
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export audio', exact: true }).getByRole('button', { name: 'Render WAV', exact: true }).click()]);
        const wav = await readFile(await download.path());
        expectShortWav(wav);
        await page.locator('#import-file').setInputFiles({ name: 'synthetic.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
        await page.getByRole('button', { name: 'Load imported session' }).click();
        await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
        await page.locator('#render-audio').click();
        const nativeExport = page.getByRole('dialog', { name: 'Export audio', exact: true });
        await nativeExport.getByLabel('Duration in seconds', { exact: true }).fill('1');
        const [nativeWorker, nativeDownload] = await Promise.all([page.waitForEvent('worker'), page.waitForEvent('download'),
          nativeExport.getByRole('button', { name: 'Render WAV', exact: true }).click()]);
        expect(nativeWorker.url()).toMatch(/\/assets\/bwg-export-worker-[^/]+\.js$/);
        expect(nativeWorker.url().startsWith(origin + prefix)).toBe(true);
        expectShortWav(await readFile(await nativeDownload.path()));
        await page.locator('#music-file').setInputFiles({ name: 'local-export.wav', mimeType: 'audio/wav', buffer: await readFile(await nativeDownload.path()) });
        await expect(page.locator('#music-name')).toHaveText('local-export.wav');
        await page.locator('#render-audio').click();
        const flacExport = page.getByRole('dialog', { name: 'Export audio', exact: true });
        await flacExport.getByLabel('File format').selectOption('flac');
        await expect(flacExport.getByLabel('Include local music')).toBeChecked();
        await flacExport.getByLabel('Duration in seconds').fill('1');
        const [flacWorker, flacDownload] = await Promise.all([
          page.waitForEvent('worker', worker => /\/flac-export-worker-/.test(worker.url())), page.waitForEvent('download'),
          flacExport.getByRole('button', { name: 'Render FLAC', exact: true }).click()]);
        expect(flacWorker.url().startsWith(origin + prefix)).toBe(true);
        const flac = await readFile(await flacDownload.path());
        expect(flacDownload.suggestedFilename()).toMatch(/\.flac$/);
        expect(flac.toString('ascii', 0, 4)).toBe('fLaC');
        expect(flac.subarray(26, 42).some(value => value !== 0)).toBe(true);
        const decodedFlac = await page.evaluate(async bytes => {
          const context = new OfflineAudioContext(2, 1, 44100), audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
          return { frames: audio.length, channels: audio.numberOfChannels, audible: audio.getChannelData(0).some(value => Math.abs(value) > .0001) };
        }, Array.from(flac));
        expect(decodedFlac).toEqual({ frames: 44100, channels: 2, audible: true });
        await page.locator('button[data-visual-quick=calm]').click();
        await page.locator('#record-video').click();
        const videoExport = page.getByRole('dialog', { name: 'Export video', exact: true });
        await videoExport.getByLabel('Resolution').selectOption('854x480');
        await videoExport.getByLabel('Frame rate').selectOption('24');
        await videoExport.getByLabel('Maximum recording seconds').fill('1');
        const [videoDownload] = await Promise.all([page.waitForEvent('download'), videoExport.getByRole('button', { name: 'Start recording', exact: true }).click()]);
        const videoBytes = await readFile(await videoDownload.path());
        expect(videoBytes.length).toBeGreaterThan(1000);
        expect(videoDownload.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
        const videoSize = await page.evaluate(async bytes => {
          const video = document.createElement('video'), url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
          video.muted = true; video.preload = 'auto';
          try {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Video did not decode')), 10000);
              video.onloadeddata = () => { clearTimeout(timer); resolve(true); };
              video.onerror = () => { clearTimeout(timer); reject(new Error('Video could not decode')); };
              video.src = url;
            });
            return [video.videoWidth, video.videoHeight];
          } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
        }, Array.from(videoBytes));
        expect(videoSize).toEqual([854, 480]);
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
        await page.locator('#remove-music').click();
        await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
        await page.getByLabel('Enable MilkDrop visuals').check();
        await page.getByRole('button', { name: 'Start listening' }).click();
        await expect(page.locator('#status')).toHaveText('● Listening');
        await canvas.scrollIntoViewIfNeeded();
        await expect(canvas).toHaveAttribute('data-audio', 'mix');
        await page.getByRole('button', { name: 'Pause', exact: false }).click();
        await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        const frozen = await canvas.getAttribute('data-frames');
        await page.waitForTimeout(100); await expect(canvas).toHaveAttribute('data-frames', frozen);
        await page.getByRole('button', { name: 'Stop listening' }).click();
        await page.getByRole('button', { name: 'Open visualization' }).click();
        await expect(page.getByRole('dialog', { name: 'Immersive visualization' })).toBeVisible();
        await page.getByRole('button', { name: 'Close visualization' }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.goto(origin + prefix + 'credits.html');
        const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href).filter(href => href.startsWith(location.origin)));
        for (const link of links) expect((await page.request.get(link)).status(), link).toBe(200);
        expect(errors).toEqual([]); expect(outside).toEqual([]); expect(badResponses).toEqual([]);
        console.log(`${name}: ${prefix} 26 light triggers, shared ASMR discovery, synced gestures, Ogg/MP3 playback, timeline, fullscreen, guide, soundscapes, 6 MilkDrop presets, 3 photos, share, ordinary/native WAV, workers, pause and credits passed`);
      } finally { await browser.close(); }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
