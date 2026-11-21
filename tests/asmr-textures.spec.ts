import { expect, test } from '@playwright/test';
import { setSources } from './helpers/listening-sources';
import { loadAsmrExperience } from './helpers/asmr-discovery';
import type { AsmrPreset } from '../src/asmr-presets';
import type { AsmrSettings } from '../src/asmr-state';

const textureIds = ['fingertip-taps', 'keyboard', 'comb', 'fabric', 'rain-stick', 'soft-clicks'];
const originalPresetIds = [
  'glass-lantern', 'red-sweep', 'rose-brushes', 'paper-prism', 'blue-droplets', 'torch-whisper',
  'ear-cupping', 'left-ear-focus', 'right-ear-focus', 'alternating-cupping', 'slow-ear-sweep',
  'hands-close', 'cloth-cocoon', 'soft-crinkle-room', 'tiny-metal-taps', 'meadow-brushing',
];
const sensoryPresetIds = [
  'fingertip-duet', 'quiet-keyboard', 'comb-and-cloth', 'woven-hush', 'rain-stick-garden', 'little-object-tray',
  'left-soft-attention', 'right-comb-attention', 'soft-object-check', 'parcel-on-desk', 'shoulder-side-fabric', 'around-your-head',
];
const experienceIds = [
  'powder-brush', 'temple-brushing', 'slow-combing', 'hand-fan', 'close-ear-covers', 'behind-the-ears',
  'hollow-wood', 'glass-and-grain', 'tapping-contrast', 'paper-folds', 'crinkle-left', 'little-water-bowl',
];
const routineIds = ['pages-evening', 'hairbrush-unhurried', 'water-preparation', 'pencil-notes', 'unhurried-salon', 'quiet-desk-journey'];
const gestureIds = ['follow-my-light', 'brush-in-front', 'tap-and-follow', 'pencil-trace', 'close-object-study', 'ear-attention-lights', 'water-light-ritual'];
const spatialExperienceIds = ['brush-across-view', 'hands-near-and-far', 'comb-floating-up', 'fabric-ribbon',
  'paper-circling-light', 'small-tapping-visits', 'pages-and-pencil-light', 'hairbrush-and-mist-light'];
const detailExperienceIds = ['wooden-keepsakes', 'counting-on-glass', 'paper-beside-the-keys',
  'water-under-small-bells', 'trail-of-fingertips', 'comb-and-quiet-clicks'];
const spaceExperienceIds = ['reading-alcove', 'little-wooden-workshop', 'linen-room',
  'water-on-the-table', 'rain-stick-corner', 'after-hours-writing'];
const recordedExperienceIds = ['blanket-folds', 'blanket-left', 'blanket-right', 'zipper-details', 'pencil-studies',
  'sketchbook-turns', 'paper-and-pencil-hour', 'mist-at-the-temples', 'water-at-the-basin', 'fresh-towels',
  'unpacking-a-sketchbook', 'basin-and-cloth'];
const recordedGestureIds = ['hands-in-soft-light', 'hairbrush-at-each-ear', 'zipper-and-page-study',
  'pencil-lines-after-dark', 'mist-across-the-light', 'metal-points-in-the-dark', 'long-pencil-study', 'plastic-clicks-around-you'];
const plasticIds = ['plastic-quiet-approach', 'calculator-snap-detail', 'zip-ties-and-lids', 'hinge-clicks-by-ear',
  'casing-snap-by-ear', 'plastic-clicks-after-dark'];
const contrastIds = ['small-sound-sampler', 'unhurried-materials', 'brushing-with-a-pause'];
const recipeIds = [...originalPresetIds, ...sensoryPresetIds, ...experienceIds, ...routineIds, ...gestureIds,
  ...spatialExperienceIds, ...detailExperienceIds, ...spaceExperienceIds, ...recordedExperienceIds, ...recordedGestureIds, ...plasticIds, ...contrastIds];
interface RecipeSummary {
  id: string; group: string; validLight: boolean; canonical: boolean; repeatable: boolean; freshIds: boolean;
  layerCount: number; sources: string[]; spatialCount: number; knownSources: boolean;
}

test('six original textures fill deterministically and retain the caller normalization and seam contract', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async ids => {
    const texturePath = '/src/audio/asmr-textures.ts', synthesisPath = '/src/audio/asmr-synthesis.ts';
    const { fillAsmrTexture } = await import(texturePath), { asmrSample, ASMR_RATE } = await import(synthesisPath);
    function random(seed: number) {
      return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    }
    const unknown = new Float32Array([.1, .2, .3]), before = [...unknown];
    const ignored = ['unknown', '__proto__', 'constructor'].every(id => !fillAsmrTexture(id, unknown, 24000, random(7)));
    const textures = ids.flatMap(id => [24000, 48000].map(rate => {
      const first = new Float32Array(rate * 12), second = new Float32Array(first.length), different = new Float32Array(first.length);
      const recognized = fillAsmrTexture(id, first, rate, random(7853));
      fillAsmrTexture(id, second, rate, random(7853)); fillAsmrTexture(id, different, rate, random(8937));
      let finite = true, deterministic = true, changedSeed = false, energy = 0, signature = 0;
      for (let i = 0; i < first.length; i++) {
        finite &&= Number.isFinite(first[i]); deterministic &&= first[i] === second[i]; changedSeed ||= first[i] !== different[i];
        energy += first[i] ** 2; if (i % 127 === 0) signature += first[i] * (i % 97);
      }
      const finished: Float32Array = asmrSample(id); let bounded = true;
      for (const value of finished) bounded &&= Number.isFinite(value) && Math.abs(value) <= .700001;
      return { id, rate, recognized, finite, deterministic, changedSeed, energy, signature, bounded,
        first: finished[0], last: finished.at(-1), cached: finished === asmrSample(id), length: finished.length, expectedLength: ASMR_RATE * 12 };
    }));
    return { ignored, untouched: before.every((value, i) => value === unknown[i]), textures };
  }, textureIds);
  expect(results.ignored).toBe(true); expect(results.untouched).toBe(true);
  expect(results.textures).toHaveLength(12);
  for (const result of results.textures) {
    expect(result.recognized, result.id).toBe(true); expect(result.finite, result.id).toBe(true);
    expect(result.deterministic, result.id).toBe(true); expect(result.changedSeed, result.id).toBe(true);
    expect(result.energy, result.id).toBeGreaterThan(0); expect(result.bounded, result.id).toBe(true);
    expect(Math.abs(result.first), result.id).toBe(0); expect(Math.abs(result.last!), result.id).toBe(0);
    expect(result.cached, result.id).toBe(true); expect(result.length, result.id).toBe(result.expectedLength);
  }
  for (const rate of [24000, 48000]) expect(new Set(results.textures.filter(item => item.rate === rate).map(item => item.signature)).size).toBe(6);
});

test('all 102 ASMR recipes are canonical, cover every source, and reference existing lights', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const statePath = '/src/asmr-state.ts', presetPath = '/src/asmr-presets.ts', lightPath = '/src/trigger-presets.ts', extraPath = '/src/asmr-textures.ts';
    const { parseAsmr, asmrSounds, generatedAsmrSounds, recordedAsmrSounds }: typeof import('../src/asmr-state') = await import(statePath);
    const { asmrPresets } = await import(presetPath), { triggerPresets } = await import(lightPath), { extraAsmrTextures } = await import(extraPath);
    const canonical = (settings: AsmrSettings) =>
      ({ level: settings.level, focus: settings.focus ?? false, variation: settings.variation, space: settings.space,
        layers: settings.layers.map(({ id: _id, ...layer }) => layer) });
    return { sources: asmrSounds.map(({ id }: { id: string }) => id), generated: generatedAsmrSounds.length, recordings: recordedAsmrSounds.length,
      textures: extraAsmrTextures.map(({ id }: { id: string }) => id), lightCount: triggerPresets.length,
      presets: asmrPresets.map((preset: AsmrPreset) => {
        const settings = preset.make(), parsed = parseAsmr(settings), next = preset.make();
        const sources = parsed.layers.flatMap(layer => [layer.sound, ...(layer.spatial?.quietReturn?.sequence?.recordings ?? [])]);
        return { id: preset.id, group: preset.group ?? 'Layered mixes', validLight: triggerPresets.some((light: { id: string }) => light.id === preset.light),
          canonical: JSON.stringify(canonical(settings)) === JSON.stringify(canonical(parsed)),
          repeatable: JSON.stringify(canonical(settings)) === JSON.stringify(canonical(next)),
          freshIds: settings.layers.every((layer: { id: string }, i: number) => layer.id !== next.layers[i].id),
          layerCount: parsed.layers.length, sources,
          spatialCount: parsed.layers.filter(layer => layer.spatial).length,
          knownSources: sources.every(id => asmrSounds.some(source => source.id === id)),
        };
      }) as RecipeSummary[] };
  });
  expect(result.generated).toBe(15); expect(result.recordings).toBe(23); expect(result.lightCount).toBe(26);
  expect(result.textures).toEqual(textureIds);
  expect(result.presets.map(preset => preset.id)).toEqual(recipeIds);
  expect(new Set(result.presets.map(preset => preset.id)).size).toBe(recipeIds.length);
  expect([...new Set(result.presets.flatMap(preset => preset.sources))].sort()).toEqual([...result.sources].sort());
  const sensory = result.presets.filter(preset => preset.group === 'Sensory textures');
  expect(sensory.map(preset => preset.id)).toEqual(sensoryPresetIds);
  expect([...new Set(sensory.map(preset => preset.layerCount))].sort()).toEqual([1, 2, 3, 4]);
  expect(sensory.filter(preset => preset.spatialCount).map(preset => preset.id)).toEqual(['shoulder-side-fabric', 'around-your-head']);
  const details = result.presets.filter(preset => preset.group === 'Small sound details');
  expect(details.map(preset => preset.id)).toEqual(detailExperienceIds);
  expect([...new Set(details.flatMap(preset => preset.sources))].sort())
    .toEqual(['chimes', 'comb', 'fingertip-taps', 'glass', 'keyboard', 'paper', 'soft-clicks', 'water', 'wood']);
  expect(details.every(preset => preset.layerCount >= 1 && preset.layerCount <= 2)).toBe(true);
  expect(details.filter(preset => preset.spatialCount).map(preset => preset.id)).toEqual(['trail-of-fingertips']);
  const spaces = result.presets.filter(preset => preset.group === 'Quiet rooms');
  expect(spaces.map(preset => preset.id)).toEqual(spaceExperienceIds);
  expect([...new Set(spaces.flatMap(preset => preset.sources))].sort()).toEqual([
    'fabric', 'glass', 'keyboard', 'rain-stick', 'recorded-cloth', 'recorded-grass',
    'recorded-metal', 'recorded-pages', 'recorded-writing', 'water', 'wood',
  ]);
  expect(spaces.every(preset => preset.layerCount >= 1 && preset.layerCount <= 2 && preset.spatialCount === 0)).toBe(true);
  const recordings = result.presets.filter(preset => preset.group === 'Everyday recordings');
  expect(recordings.map(preset => preset.id)).toEqual(recordedExperienceIds);
  expect([...new Set(recordings.flatMap(preset => preset.sources))].sort()).toEqual([
    'recorded-blanket', 'recorded-mist', 'recorded-running-water', 'recorded-sketchbook', 'recorded-sketching', 'recorded-zipper',
  ]);
  expect(recordings.every(preset => preset.layerCount >= 1 && preset.layerCount <= 2)).toBe(true);
  expect(recordings.filter(preset => preset.spatialCount).map(preset => preset.id)).toEqual(['mist-at-the-temples']);
  for (const preset of result.presets) {
    expect(preset.canonical, preset.id).toBe(true); expect(preset.repeatable, preset.id).toBe(true); expect(preset.freshIds, preset.id).toBe(true);
    expect(preset.validLight, preset.id).toBe(true); expect(preset.knownSources, preset.id).toBe(true);
    expect(preset.layerCount, preset.id).toBeGreaterThanOrEqual(1); expect(preset.layerCount, preset.id).toBeLessThanOrEqual(4);
    expect(preset.spatialCount, preset.id).toBeLessThanOrEqual(1);
  }
});

test('every recipe renders finite non-silent bounded offline stereo through the actual mixer', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const mixerPath = '/src/audio/asmr-mixer.ts', assetsPath = '/src/audio/asmr-assets.ts', presetPath = '/src/asmr-presets.ts';
    const hrtfPath = '/src/audio/hrtf-audio.ts';
    const { AsmrMixer } = await import(mixerPath), { prepareAsmrRecordings } = await import(assetsPath), { asmrPresets } = await import(presetPath);
    const { prepareHrtfAudio } = await import(hrtfPath);
    const results = [];
    for (const preset of asmrPresets) {
      const settings: AsmrSettings = preset.make(); await prepareAsmrRecordings(settings);
      const timing = settings.layers.find(layer => layer.spatial?.quietReturn?.syncClicks)?.spatial?.quietReturn;
      const duration = timing?.sequence ? Math.ceil(3 * (timing.approach + 1) + 2 * (timing.gap + timing.sequence.gapSpread))
        : timing || preset.id === 'plastic-quiet-approach' ? 14
        : preset.id === 'zip-ties-and-lids' || preset.group === 'Sound contrasts' ? 12 : 2.5;
      const context = new OfflineAudioContext(2, duration * 24000, 24000);
      await prepareHrtfAudio(context, settings);
      const mixer = new AsmrMixer(context, context.destination);
      mixer.update(settings); const buffer = await context.startRendering();
      let finite = true, peak = 0, energy = 0;
      const earEnergy = [];
      for (let channel = 0; channel < 2; channel++) {
        let channelEnergy = 0;
        for (const value of buffer.getChannelData(channel)) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); energy += value * value; channelEnergy += value * value; }
        earEnergy.push(channelEnergy);
      }
      mixer.dispose(); results.push({ id: preset.id, finite, peak, energy, earEnergy });
    }
    return results;
  });
  expect(results.map(preset => preset.id)).toEqual(recipeIds);
  for (const result of results) {
    expect(result.finite, result.id).toBe(true); expect(result.energy, result.id).toBeGreaterThan(0); expect(result.peak, result.id).toBeLessThan(1);
    if ([...spatialExperienceIds, ...detailExperienceIds, ...spaceExperienceIds, ...recordedGestureIds, ...plasticIds, ...contrastIds, ...recordedExperienceIds.filter(id => !['blanket-left', 'blanket-right'].includes(id))].includes(result.id)) for (const energy of result.earEnergy) expect(energy, result.id).toBeGreaterThan(0);
  }
});

test('all twelve sensory recipes load sounds and approved soft paired lights without starting playback', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/'); await setSources(page, 'asmr');
  const pairedSeeds = await page.evaluate(async () => {
    const presetPath = '/src/asmr-presets.ts', lightPath = '/src/trigger-presets.ts';
    const { asmrPresets } = await import(presetPath), { triggerPresets } = await import(lightPath);
    return asmrPresets.map((preset: { id: string; light: string }) => ({ id: preset.id,
      seed: triggerPresets.find((light: { id: string }) => light.id === preset.light).settings.seed }));
  });
  for (const id of sensoryPresetIds) {
    await loadAsmrExperience(page, id);
    if (id === sensoryPresetIds[0]) await page.getByRole('dialog', { name: 'Moving visual trigger', exact: true }).getByRole('button', { name: 'Start visual', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Moving visual trigger', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Enable light triggers', { exact: true })).toBeChecked();
    await expect(page.locator('#trigger-preset')).toHaveValue('custom');
    await expect(page.locator('#trigger-seed')).toHaveValue(String(pairedSeeds.find((pair: { id: string }) => pair.id === id).seed));
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
});
