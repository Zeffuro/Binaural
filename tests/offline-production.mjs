import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeBwgFixture } from './helpers/bwg.ts';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain' };
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
      const browser = await launcher.launch();
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
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
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.locator('#import-file').setInputFiles({ name: 'synthetic.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
        await page.getByRole('button', { name: 'Load imported session' }).click();
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
        console.log(`${name} ${prefix}: complete offline assets/scenes/worklet/share, playback-safe intertab update, waiting old-tab retention, failed/successful rollback and cache isolation passed`);
      } finally { await browser.close(); }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
