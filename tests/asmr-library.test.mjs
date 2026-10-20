import assert from 'node:assert/strict';
import test from 'node:test';
import { createAsmrLibrary, filterAsmrLibrary, parseAsmrFavorites, saveAsmrFavorites, ASMR_FAVORITES_KEY } from '../src/asmr-library.ts';

const sources = [
  { id: 'cloth', name: 'Cloth rustles', description: 'Recorded blankets and soft fabric' },
  { id: 'brush', name: 'Soft brush', description: 'Fine textured strokes' },
];
const presets = [
  { id: 'left', name: 'Left ear attention', description: 'Close warmth in one ear', group: 'Ear focus', make: () => ({ layers: [{ sound: 'brush' }] }) },
  { id: 'cloth', name: 'Soft cocoon', description: 'Wrap up quietly', group: 'Recorded textures', make: () => ({ layers: [{ sound: 'cloth' }, { sound: 'cloth' }] }) },
  { id: 'mix', name: 'Quiet duo', description: 'Warm layers', make: () => ({ layers: [{ sound: 'brush' }, { sound: 'cloth' }] }) },
];
const library = createAsmrLibrary(presets, sources);

test('library retains catalog order and deduplicates source names without changing recipes', () => {
  assert.deepEqual(library.map(entry => entry.id), ['left', 'cloth', 'mix']);
  assert.deepEqual(library[1].sounds, ['Cloth rustles']);
  assert.equal(library[2].group, 'Layered mixes');
  assert.equal(presets[1].make().layers.length, 2);
});

test('search combines case-insensitive terms across names, descriptions and source labels', () => {
  const find = (query, group = 'all', favorites = new Set()) => filterAsmrLibrary(library, query, group, favorites).map(entry => entry.id);
  assert.deepEqual(find('  LEFT  warmth  '), ['left']);
  assert.deepEqual(find('blankets'), ['cloth', 'mix']);
  assert.deepEqual(find('quiet brush'), ['mix']);
  assert.deepEqual(find('recorded', 'Recorded textures'), ['cloth']);
  assert.deepEqual(find('', 'Ear focus'), ['left']);
  assert.deepEqual(find('cloth', 'favorites', new Set(['left', 'mix'])), ['mix']);
  assert.deepEqual(find('', 'favorites'), []);
  assert.deepEqual(find('<script>'), []);
  assert.deepEqual(find('warmth blankets'), []);
});

test('favorites reject malformed and unknown stored data and deduplicate known ids', () => {
  for (const raw of [null, '', '{', '{}', 'true', 'null', '"left"']) assert.deepEqual([...parseAsmrFavorites(raw, library)], []);
  assert.deepEqual([...parseAsmrFavorites('["left","unknown",7,null,"left","cloth","<img onerror=alert(1)>"]', library)], ['left', 'cloth']);
});

test('favorites persist under their own key and storage failures preserve tab state', () => {
  const favorites = new Set(['left', 'cloth']);
  const values = new Map();
  assert.equal(saveAsmrFavorites({ setItem: (key, value) => values.set(key, value) }, favorites), true);
  assert.deepEqual(parseAsmrFavorites(values.get(ASMR_FAVORITES_KEY), library), favorites);
  assert.equal(saveAsmrFavorites({ setItem: () => { throw new Error('quota'); } }, favorites), false);
  assert.deepEqual([...favorites], ['left', 'cloth']);
});
