import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import { makeBwgFixture } from '../tests/helpers/bwg.ts';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain' };
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
      const browser = await launcher.launch();
      try {
        const page = await browser.newPage({ colorScheme: 'dark' });
        const errors = [], badResponses = [], outside = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) badResponses.push(response.url()); });
        page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + prefix)) outside.push(request.url()); });
        await page.goto(origin + prefix);
        await expect(page.locator('h1')).toContainText('Find your own');
        expect((await page.request.get(origin + prefix + 'missing.js')).status()).toBe(404);
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
          await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(2);
        }
        await page.getByLabel('Animate without audio').uncheck();
        await page.locator('#import-file').setInputFiles({ name: 'synthetic.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
        await page.getByRole('button', { name: 'Load imported session' }).click();
        await page.getByRole('button', { name: 'Start listening' }).click();
        await expect(page.locator('#status')).toHaveText('● Listening');
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
        console.log(`${name}: ${prefix} assets, 6 presets, 3 photos, worklet, pause, immersive and credits passed`);
      } finally { await browser.close(); }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
