import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { makeBwgFixture } from './helpers/bwg';
import { makeWaveFixture, makeWavePack } from './helpers/wave';

function backgroundPreset(id = 1, file = 'Bkgnd.dll'): number[] {
  const bytes = new Uint8Array(makeBwgFixture());
  new DataView(bytes.buffer).setUint32(1316, id, true);
  bytes.set(new TextEncoder().encode(file), 1320);
  return Array.from(bytes);
}

test('WAV decoding covers PCM widths, float, channels, odd terminal data and padded auxiliary chunks', async ({ page }) => {
  await page.goto('/');
  const fixtures = [8, 16, 24, 32].flatMap(bits => [1, 2].map(channels => makeWaveFixture({ bits, channels })))
    .concat([1, 2].map(channels => makeWaveFixture({ bits: 32, float: true, channels })),
      [makeWaveFixture({ bits: 8, odd: true, auxiliary: true })]);
  const result = await page.evaluate(async fixtures => {
    const path = '/src/import/wave.ts';
    const { readPcmWave } = await import(path);
    return fixtures.map(({ bytes: data, expected }) => {
      const bytes = new Uint8Array(data), padded = new Uint8Array(bytes.length + 10); padded.set(bytes, 3);
      const decoded = readPcmWave(padded.subarray(3, 3 + bytes.length));
      const buffer = readPcmWave(bytes.buffer);
      bytes.fill(0); padded.fill(0);
      return { rate: decoded.rate, channels: decoded.channels.map((values: Float32Array) => Array.from(values)),
        exact: JSON.stringify(buffer.channels.map((values: Float32Array) => Array.from(values))) === JSON.stringify(expected) };
    });
  }, fixtures);
  expect(result).toEqual(fixtures.map(fixture => ({ rate: 20000, channels: fixture.expected, exact: true })));
});

test('WAV decoding rejects truncations, inconsistent formats, duplicate chunks and nonfinite audio', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async fixture => {
    const path = '/src/import/wave.ts';
    const { readPcmWave } = await import(path);
    const bytes = new Uint8Array(fixture.bytes), o = fixture.offsets, unexpected: string[] = [];
    const reject = (label: string, value: Uint8Array): void => {
      try { readPcmWave(value); unexpected.push(label); } catch { /* Expected malformed input. */ }
    };
    for (let end = 0; end < bytes.length; end++) reject(`prefix ${end}`, bytes.subarray(0, end));
    const mutations: [string, number, number, boolean?][] = [
      ['RIFF', 0, 0], ['WAVE', 8, 0], ['RIFF size', 4, bytes.length],
      ['missing fmt', 12, 0], ['missing data', o.data - 8, 0], ['short fmt', o.fmt - 4, 15],
      ['chunk overrun', o.data - 4, 0xffffffff], ['empty data', o.data - 4, 0],
      ['unsupported encoding', o.fmt, 2, true],
      ['no channels', o.fmt + 2, 0, true], ['three channels', o.fmt + 2, 3, true],
      ['slow rate', o.fmt + 4, 3999], ['fast rate', o.fmt + 4, 192001],
      ['alignment', o.fmt + 12, 1, true], ['unsupported bits', o.fmt + 14, 12, true],
    ];
    for (const [label, at, value, short] of mutations) {
      const altered = bytes.slice(), view = new DataView(altered.buffer);
      if (short) view.setUint16(at, value, true); else view.setUint32(at, value, true);
      reject(label, altered);
    }
    for (const kind of ['fmt', 'data']) {
      const chunk = kind === 'fmt' ? bytes.slice(12, 36) : bytes.slice(o.data - 8);
      const altered = new Uint8Array(bytes.length + chunk.length); altered.set(bytes); altered.set(chunk, bytes.length);
      new DataView(altered.buffer).setUint32(4, altered.length - 8, true); reject(`duplicate ${kind}`, altered);
    }
    const unaligned = bytes.slice(0, -1), unalignedView = new DataView(unaligned.buffer);
    unalignedView.setUint32(4, unaligned.length - 8, true); unalignedView.setUint32(o.data - 4, o.dataSize - 1, true);
    reject('partial frame', unaligned);
    const trailing = new Uint8Array(bytes.length + 1); trailing.set(bytes);
    new DataView(trailing.buffer).setUint32(4, trailing.length - 8, true); reject('short trailing chunk', trailing);
    const float = bytes.slice(), floatView = new DataView(float.buffer);
    floatView.setUint16(o.fmt, 3, true); floatView.setUint16(o.fmt + 14, 32, true); floatView.setUint16(o.fmt + 12, 4, true);
    for (const value of [NaN, Infinity, -Infinity, 1.01, -1.01]) {
      floatView.setFloat32(o.data, value, true); reject(`float ${value}`, float);
    }
    floatView.setUint16(o.fmt + 14, 16, true); reject('unsupported float width', float);
    reject('input bound', new Uint8Array(64 * 1024 * 1024 + 1));
    return unexpected;
  }, makeWaveFixture({ bits: 32 }));
  expect(result).toEqual([]);
});

test('optional local sound packs decode all 17 clips and resolve every dependent built-in', async ({ page }) => {
  const packPaths = [process.env.BWG_BKGND ?? '', process.env.BWG_BGEXTRA ?? ''];
  const library = process.env.BWG_LIBRARY ?? '';
  test.skip(![...packPaths, library].every(existsSync), 'Optional locally supplied BWGen files; recordings are not distributed.');
  await page.goto('/');
  const result = await page.evaluate(async ({ packs, library }) => {
    const assetsPath = '/src/background-assets.ts', pePath = '/src/import/pe-resources.ts';
    const wavePath = '/src/import/wave.ts', libraryPath = '/src/import/bwg-library.ts', referencePath = '/src/import/bwg-background.ts';
    const { BackgroundAssets } = await import(assetsPath), { readPeResources } = await import(pePath);
    const { readPcmWave } = await import(wavePath), { parseBwgLibrary } = await import(libraryPath);
    const { backgroundReference } = await import(referencePath);
    const assets = new BackgroundAssets(); await assets.ready; await assets.clear();
    const decoded = [];
    for (const [index, data] of packs.entries()) {
      const resources = readPeResources(new Uint8Array(data)).filter((resource: { type: number | string }) => resource.type === 10);
      for (const resource of resources) {
        const sample = readPcmWave(resource.data);
        decoded.push({ pack: index, id: resource.id, rate: sample.rate, channels: sample.channels.length,
          finite: sample.channels.every((channel: Float32Array) => channel.length > 0 && channel.every(Number.isFinite)) });
      }
      await assets.importPack(new File([new Uint8Array(data)], index ? 'Bgextra.dll' : 'Bkgnd.dll'));
    }
    const dependencies = parseBwgLibrary(new Uint8Array(library)).filter((preset: Parameters<typeof backgroundReference>[0]) => backgroundReference(preset));
    const resolved = [];
    for (const preset of dependencies) {
      const bound = await assets.resolve(preset);
      resolved.push({ preset: preset.name, clip: bound?.name, channels: bound?.sample.channels.length });
    }
    const count = assets.count; await assets.clear();
    return { count, decoded, resolved };
  }, { packs: packPaths.map(path => Array.from(readFileSync(path))), library: Array.from(readFileSync(library)) });
  expect(result.count).toBe(17);
  expect(result.decoded).toHaveLength(17);
  expect(result.decoded.every(clip => clip.finite && clip.rate === 20000 && [1, 2].includes(clip.channels))).toBe(true);
  expect(result.decoded.filter(clip => clip.pack === 0).map(clip => clip.id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.decoded.filter(clip => clip.pack === 1).map(clip => clip.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(result.resolved).toHaveLength(5);
  expect(result.resolved.every(clip => !!clip.clip && !!clip.channels)).toBe(true);
});

test('custom background bindings persist across reload and invalid replacement preserves the clip', async ({ page }) => {
  await page.goto('/');
  const payload = { preset: backgroundPreset(0x401, 'C:\\Original\\Custom.DLL'), wave: makeWaveFixture({ bits: 8, odd: true }).bytes,
    replacement: makeWaveFixture({ bits: 24, channels: 2, rate: 22050 }).bytes };
  const initial = await page.evaluate(async ({ preset: data, wave }) => {
    const path = '/src/background-assets.ts', format = '/src/import/bwg-format.ts';
    const { BackgroundAssets } = await import(path), { parseBwg } = await import(format);
    const assets = new BackgroundAssets(); await assets.ready; await assets.clear();
    const preset = parseBwg(new Uint8Array(data));
    await assets.bindWave(preset, new File([new Uint8Array(wave)], 'original.wav'));
    let rejected = false;
    try { await assets.bindWave(preset, new File([new Uint8Array([1, 2, 3])], 'broken.wav')); } catch { rejected = true; }
    const bound = await assets.resolve(preset);
    return { rejected, count: assets.count, persistent: assets.persistent, name: bound?.name, interval: bound?.interval,
      channels: bound?.sample.channels.map((channel: Float32Array) => Array.from(channel)) };
  }, payload);
  expect(initial).toEqual({ rejected: true, count: 1, persistent: true, name: 'original.wav', interval: true,
    channels: [[-1, -0.5, 0]] });
  await page.reload();
  const restored = await page.evaluate(async ({ preset: data, replacement: replacementBytes }) => {
    const path = '/src/background-assets.ts', format = '/src/import/bwg-format.ts';
    const { BackgroundAssets } = await import(path), { parseBwg } = await import(format);
    const assets = new BackgroundAssets(); await assets.ready;
    const preset = parseBwg(new Uint8Array(data)), bound = await assets.resolve(preset);
    const previous = { name: bound?.name, count: assets.count, rate: bound?.sample.rate };
    await assets.bindWave(preset, new File([new Uint8Array(replacementBytes)], 'replacement.wav'));
    const clip = await assets.resolve(preset);
    const replacement = { name: clip?.name, rate: clip?.sample.rate, channels: clip?.sample.channels.length };
    await assets.clear();
    const next = new BackgroundAssets(); await next.ready;
    return { previous, replacement, count: assets.count, nextCount: next.count, missing: !await next.resolve(preset) };
  }, payload);
  expect(restored).toEqual({ previous: { name: 'original.wav', count: 1, rate: 20000 },
    replacement: { name: 'replacement.wav', rate: 22050, channels: 2 },
    count: 0, nextCount: 0, missing: true });
});

test('sound pack imports all six original synthetic resources atomically and restores their bindings', async ({ page }) => {
  await page.goto('/');
  const waves = Array.from({ length: 6 }, (_, index) => makeWaveFixture({ bits: 8, channels: index % 2 + 1 }).bytes);
  const broken = waves.map(wave => [...wave]);
  broken[0] = makeWaveFixture({ channels: 2, rate: 22050 }).bytes; broken[5][0] = 0;
  const payload = { presets: Array.from({ length: 6 }, (_, index) => backgroundPreset(index + 1)),
    valid: makeWavePack(waves), broken: makeWavePack(broken), missing: makeWavePack(waves.slice(0, 5)),
    ambiguous: makeWavePack([...waves, waves[0]], [1, 2, 3, 4, 5, 6, 1]) };
  const imported = await page.evaluate(async ({ presets: data, valid, broken, missing, ambiguous }) => {
    const path = '/src/background-assets.ts', format = '/src/import/bwg-format.ts';
    const { BackgroundAssets } = await import(path), { parseBwg } = await import(format);
    const assets = new BackgroundAssets(); await assets.ready; await assets.clear();
    const presets = data.map(bytes => parseBwg(new Uint8Array(bytes)));
    const imported = await assets.importPack(new File([new Uint8Array(valid)], 'BKGND.DLL'));
    const rejects: string[] = [];
    for (const [label, bytes, name] of [['broken', broken, 'Bkgnd.dll'], ['missing', missing, 'Bkgnd.dll'],
      ['ambiguous', ambiguous, 'Bkgnd.dll'], ['unknown', valid, 'Unknown.dll']] as [string, number[], string][]) {
      try { await assets.importPack(new File([new Uint8Array(bytes)], name)); } catch { rejects.push(label); }
    }
    const resolved = await Promise.all(presets.map(preset => assets.resolve(preset)));
    return { imported, count: assets.count, rejects, clips: resolved.map(bound => ({ name: bound?.name,
      interval: bound?.interval, channels: bound?.sample.channels.length, rate: bound?.sample.rate,
      first: bound?.sample.channels[0][0] })) };
  }, payload);
  expect(imported).toEqual({ imported: 6, count: 6, rejects: ['broken', 'missing', 'ambiguous', 'unknown'],
    clips: ['Night noises', 'Babbling brook', 'Heavy rain', 'Seagulls', 'Roll of thunder', 'Mooing cow'].map((name, index) =>
      ({ name, interval: index >= 4, channels: index % 2 + 1, rate: 20000, first: -1 })) });
  await page.reload();
  const restored = await page.evaluate(async data => {
    const path = '/src/background-assets.ts', format = '/src/import/bwg-format.ts';
    const { BackgroundAssets } = await import(path), { parseBwg } = await import(format);
    const assets = new BackgroundAssets(); await assets.ready;
    const clips = await Promise.all(data.map(bytes => assets.resolve(parseBwg(new Uint8Array(bytes)))));
    await assets.clear();
    return clips.map(clip => clip?.name);
  }, payload.presets);
  expect(restored).toEqual(imported.clips.map(clip => clip.name));
});
