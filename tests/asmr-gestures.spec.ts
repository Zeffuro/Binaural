import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadAsmrExperience } from './helpers/asmr-discovery';

test('gesture settings migrate strictly and all seven paired recipes survive session round trips', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const triggerPath = '/src/trigger-state.ts', presetPath = '/src/asmr-gesture-presets.ts', adapterPath = '/src/asmr-explorer.ts', modelPath = '/src/model.ts';
    const { defaultTriggerSettings, parseTriggerSettings } = await import(triggerPath), { asmrGesturePresets } = await import(presetPath);
    const { asmrExplorerPresets } = await import(adapterPath), { parseSession } = await import(modelPath);
    const old = defaultTriggerSettings(); delete old.syncAsmr; delete old.gesture;
    const rejected = [null, 'true', 1].every(syncAsmr => { try { parseTriggerSettings({ ...old, syncAsmr }); return false; } catch { return true; } }) &&
      ['strobe', 1, null].every(gesture => { try { parseTriggerSettings({ ...old, gesture }); return false; } catch { return true; } });
    return { legacy: parseTriggerSettings(old), rejected,
      recipes: asmrExplorerPresets().filter((preset: { id: string }) => asmrGesturePresets.some((item: { id: string }) => preset.id === `asmr-${item.id}`))
        .map((preset: { session: unknown }) => parseSession(JSON.parse(JSON.stringify(preset.session)))) };
  });
  expect(result.legacy.syncAsmr).toBe(false); expect(result.legacy.gesture).toBe('auto'); expect(result.rejected).toBe(true);
  expect(result.recipes).toHaveLength(7);
  expect(result.recipes.map((recipe: any) => recipe.visual.triggers.gesture)).toEqual(['follow', 'brush', 'tap', 'trace', 'inspect', 'ear', 'drop']);
  for (const recipe of result.recipes) {
    expect(recipe.mode).toBe('asmr'); expect(recipe.visual.scene).toBe('triggers'); expect(recipe.visual.triggers.syncAsmr).toBe(true);
    expect(recipe.visual.triggers.brightness).toBe(.3); expect(recipe.asmr.layers.length).toBeLessThanOrEqual(2);
  }
});

test('all gesture families match cue sides, stay deterministic and respect off, still, manual position and black', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/trigger-renderer.ts', statePath = '/src/trigger-state.ts';
    const { TriggerRenderer } = await import(rendererPath), { defaultTriggerSettings } = await import(statePath);
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext('2d')!, renderer = new TriggerRenderer();
    const settings = { ...defaultTriggerSettings(), style: 'gesture', syncAsmr: true, gesture: 'auto', softness: 0, glow: 0 };
    const cue = { id: 'near', kind: 'follow', strength: .8, contact: .6, pan: -.8, progress: .3, time: 1 };
    const draw = (state = settings, cues = [cue], light = 1) => {
      renderer.render(ctx, 480, 270, state, { glass: 1, light, energy: 0, pan: 0, cues });
      const data = ctx.getImageData(0, 0, 480, 270).data;
      let hash = 2166136261, maximum = 0;
      for (let i = 0; i < data.length; i++) { hash = Math.imul(hash ^ data[i], 16777619); if (i % 4 !== 3) maximum = Math.max(maximum, data[i]); }
      return { data, hash, maximum };
    };
    const quiet = draw(settings, []), families = [];
    const centroid = (data: Uint8ClampedArray) => {
      let energy = 0, moment = 0;
      for (let i = 0; i < data.length; i += 4) {
        const amount = Math.max(0, data[i] + data[i + 1] + data[i + 2] - quiet.data[i] - quiet.data[i + 1] - quiet.data[i + 2]);
        energy += amount; moment += amount * (i / 4 % 480);
      }
      return { x: moment / Math.max(1, energy), energy };
    };
    for (const kind of ['follow', 'brush', 'tap', 'trace', 'inspect', 'ear', 'drop']) {
      const left = draw(settings, [{ ...cue, kind }]), right = draw(settings, [{ ...cue, kind, pan: .8 }]);
      families.push({ kind, left: centroid(left.data), right: centroid(right.data), hash: left.hash, repeated: draw(settings, [{ ...cue, kind }]).hash });
    }
    const changed = [{ ...cue, pan: .7, progress: .8, strength: .35 }];
    const off = { ...settings, syncAsmr: false }, still = { ...settings, speed: 0, drift: 0, lightSpeed: 0 };
    const manual = { ...settings, path: 'manual', offsetX: -.65, offsetY: .2 };
    const manualOtherSide = [{ ...cue, pan: .8 }];
    return { families, quietStable: quiet.hash === draw(settings, [], 9).hash,
      offStable: draw(off).hash === draw(off, changed).hash,
      stillStable: draw(still).hash === draw(still, changed).hash,
      manualStable: draw(manual).hash === draw(manual, manualOtherSide).hash,
      black: draw({ ...settings, brightness: 0 }).maximum,
      intense: draw({ ...settings, brightness: 4 }).maximum, normal: draw(settings).maximum };
  });
  for (const family of result.families) {
    expect(family.left.energy, family.kind).toBeGreaterThan(1000); expect(family.right.energy, family.kind).toBeGreaterThan(1000);
    expect(family.left.x, family.kind).toBeLessThan(240); expect(family.right.x, family.kind).toBeGreaterThan(240);
    expect(family.hash, family.kind).toBe(family.repeated);
  }
  expect(new Set(result.families.map((family: any) => family.hash)).size).toBe(7);
  expect(result.quietStable).toBe(true); expect(result.offStable).toBe(true); expect(result.stillStable).toBe(true); expect(result.manualStable).toBe(true);
  expect(result.black).toBe(0); expect(result.intense).toBeGreaterThan(result.normal);
});

test('all paired gestures load through the shared explorer with one approval and save without persisting consent', async ({ page }) => {
  await page.goto('/');
  const recipes = ['follow-my-light', 'brush-in-front', 'tap-and-follow', 'pencil-trace', 'close-object-study', 'ear-attention-lights', 'water-light-ritual'];
  for (const id of recipes) {
    await loadAsmrExperience(page, id);
    if (id === recipes[0]) await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.locator('#preset-explorer')).not.toBeVisible();
    await expect(page.locator('#trigger-enable')).toBeChecked(); await expect(page.locator('#trigger-sync-asmr')).toBeChecked();
    await expect(page.locator('.scene-drawing')).toBeVisible(); await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cues', '0');
  }
  await page.locator('#save-preset').click(); await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.locator('#trigger-sync-asmr')).toBeChecked(); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await page.locator('#share-session').click(); const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  await page.goto('about:blank'); await page.goto(link);
  await expect(page.locator('#trigger-sync-asmr')).toBeChecked(); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('@live brush cues follow actual ears, freeze on pause and disappear on mute and stop', async ({ page }) => {
  await page.goto('/'); await loadAsmrExperience(page, 'brush-in-front');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await page.locator('[data-placement=left]').click();
  await page.locator('#play').click(); await page.locator('.scene-drawing').scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await page.locator('.scene-drawing').getAttribute('data-cues'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator('.scene-drawing').getAttribute('data-cue-pan'))).toBeLessThan(-.7);
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const frozen = await page.locator('.scene-drawing').getAttribute('data-cue-time');
  await page.waitForTimeout(180); await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cue-time', frozen!);
  await page.locator('#pause').click();
  await page.getByRole('button', { name: 'Mute sound 1', exact: true }).click();
  await page.locator('.scene-drawing').scrollIntoViewIfNeeded();
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cues', '0');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cues', '0');
});

test('@live emergency stop cancels a pending paired load and cannot restart audio or consent', async ({ page }) => {
  await page.goto('/'); await loadAsmrExperience(page, 'follow-my-light');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  await page.evaluate(async () => {
    const path = '/src/audio/engine.ts', { AudioEngine } = await import(path);
    const stop = AudioEngine.prototype.stop;
    AudioEngine.prototype.stop = async function(...args: unknown[]) { await new Promise(resolve => setTimeout(resolve, 300)); return stop.apply(this, args); };
  });
  await page.locator('#asmr-browse').click();
  await page.locator('[data-play-preset=asmr-brush-in-front]').click();
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.waitForTimeout(600);
  await expect(page.locator('#trigger-enable')).not.toBeChecked(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })).toHaveCount(0);
});

test('gesture controls fit mobile, keep advanced brightness and pass accessibility in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/'); await loadAsmrExperience(page, 'brush-in-front');
  await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
  await page.getByLabel('ASMR pace', { exact: true }).selectOption('still');
  await page.getByLabel('ASMR position', { exact: true }).selectOption('left');
  await page.locator('#trigger-controls details > summary').click();
  await page.getByRole('slider', { name: 'Brightness', exact: true }).fill('4');
  await expect(page.getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('4');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#trigger-controls').analyze()).violations).toEqual([]);
  }
});

test('video capture includes cue-driven gestures and freezes them under reduced motion', async ({ page }) => {
  await page.goto('/credits.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="transport"></div><div id="visual-controls"></div><style>.scene-viewport{width:640px;height:360px;position:relative}[hidden]{display:none!important}</style>';
    const path = '/src/visuals.ts', { setupVisuals } = await import(path);
    const silence = new Uint8Array(1024).fill(128);
    const frame = { frequency: new Uint8Array(512), waveform: silence, left: silence, right: silence, time: 1,
      asmr: [{ id: 'brush', kind: 'brush', strength: .8, contact: .4, progress: .3, pan: -.8, time: 1 }] };
    const visual = setupVisuals(() => frame);
    (window as any).gestureCapture = { frame, visual };
  });
  await page.locator('#scene-mode').selectOption('triggers'); await page.locator('#trigger-enable').check();
  await page.locator('#trigger-preset').selectOption('gesture-brush');
  await page.evaluate(() => { const probe = (window as any).gestureCapture; probe.visual.transport(true); probe.capture = probe.visual.createCapture(320, 180); });
  const pixels = () => page.evaluate(() => {
    const probe = (window as any).gestureCapture; probe.capture.draw(); const canvas = probe.capture.canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261; for (const value of data) hash = Math.imul(hash ^ value, 16777619);
    return { hash, width: canvas.width, height: canvas.height, connected: canvas.isConnected };
  });
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cue-pan', '-0.800');
  const first = await pixels(); expect(first).toMatchObject({ width: 320, height: 180, connected: false });
  await page.evaluate(() => { (window as any).gestureCapture.frame.asmr[0].pan = .8; });
  await expect(page.locator('.scene-drawing')).toHaveAttribute('data-cue-pan', '0.800');
  expect((await pixels()).hash).not.toBe(first.hash);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const frozen = await pixels();
  await page.evaluate(() => { (window as any).gestureCapture.frame.asmr[0].pan = -.5; });
  await page.waitForTimeout(160); expect(await pixels()).toEqual(frozen);
  await page.evaluate(() => { (window as any).gestureCapture.capture.dispose(); });
});
