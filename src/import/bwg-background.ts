import type { BwgPreset } from './bwg-format';
import type { GeneratedBackgroundId } from '../audio/generated-backgrounds';

export const backgroundSources = ['auto', 'generated', 'recording'] as const;
export type BackgroundSource = typeof backgroundSources[number];
export interface BackgroundReference {
  key: string; name: string; file: string; id: number; interval: boolean; approximation?: GeneratedBackgroundId;
}
const PACKS: Record<string, [string, boolean, GeneratedBackgroundId][]> = {
  'bkgnd.dll': [['Night noises', false, 'night'], ['Babbling brook', false, 'brook'], ['Heavy rain', false, 'rain'],
    ['Seagulls', false, 'seagulls'], ['Roll of thunder', true, 'thunder'], ['Mooing cow', true, 'cow']],
  'bgextra.dll': [['Wind', false, 'wind'], ['Gushing river', false, 'river'], ['Traffic', false, 'traffic'], ['Pigeons', false, 'pigeons'],
    ['Birds', false, 'birds'], ['Tropical birds', false, 'tropical-birds'], ['Galloping horse', false, 'horse'], ['Chopping wood', true, 'wood'],
    ['Explosions', true, 'explosions'], ['Baaing sheep', true, 'sheep'], ['Howling dog', true, 'dog']],
};
export const backgroundFile = (path: string): string => path.split(/[\\/]/).at(-1)!.toLowerCase();
export const backgroundKey = (file: string, id: number): string => `${backgroundFile(file)}:${id}`;

export function backgroundReference(preset: BwgPreset): BackgroundReference | undefined {
  const at = 1316 - 398;
  const id = (preset.settings[at] | preset.settings[at + 1] << 8 | preset.settings[at + 2] << 16 | preset.settings[at + 3] << 24) >>> 0;
  if (id === 0x400 || !preset.background) return undefined;
  const file = backgroundFile(preset.background);
  const entry = PACKS[file]?.[id - 1];
  return { key: backgroundKey(file, id), file, id, name: entry?.[0] ?? `${file}, sound ${id}`,
    interval: entry?.[1] ?? id >= 0x401, ...(entry ? { approximation: entry[2] } : {}) };
}

export function packEntries(file: string): { key: string; name: string; id: number; interval: boolean }[] {
  const pack = PACKS[backgroundFile(file)];
  if (!pack) throw new Error('This sound pack is not recognized. You can bind a WAV recording instead.');
  return pack.map(([name, interval], index) => ({ key: backgroundKey(file, index + 1), id: index + 1, name, interval }));
}
