import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import { browserLaunchOptions } from '../scripts/browser-options.mjs';
import AxeBuilder from '@axe-core/playwright';
import { makeBwgFixture } from './helpers/bwg.ts';
import { setSources } from './helpers/listening-sources.ts';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
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
let mount = '/', revision = '', failAsset = false, disconnected = false;
const server = createServer(async (request, response) => {
  if (disconnected) { request.socket.destroy(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(mount)) throw new Error('Outside mount');
    const relative = path.slice(mount.length) || 'index.html';
    if (failAsset && relative === 'presets/liquid-beats.json') throw new Error('Simulated incomplete deployment');
    const file = resolve(root, relative);
    if (!file.startsWith(root.replace(/[\\/]$/, '') + sep) || !(await stat(file)).isFile()) throw new Error('Missing file');
    let body = await readFile(file);
    if (relative === 'sw.js' && revision) body = Buffer.from(body.toString().replace(/const version = '([^']+)'/, `const version = '$1-${revision}'`));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
const files = [];
async function inventory(directory, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) await inventory(resolve(directory, item.name), prefix + item.name + '/');
    else if (item.name !== 'sw.js') files.push(prefix + item.name);
  }
}
await inventory(root);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const prefix of ['/', '/Binaural/']) {
    for (const [name, launcher] of [['chromium', chromium], ['firefox', firefox]]) {
      mount = prefix; revision = ''; failAsset = false; disconnected = false;
      const browser = await launcher.launch(browserLaunchOptions(name));
      let page;
      const errors = [], failedRequests = [];
      try {
        const context = await browser.newContext();
        page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
        await page.goto(origin + prefix);
        await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
        await page.locator('.offline-tools summary').click();
        await expect(page.locator('#offline-status')).toContainText('Ready offline');
        const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(accessibility.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
        const cachePrefix = `binaural-offline:${encodeURIComponent(prefix)}:`;
        const cached = await page.evaluate(async key => {
          const name = (await caches.keys()).find(name => name.startsWith(key));
          return (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname);
        }, cachePrefix);
        expect(cached.sort()).toEqual(files.map(file => prefix + file).sort());
        await page.evaluate(async () => (await caches.open('unrelated-app-cache')).put('/other-app', new Response('keep')));
        const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
        expect(manifest.start_url).toBe('./'); expect(manifest.scope).toBe('./');
        disconnected = true; await context.setOffline(true);
        await page.reload();
        await expect(page.locator('h1')).toContainText('Find your own');
        const offlineAssets = await page.evaluate(async files => Promise.all(files.map(async file => {
          const response = await fetch(file); return response.ok;
        })), files);
        expect(offlineAssets.every(Boolean)).toBe(true);
        expect(await page.evaluate(() => fetch('./private-local-file.json').then(() => true, () => false))).toBe(false);
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
        expect(recordedResponse.fromServiceWorker()).toBe(true);
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
        await page.locator('#play').click();
        await page.locator('#asmr-browse').click(); await page.locator('[data-load-preset="asmr-hairbrush-unhurried"]').click();
        await expect(page.locator('#asmr-flow')).toHaveValue('natural');
        const hairRecording = page.waitForResponse(origin + prefix + 'audio/asmr/hair-brushing.mp3');
        await page.locator('#play').click();
        const hairResponse = await hairRecording;
        expect(hairResponse.ok()).toBe(true); expect(hairResponse.headers()['content-type']).toBe('audio/mpeg');
        expect(hairResponse.fromServiceWorker()).toBe(true);
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
        await page.locator('[data-visual-quick=triggers]').click();
        await page.getByLabel('Enable light triggers', { exact: true }).check();
        for (const id of ['prism-lantern', 'red-scan', 'soft-torch']) {
          await page.locator('#trigger-preset').selectOption(id); await expect(page.locator('.scene-drawing')).toBeVisible();
        }
        await page.getByLabel('Animate without audio', { exact: true }).check();
        await page.locator('.scene-drawing').scrollIntoViewIfNeeded();
        await expect.poll(async () => Number(await page.locator('.scene-drawing').getAttribute('data-light'))).toBeGreaterThan(0);
        await page.getByLabel('Animate without audio', { exact: true }).uncheck();
        for (const id of ['forest-slope', 'mountain-dawn', 'autumn-meadow']) {
          await page.getByLabel('Scene', { exact: true }).selectOption(`nature:${id}`);
          await expect(page.locator('#scene-status')).toContainText('Use Look around');
        }
        await page.getByLabel('Scene', { exact: true }).selectOption('milkdrop');
        await page.getByLabel('Enable MilkDrop visuals').check();
        for (const id of ['liquid-beats', 'deep-blue', 'gentle-happiness', 'alien-fish-pond', 'blue-mountains', 'cool-morning']) {
          await page.getByLabel('MilkDrop preset').selectOption(id);
          await expect(page.locator('.scene-milkdrop')).toHaveAttribute('data-preset', id);
        }
        await page.getByRole('button', { name: 'Share session link' }).click();
        const shared = await page.getByLabel('Session link', { exact: true }).inputValue();
        await page.getByRole('button', { name: 'Close share', exact: true }).click();
        await page.goto(shared);
        await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('milkdrop');
        await expect(page.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
        await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.locator('#import-file').setInputFiles({ name: 'synthetic.bwg', mimeType: 'application/octet-stream',
          buffer: Buffer.from(makeBwgFixture()) });
        await page.getByRole('button', { name: 'Load imported session' }).click();
        await expect(page.getByRole('dialog', { name: 'Review BWGen import', exact: true })).toHaveCount(0);
        await expect(page.locator('#playing-title')).toHaveText('Synthetic compatibility fixture');
        await expect(page.locator('#minutes')).toHaveValue('10');
        await expect(page.getByLabel('Enable light triggers', { exact: true })).not.toBeChecked();
        await page.evaluate(() => {
          window.offlineExportWorkers = [];
          // Short exports can terminate a worker before the debugger attaches to it.
          window.Worker = new Proxy(window.Worker, { construct(target, args, newTarget) {
            const worker = Reflect.construct(target, args, newTarget);
            window.offlineExportWorkers.push(String(args[0])); return worker;
          } });
        });
        await page.locator('#render-audio').click();
        const nativeExport = page.getByRole('dialog', { name: 'Export audio', exact: true });
        await nativeExport.getByLabel('Duration in seconds', { exact: true }).fill('1');
        const [nativeDownload] = await Promise.all([page.waitForEvent('download'),
          nativeExport.getByRole('button', { name: 'Render WAV', exact: true }).click()]).catch(async error => {
            const details = await page.evaluate(() => ({ export: document.querySelector('#audio-export-status')?.textContent,
              notice: document.querySelector('#notice')?.textContent, workers: window.offlineExportWorkers }));
            throw new Error(`Native export: ${JSON.stringify(details)}`, { cause: error });
          });
        const nativeWorker = await page.evaluate(() => window.offlineExportWorkers.find(url => /\/bwg-export-worker-/.test(url)));
        expect(nativeWorker, 'Native WAV must use the offline BWGen worker').toBeTruthy();
        const workerPath = new URL(nativeWorker).pathname;
        expect(workerPath).toMatch(/\/assets\/bwg-export-worker-[^/]+\.js$/);
        expect(nativeWorker.startsWith(origin + prefix)).toBe(true);
        expect(cached).toContain(workerPath);
        expectShortWav(await readFile(await nativeDownload.path()));
        await page.locator('#music-file').setInputFiles({ name: 'local-export.wav', mimeType: 'audio/wav', buffer: await readFile(await nativeDownload.path()) });
        await expect(page.locator('#music-name')).toHaveText('local-export.wav');
        await page.locator('#render-audio').click();
        const flacExport = page.getByRole('dialog', { name: 'Export audio', exact: true });
        await flacExport.getByLabel('File format').selectOption('flac');
        await expect(flacExport.getByLabel('Include local music')).toBeChecked();
        await flacExport.getByLabel('Duration in seconds').fill('1');
        const [flacDownload] = await Promise.all([page.waitForEvent('download'),
          flacExport.getByRole('button', { name: 'Render FLAC', exact: true }).click()]);
        const flacWorker = await page.evaluate(() => window.offlineExportWorkers.find(url => /\/flac-export-worker-/.test(url)));
        expect(flacWorker, 'FLAC must use its offline encoder worker').toBeTruthy();
        expect(flacWorker.startsWith(origin + prefix)).toBe(true);
        expect(cached).toContain(new URL(flacWorker).pathname);
        expect(cached.some(path => /\/libflac\.wasm-/.test(path))).toBe(true);
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
        await page.getByRole('button', { name: 'Start listening' }).click();
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.getByRole('button', { name: 'Stop listening' }).click();
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        disconnected = false; await context.setOffline(false);

        const other = await context.newPage();
        await other.goto(origin + prefix);
        await other.evaluate(() => { window.offlineTabMarker = 'preserve'; });
        await page.getByRole('button', { name: 'Start listening' }).click();
        revision = 'update';
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
        await other.reload();
        await expect(other.locator('#offline-status')).toContainText('An update is ready');
        await other.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.postMessage({ type: 'RELEASE_UNUSED_CACHES' }));
        const waitingAssets = await other.evaluate(async key => {
          const name = (await caches.keys()).find(name => name.startsWith(key) && name.endsWith('-update'));
          return (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname);
        }, cachePrefix);
        expect(waitingAssets.sort()).toEqual(files.map(file => prefix + file).sort());
        await other.evaluate(() => { window.offlineTabMarker = 'preserve'; });
        await page.locator('.offline-tools summary').click();
        await expect(page.locator('#offline-update')).toBeDisabled();
        await page.getByRole('button', { name: 'Stop listening' }).click();
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await other.getByRole('button', { name: 'Start listening' }).click();
        await page.locator('#offline-update').click();
        await expect(page.locator('#offline-status')).toContainText('all open Binaural tabs');
        expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
        await expect(other.locator('#status')).toHaveText('● Listening');
        await other.getByRole('button', { name: 'Stop listening' }).click();
        await expect(other.locator('#status')).toHaveText('Ready when you are');
        await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#offline-update').click()]);
        await expect(page.locator('h1')).toContainText('Find your own');
        expect(await other.evaluate(() => window.offlineTabMarker)).toBe('preserve');
        await other.close();
        expect(await page.evaluate(async key => (await caches.keys()).filter(name => name.startsWith(key)).length, cachePrefix)).toBe(2);
        expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
        disconnected = true; await context.setOffline(true);
        await page.reload();
        await expect(page.locator('h1')).toContainText('Find your own');
        expect(await page.evaluate(async files => (await Promise.all(files.map(file => fetch(file).then(response => response.ok)))).every(Boolean), files)).toBe(true);
        disconnected = false; await context.setOffline(false);

        revision = 'incomplete'; failAsset = true;
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          window.offlineFailureObserved = false;
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker.addEventListener('statechange', () => { if (worker.state === 'redundant') window.offlineFailureObserved = true; });
          });
          await registration.update();
        });
        await expect.poll(() => page.evaluate(() => window.offlineFailureObserved)).toBe(true);
        expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(false);
        await expect.poll(() => page.evaluate(async key => (await caches.keys()).filter(name => name.startsWith(key)), cachePrefix)).toHaveLength(2);
        const names = await page.evaluate(() => caches.keys());
        expect(names.filter(name => name.startsWith(cachePrefix))).toHaveLength(2);
        expect(names.some(name => name.endsWith('-incomplete'))).toBe(false);

        revision = '';
        await page.evaluate(async () => { window.offlineFailureObserved = false; await (await navigator.serviceWorker.getRegistration()).update(); });
        await expect.poll(() => page.evaluate(() => window.offlineFailureObserved)).toBe(true);
        expect(await page.evaluate(async key => (await caches.keys()).filter(name => name.startsWith(key)).length, cachePrefix)).toBe(2);
        failAsset = false;
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.postMessage({ type: 'RELEASE_UNUSED_CACHES' }));
        await page.locator('.offline-tools summary').click();
        await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#offline-update').click()]);
        await expect(page.locator('h1')).toContainText('Find your own');
        expect(await page.evaluate(async key => (await caches.keys()).filter(name => name.startsWith(key)).length, cachePrefix)).toBe(2);
        disconnected = true; await context.setOffline(true);
        await page.reload();
        await expect(page.locator('h1')).toContainText('Find your own');
        expect(await page.evaluate(async files => (await Promise.all(files.map(file => fetch(file).then(response => response.ok)))).every(Boolean), files)).toBe(true);
        await page.getByRole('button', { name: 'Start listening' }).click();
        await expect(page.locator('#status')).toHaveText('● Listening');
        await page.getByRole('button', { name: 'Stop listening' }).click();
        expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
        expect(errors).toEqual([]);
        console.log(`${name} ${prefix}: complete offline assets/scenes/worklet/share, native BWGen WAV/export worker, recorded Ogg playback, playback-safe intertab update, waiting old-tab retention, failed/successful rollback and cache isolation passed`);
      } catch (error) {
        const state = await page?.evaluate(() => ({ status: document.querySelector('#status')?.textContent,
          notice: document.querySelector('#notice')?.textContent, clock: document.querySelector('#clock')?.textContent,
          export: document.querySelector('#audio-export-status')?.textContent, workers: window.offlineExportWorkers,
          startDisabled: document.querySelector('#play')?.disabled })).catch(() => undefined);
        console.error(`${name} ${prefix}: ${JSON.stringify({ state, errors, failedRequests: failedRequests.slice(-20) })}`);
        throw error;
      } finally { await browser.close(); }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
