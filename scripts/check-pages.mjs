import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import { makeBwgFixture } from '../tests/helpers/bwg.ts';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
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
        await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
        await page.getByLabel('How long?', { exact: true }).selectOption('10');
        await page.getByLabel('A visual atmosphere', { exact: true }).selectOption('aurora');
        await page.getByRole('button', { name: 'Load session', exact: true }).click();
        await expect(page.locator('#minutes')).toHaveValue('10');
        await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.getByRole('button', { name: 'Explore all presets' }).click();
        await page.getByLabel('With visual settings', { exact: true }).check();
        await expect(page.locator('.explore-card')).toHaveCount(6);
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
        await page.locator('[data-visual-quick=calm]').click();
        await expect(page.locator('#visual-dock .scene-drawing')).toBeVisible();
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
        await expect(page.locator('#status')).toHaveText('Ready when you are');
        await page.getByRole('button', { name: 'Render WAV', exact: true }).click();
        await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByLabel('Duration in seconds', { exact: false }).fill('1');
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export audio', exact: true }).getByRole('button', { name: 'Render WAV', exact: true }).click()]);
        const wav = await readFile(await download.path());
        expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.length).toBe(176444);
        await page.locator('#import-file').setInputFiles({ name: 'synthetic.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
        await page.getByRole('button', { name: 'Load imported session' }).click();
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
        console.log(`${name}: ${prefix} timeline, inline/fullscreen workspace, guide, soundscapes, assets, 6 presets, 3 photos, shared session, WAV, worklet, pause and credits passed`);
      } finally { await browser.close(); }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
