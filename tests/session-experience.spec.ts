import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('tone mute is reversible and preserves the audible mix settings', async ({ page }) => {
  await page.goto('/');
  const levels = page.locator('[data-field=level]');
  await levels.fill('0.73');
  await page.getByRole('button', { name: 'Mute tone layers', exact: true }).click();
  await expect(levels).toHaveValue('0.73');
  await expect(page.locator('#scene-mute-tones')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Unmute tone layers', exact: true }).click();
  await expect(levels).toHaveValue('0.73');
  await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts';
    const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
    const engine = new AudioEngine(), session = initialSession(); session.master = 1; session.ambient = 'none';
    const rms = () => { const frame = engine.visualFrame()!.left; return Math.sqrt(frame.reduce((sum: number, n: number) => sum + ((n - 128) / 128) ** 2, 0) / frame.length); };
    await engine.start(session); await new Promise(resolve => setTimeout(resolve, 400)); const sound = rms();
    session.tonesMuted = true; engine.update(session); await new Promise(resolve => setTimeout(resolve, 400)); const muted = rms();
    session.ambient = 'white'; session.ambientLevel = 1; engine.update(session); await new Promise(resolve => setTimeout(resolve, 350)); const background = rms();
    session.ambient = 'none'; session.tonesMuted = false; engine.update(session); await new Promise(resolve => setTimeout(resolve, 400)); const resumed = rms();
    await engine.stop(); return { sound, muted, background, resumed, level: session.layers[0].level };
  });
  expect(result.sound).toBeGreaterThan(0.02); expect(result.muted).toBeLessThan(0.008); expect(result.background).toBeGreaterThan(0.01); expect(result.resumed).toBeGreaterThan(0.02); expect(result.level).toBe(0.6);
});

test('experience presets and links preserve visuals without autoplay or flash consent', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Ambient light color', { exact: true }).fill('#cc3399');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Scene', { exact: true }).selectOption('aurora');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await downloadPromise;
  const json = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(json.version).toBe(2); expect(json.visual.scene).toBe('aurora'); expect(json.visual.light.color.hue).toBeCloseTo(320);
  expect(json.visual).not.toHaveProperty('consent'); expect(json.visual).not.toHaveProperty('independent');
  await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Ambient light color', { exact: true })).toHaveValue('#cc3399');
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.getByRole('button', { name: 'Share session link' }).click();
  const url = await page.getByLabel('Session link', { exact: true }).inputValue(); expect(url).toContain('#session=');
  const other = await context.newPage(); await other.goto(url);
  await expect(other.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
  await expect(other.getByLabel('Ambient light color', { exact: true })).toHaveValue('#cc3399');
  await expect(other.locator('#status')).toHaveText('Ready when you are');
  await expect(other.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
  await other.close();
  await page.getByRole('button', { name: 'Close share' }).click();
  json.visual.scene = 'unknown';
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await expect(page.locator('#notice')).toContainText('Unknown visual option');
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('aurora');
});

test('layer and preset edits are undoable and same-name saving offers a copy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.getByRole('button', { name: 'Remove layer 2' }).click();
  await expect(page.locator('.tone-layer')).toHaveCount(1);
  await page.locator('#undo-edit').click(); await expect(page.locator('.tone-layer')).toHaveCount(2);
  await page.locator('#redo-edit').click(); await expect(page.locator('.tone-layer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await expect(page.getByRole('dialog', { name: 'Save preset', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save copy', exact: true }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(2);
  await expect(page.locator('.saved-preset').nth(1)).toHaveText('Quiet morning (copy)');
  await page.getByRole('button', { name: 'Delete preset Quiet morning', exact: true }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.locator('#notice').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(2);
});

test('shortcuts preserve native typing, scoped Escape and emergency stop', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Preset name', { exact: true }).fill('smvf');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('h1').click(); await page.keyboard.press('Space');
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.keyboard.press('Space'); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.keyboard.press('m'); await expect(page.locator('#scene-mute-tones')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('?'); await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.keyboard.press('f'); await expect(page.getByRole('dialog', { name: 'Immersive ambient light' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Immersive ambient light' })).not.toBeVisible();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.keyboard.press('Shift+Escape'); await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('saved favorites, recent playback, duplicates and explicit Load and Play work locally', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.getByRole('button', { name: 'Favorite preset Quiet morning', exact: true }).click();
  await page.getByLabel('Filter saved presets').selectOption('favorites'); await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.getByRole('button', { name: 'Duplicate preset Quiet morning', exact: true }).click();
  await page.getByLabel('Filter saved presets').selectOption('all'); await expect(page.locator('.saved-preset')).toHaveCount(2);
  await page.getByRole('button', { name: 'Start listening' }).click(); await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.getByLabel('Filter saved presets').selectOption('recent'); await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.getByRole('button', { name: 'Explore all presets' }).click();
  await page.getByRole('button', { name: 'Load and play Quiet morning', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
});

test('mobile transport stays reachable while editing the bottom of the studio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.getByLabel('Preset name', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('.mini-player')).toBeVisible();
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await page.getByRole('button', { name: 'Mute tones', exact: true }).click();
  await expect(page.locator('#mini-mute')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/mobile-transport-${test.info().project.name}.png` });
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await expect(page.locator('.mini-player')).not.toBeVisible();
});

test('bad shared fragments are rejected without changing the session', async ({ page }) => {
  await page.goto('/#session=not-valid-data');
  await expect(page.locator('#notice')).toContainText('shared session link is invalid');
  await expect(page.locator('#playing-title')).toHaveText('Quiet morning');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('repeated Stop commands keep playback locked until the context closes', async ({ page }) => {
  await page.addInitScript(() => {
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = async function() { await new Promise(resolve => setTimeout(resolve, 700)); await close.call(this); };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start listening' }).click();
  await page.locator('h1').click();
  await page.keyboard.press('s'); await page.keyboard.press('s');
  await page.waitForTimeout(300);
  await expect(page.locator('#play')).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(page.locator('#play')).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.locator('#status')).toHaveText('● Listening');
});

test('visual keyboard edits can be undone and saturated colors can be saved', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click(); await page.keyboard.press('v');
  await expect(page.getByLabel('Scene', { exact: true })).not.toHaveValue('off');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('off');
  await page.getByLabel('Ambient light color', { exact: true }).fill('#003412');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Ambient light color', { exact: true })).toHaveValue('#003412');
});

test('failed library writes preserve presets and leave undo recovery available', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'binaural.presets.v1' && document.documentElement.dataset.blockStorage === 'true') throw new Error('Storage is full');
      write.call(this, key, value);
    };
    document.documentElement.dataset.blockStorage = 'true';
  });
  await page.getByRole('button', { name: 'Delete preset Quiet morning', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Storage is full');
  await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.evaluate(() => { document.documentElement.dataset.blockStorage = 'false'; });
  await page.getByRole('button', { name: 'Delete preset Quiet morning', exact: true }).click();
  await expect(page.locator('.saved-preset')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.blockStorage = 'true'; });
  await page.locator('#undo-edit').click(); await expect(page.locator('#notice')).toContainText('Storage is full');
  await expect(page.locator('.saved-preset')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.blockStorage = 'false'; });
  await page.locator('#undo-edit').click(); await expect(page.locator('.saved-preset')).toHaveCount(1);
  await page.reload(); await expect(page.locator('.saved-preset')).toHaveCount(1);
});

test('version one sessions still load and sharing enforces bounds and canonical fields', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sharePath = '/src/share.ts', modelPath = '/src/model.ts';
    const { sessionLink, readSharedSession } = await import(sharePath), { initialSession, parseSession } = await import(modelPath);
    const old = initialSession(); old.version = 1;
    const parsed = parseSession(old), canonical = readSharedSession(new URL(sessionLink({ ...old, privateFile: 'secret.mp3' })).hash);
    const reject = (hash: string) => { try { readSharedSession(hash); return false; } catch { return true; } };
    const invalidUtf8 = '#session=' + btoa(String.fromCharCode(255)).replace(/=+$/, '');
    return { version: parsed.version, canonical, oversized: reject('#session=' + 'a'.repeat(16001)), invalidUtf8: reject(invalidUtf8), anchor: readSharedSession('#visual-controls') };
  });
  expect(result.version).toBe(1); expect(result.canonical.version).toBe(2);
  expect(result.canonical).not.toHaveProperty('privateFile'); expect(result.oversized).toBe(true); expect(result.invalidUtf8).toBe(true); expect(result.anchor).toBeUndefined();
});
