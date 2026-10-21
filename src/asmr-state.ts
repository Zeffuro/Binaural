import { extraAsmrTextures } from './asmr-textures.ts';
import { parseAsmrSpatial, type AsmrSpatialSettings } from './asmr-spatial.ts';
import { recordedAsmrSounds } from './asmr-recordings.ts';
import { parseAsmrVariation, type AsmrVariation } from './asmr-variation.ts';
export { recordedAsmrSounds } from './asmr-recordings.ts';

export const generatedAsmrSounds = [
  { id: 'brush', name: 'Soft brush', description: 'Soft textured strokes' },
  { id: 'wood', name: 'Wood tapping', description: 'Warm, hollow taps' },
  { id: 'glass', name: 'Glass tapping', description: 'Small bright clinks' },
  { id: 'paper', name: 'Paper crinkles', description: 'Dry, delicate folds' },
  { id: 'scratch', name: 'Gentle scratching', description: 'Fine textured scrapes' },
  { id: 'air', name: 'Air waves', description: 'A soft, filtered rush' },
  { id: 'water', name: 'Water drops', description: 'Rounded little droplets' },
  { id: 'chimes', name: 'Soft chimes', description: 'Slow, muted bell tones' },
  { id: 'cupping', name: 'Warm ear cupping', description: 'Warm filtered texture for close, muffled ear effects' },
  ...extraAsmrTextures,
] as const;
export const asmrSounds = [...generatedAsmrSounds, ...recordedAsmrSounds];
export type AsmrSound = typeof asmrSounds[number]['id'];
export const asmrMotions = ['still', 'sweep', 'wander'] as const;
export interface AsmrLayer {
  id: string;
  sound: AsmrSound;
  level: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  motion: typeof asmrMotions[number];
  width: number;
  period: number;
  rate: number;
  tone: number;
  pressure: number;
  pressurePhase: number;
  spatial?: AsmrSpatialSettings;
}
export interface AsmrSettings { level: number; layers: AsmrLayer[]; focus?: boolean; variation?: AsmrVariation }
export const MAX_ASMR_LAYERS = 6;
export const defaultAsmr = (): AsmrSettings => ({ level: .6, layers: [], focus: false });
export const makeAsmrLayer = (sound: AsmrSound = 'brush'): AsmrLayer => ({
  id: crypto.randomUUID(), sound, level: .6, muted: false, solo: false,
  pan: 0, motion: 'sweep', width: .85, period: 12, rate: 1, tone: .45, pressure: 0, pressurePhase: 0,
});
export const asmrRanges = { level: [0, 1], pan: [-1, 1], width: [0, 1], period: [2, 60], rate: [.5, 2], tone: [0, 1], pressure: [0, 1], pressurePhase: [0, 360] } as const;
export function parseAsmr(value: unknown): AsmrSettings {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const bounded = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!record(value) || !bounded(value.level, 0, 1) || !Array.isArray(value.layers) || value.layers.length > MAX_ASMR_LAYERS) throw new Error('Invalid ASMR mixer. Use up to six sound layers.');
  if (value.focus !== undefined && typeof value.focus !== 'boolean') throw new Error('Invalid ASMR focus setting.');
  const layers = value.layers.map(input => {
    if (record(input)) input = { pressure: 0, pressurePhase: 0, ...input };
    if (!record(input) || !asmrSounds.some(sound => sound.id === input.sound) ||
      !asmrMotions.includes(input.motion as AsmrLayer['motion']) || typeof input.muted !== 'boolean' || typeof input.solo !== 'boolean' ||
      Object.entries(asmrRanges).some(([field, [min, max]]) => !bounded(input[field], min, max))) throw new Error('Invalid ASMR sound layer.');
    const layer = makeAsmrLayer(input.sound as AsmrSound);
    for (const field of Object.keys(asmrRanges) as (keyof typeof asmrRanges)[]) layer[field] = input[field] as number;
    return { ...layer, motion: input.motion as AsmrLayer['motion'], muted: input.muted, solo: input.solo,
      ...(input.spatial === undefined ? {} : { spatial: parseAsmrSpatial(input.spatial) }) };
  });
  return { level: value.level, layers, focus: value.focus ?? false,
    ...(value.variation === undefined ? {} : { variation: parseAsmrVariation(value.variation) }) };
}
