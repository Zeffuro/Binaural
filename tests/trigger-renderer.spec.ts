import { expect, test } from '@playwright/test';

test('every original light preset renders distinctly and deterministic source lighting is independent of glass movement', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/trigger-renderer.ts', presetPath = '/src/trigger-presets.ts';
    const { TriggerRenderer } = await import(rendererPath), { triggerPresets } = await import(presetPath);
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext('2d')!, renderer = new TriggerRenderer();
    const draw = (settings: any, glass = 0, light = 0) => {
      renderer.render(ctx, 480, 270, settings, { glass, light, energy: 0, pan: 0,
        cues: [{ id: 'cue', kind: 'follow', pan: -.3, strength: .8, progress: .35, contact: .7, time: 1 }] });
      const bytes = ctx.getImageData(0, 0, 480, 270).data; let hash = 2166136261, maximum = 0;
      for (let i = 0; i < bytes.length; i++) { hash = Math.imul(hash ^ bytes[i], 16777619); if (i % 4 !== 3) maximum = Math.max(maximum, bytes[i]); }
      return { hash, maximum };
    };
    const presets = triggerPresets.map((preset: any) => ({ id: preset.id, ...draw(preset.settings) }));
    const state = { ...triggerPresets[0].settings, speed: 0, softness: 0, glow: .2 };
    const initial = draw(state), repeated = draw(state); renderer.reset(); const reset = draw(state);
    const movedLight = draw(state, 0, 2), movedGlass = draw(state, 2, 0);
    const lampOff = [draw({ ...state, light: 0 }, 0, 0), draw({ ...state, light: 0 }, 0, 2)];
    const warmLamp = draw({ ...state, lampColor: '#ffb36c' });
    const scanAccent = [draw({ ...state, style: 'scan' }), draw({ ...state, style: 'scan', accent: '#3355ff' })];
    const black = ['kaleidoscope', 'scan', 'torch'].map(style => draw({ ...state, style, brightness: 0 }).maximum);
    return { presets, initial, repeated, reset, movedLight, movedGlass, lampOff, warmLamp, scanAccent, black };
  });
  expect(result.presets).toHaveLength(26);
  expect(new Set(result.presets.map((preset: any) => preset.hash)).size).toBe(26);
  expect(result.presets.every((preset: any) => preset.maximum > 20)).toBe(true);
  expect(result.repeated).toEqual(result.initial); expect(result.reset).toEqual(result.initial);
  expect(result.movedLight.hash).not.toBe(result.initial.hash); expect(result.movedGlass.hash).not.toBe(result.initial.hash);
  expect(result.lampOff[0]).toEqual(result.lampOff[1]); expect(result.warmLamp.hash).not.toBe(result.initial.hash);
  expect(result.black).toEqual([0, 0, 0]);
  expect(result.scanAccent[0].hash).not.toBe(result.scanAccent[1].hash);
});

test('high exposure produces substantially brighter light in every style without changing black or determinism', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/trigger-renderer.ts', statePath = '/src/trigger-state.ts';
    const { TriggerRenderer } = await import(rendererPath), { defaultTriggerSettings } = await import(statePath);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d')!, renderer = new TriggerRenderer();
    const metrics = (style: string, brightness: number, light = .8) => {
      renderer.render(ctx, 320, 240, { ...defaultTriggerSettings(), style, brightness, light, path: 'manual', size: .8, lampColor: '#ffffff', color: '#ffffff', accent: '#ffffff' }, { glass: .2, light: .3, energy: 0, pan: 0 });
      const data = ctx.getImageData(0, 0, 320, 240).data; let sum = 0, white = 0, hash = 2166136261;
      for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (Math.min(data[i], data[i + 1], data[i + 2]) > 235) white++;
        hash = Math.imul(hash ^ data[i] ^ data[i + 1] << 8 ^ data[i + 2] << 16, 16777619);
      }
      return { mean: sum / (320 * 240), white, hash };
    };
    return ['kaleidoscope', 'scan', 'torch'].map(style => ({ style, standard: metrics(style, 1), bright: metrics(style, 1.5), intense: metrics(style, 4), repeated: metrics(style, 4), black: metrics(style, 0), lamp: [metrics(style, 1, 1), metrics(style, 1, 3)] }));
  });
  for (const item of result) {
    expect(item.bright.mean, item.style).toBeGreaterThan(item.standard.mean * 1.1);
    expect(item.intense.mean, item.style).toBeGreaterThan(Math.min(item.standard.mean * 1.5, item.standard.mean + (255 - item.standard.mean) * .7));
    expect(item.intense.white, item.style).toBeGreaterThan(item.standard.white);
    expect(item.repeated, item.style).toEqual(item.intense);
    expect(item.black.mean, item.style).toBe(0);
    if (item.style === 'kaleidoscope') expect(item.lamp[1].mean).toBeGreaterThan(item.lamp[0].mean + 5);
  }
});

test('all glass shapes, mirror layouts and light paths render at wide and narrow dimensions without touching caller state', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/trigger-renderer.ts', statePath = '/src/trigger-state.ts';
    const { TriggerRenderer } = await import(rendererPath), { defaultTriggerSettings, triggerMotifs, triggerPaths } = await import(statePath);
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d')!, renderer = new TriggerRenderer(), settings = defaultTriggerSettings();
    let cases = 0, errors = 0;
    for (const motif of triggerMotifs) for (const layout of ['tiled', 'radial']) for (const path of triggerPaths) {
      for (const [width, height] of [[640, 360], [180, 320]]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = .7; ctx.globalCompositeOperation = 'multiply'; ctx.filter = 'none';
        renderer.render(ctx, width, height, { ...settings, motif, layout, path, zoom: .5, symmetry: 16 }, { glass: 1, light: 2, energy: .8, pan: -.7 });
        if (ctx.globalAlpha < .69 || ctx.globalAlpha > .71 || ctx.globalCompositeOperation !== 'multiply' || ctx.filter !== 'none') errors++;
        cases++;
      }
    }
    return { cases, errors };
  });
  expect(result).toEqual({ cases: 80, errors: 0 });
});

test('trigger settings reject malformed imports, retain safe custom values and upgrade older visual sessions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const statePath = '/src/trigger-state.ts', visualPath = '/src/visual-state.ts';
    const { defaultTriggerSettings, parseTriggerSettings, triggerRanges } = await import(statePath), { defaultVisualSettings, parseVisualSettings } = await import(visualPath);
    const state = defaultTriggerSettings(), old = defaultVisualSettings(); delete old.triggers;
    const bad = [null, [], { ...state, preset: 'external' }, { ...state, style: 'flash' }, { ...state, path: 'random-url' }, { ...state, color: '#fff' }, { ...state, lampColor: 'red' }, { ...state, seed: 1.5 }];
    for (const [key, [min, max]] of Object.entries(triggerRanges) as [string, number[]][]) bad.push({ ...state, [key]: min - .01 }, { ...state, [key]: max + .01 }, { ...state, [key]: Infinity });
    const custom = { ...state, preset: 'custom', lightSpeed: 0, speed: 0, offsetX: -.37, offsetY: .61, color: '#00abcf', lampColor: '#ffffff' };
    return { rejected: bad.every(value => { try { parseTriggerSettings(value); return false; } catch { return true; } }),
      safe: parseTriggerSettings({ ...custom, consent: true, independent: true, fullscreen: true, video: 'blob:private' }), custom,
      upgrade: parseVisualSettings(old).triggers, expected: state };
  });
  expect(result.rejected).toBe(true); expect(result.safe).toEqual(result.custom); expect(result.upgrade).toEqual(result.expected);
});
