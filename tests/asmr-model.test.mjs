import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { listeningMode, modeGains } from '../src/listening-mode.ts';
import { makeAsmrLayer, parseAsmr, recordedAsmrSounds, generatedAsmrSounds } from '../src/asmr-state.ts';
import { cuppingParameters, cuppingWave } from '../src/audio/ear-cupping.ts';
import { createAsmrAssetStore, finishRecordedBuffer } from '../src/audio/asmr-asset-store.ts';

test('modes isolate the appropriate bus and preserve legacy sessions and mix values', () => {
  assert.equal(listeningMode({}), 'binaural');
  assert.equal(listeningMode({ asmr: { layers: [] } }), 'binaural');
  assert.equal(listeningMode({ asmr: { layers: [{}] } }), 'mixed');
  const session = { mode: 'asmr', asmr: { layers: [{ level: .7 }] }, tones: [{ level: .9 }], ambientLevel: .3 };
  const copy = structuredClone(session);
  assert.deepEqual(modeGains(listeningMode(session)), { tones: 0, asmr: 1 });
  assert.deepEqual(modeGains('binaural'), { tones: 1, asmr: 0 });
  assert.deepEqual(modeGains('mixed'), { tones: 1, asmr: 1 });
  assert.deepEqual(session, copy);
});

test('legacy ASMR layers migrate to zero cupping while new parameters stay bounded', () => {
  const layer = makeAsmrLayer('brush'); delete layer.pressure; delete layer.pressurePhase;
  const value = parseAsmr({ level: .6, layers: [layer] }).layers[0];
  assert.equal(value.pressure, 0); assert.equal(value.pressurePhase, 0);
  for (const [field, invalid] of [['pressure', -1], ['pressure', 1.01], ['pressurePhase', Infinity], ['pressurePhase', 361], ['pressurePhase', '180']]) {
    assert.throws(() => parseAsmr({ level: .6, layers: [{ ...value, [field]: invalid }] }));
  }
  assert.equal(parseAsmr({ level: 1, layers: [{ ...value, pressure: 1, pressurePhase: 360 }] }).layers[0].pressure, 1);
  assert.equal(generatedAsmrSounds.length, 15); assert.equal(recordedAsmrSounds.length, 5);
});

test('cupping never creates negative gain or cutoff, boosts volume, or adds oscillator DC', () => {
  for (const level of [0, .2, 1]) for (const tone of [0, .3, 1]) for (const amount of [0, .5, 1]) {
    const values = cuppingParameters(level, tone, amount);
    assert.ok(values.gain - values.gainDepth >= 0);
    assert.ok(values.gain + values.gainDepth <= level * .16 + 1e-12);
    assert.ok(values.frequency - values.frequencyDepth >= 89);
    for (const phase of [0, 90, 180, 270, 360]) {
      const wave = cuppingWave(phase);
      assert.equal(wave.real[0], 0); assert.equal(wave.imaginary[0], 0);
      assert.ok(Math.abs(Math.hypot(wave.real[1], wave.imaginary[1]) - 1) < 1e-6);
    }
  }
  const first = cuppingWave(0), opposite = cuppingWave(180);
  assert.ok(Math.abs(first.imaginary[1] + opposite.imaginary[1]) < 1e-6);
});

test('recording requests deduplicate, preserve buffer identity and retry failed loads', async () => {
  const calls = [], buffer = { name: 'decoded' }; let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const store = createAsmrAssetStore(async id => { calls.push(id); await waiting; return buffer; });
  const first = store.prepare(['hands', 'hands']), second = store.prepare(['hands']);
  assert.equal(store.has('hands'), false); release(); await Promise.all([first, second]);
  assert.deepEqual(calls, ['hands']); assert.equal(store.get('hands'), buffer);
  await store.prepare(['hands']); assert.deepEqual(calls, ['hands']);
  let attempts = 0;
  const retries = createAsmrAssetStore(async () => { if (++attempts === 1) throw new Error('offline'); return buffer; });
  await assert.rejects(retries.prepare(['cloth'])); assert.equal(retries.has('cloth'), false);
  await retries.prepare(['cloth']); assert.equal(attempts, 2); assert.equal(retries.get('cloth'), buffer);
});

function fakeBuffer(channels, rate = 1000) {
  return { numberOfChannels: channels.length, length: channels[0].length, duration: channels[0].length / rate, sampleRate: rate, getChannelData: index => channels[index] };
}

test('recording preparation preserves stereo differences while bounding combined peak and loop seams', () => {
  const left = new Float32Array(1000).fill(.9), right = new Float32Array(1000).fill(-.6);
  const buffer = fakeBuffer([left, right]); assert.equal(finishRecordedBuffer(buffer), buffer);
  for (let i = 0; i < left.length; i++) assert.ok(Math.abs(left[i]) + Math.abs(right[i]) <= .700001);
  assert.ok(left[500] > 0 && right[500] < 0); assert.ok(Math.abs(left[500] / right[500] + 1.5) < 1e-6);
  assert.equal(Math.abs(left[0]), 0); assert.equal(Math.abs(right.at(-1)), 0);
});

test('recording preparation rejects malformed or excessive decoded audio', () => {
  assert.throws(() => finishRecordedBuffer(fakeBuffer([new Float32Array(100), new Float32Array(100), new Float32Array(100)])));
  assert.throws(() => finishRecordedBuffer(fakeBuffer([new Float32Array(10)])));
  assert.throws(() => finishRecordedBuffer(fakeBuffer([new Float32Array(61000)])));
  const invalid = new Float32Array(1000); invalid[10] = NaN;
  assert.throws(() => finishRecordedBuffer(fakeBuffer([invalid])));
});

test('all five bundled recordings match verified CC0 provenance and the size budget', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/audio/asmr/credits.json', import.meta.url), 'utf8'));
  assert.equal(manifest.clips.length, 5); let bytes = 0;
  for (const sound of recordedAsmrSounds) {
    const clip = manifest.clips.find(clip => clip.file === sound.file); assert.ok(clip);
    assert.equal(clip.license, 'CC0-1.0'); assert.match(clip.sourceUrl, /^https:\/\/freesound.org\/people\//);
    const data = await readFile(new URL(`../public/audio/asmr/${sound.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256); assert.equal(data.length, clip.bytes); bytes += data.length;
    assert.equal(data.toString('ascii', 0, 4), 'OggS');
  }
  assert.ok(bytes < 1024 * 1024);
});
