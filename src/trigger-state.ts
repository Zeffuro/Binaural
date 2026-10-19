export const triggerStyles = ['kaleidoscope', 'scan', 'torch'] as const;
export const triggerMotifs = ['beads', 'prism', 'petals', 'stars'] as const;
export const triggerPaths = ['orbit', 'horizontal', 'vertical', 'figure-eight', 'manual'] as const;
export const triggerPresetIds = ['prism-lantern', 'rose-glass', 'blue-hour', 'amber-facets', 'mint-prism', 'violet-jewels', 'rose-window', 'crystal-stars', 'red-scan', 'red-orbit', 'blue-scan', 'amber-scan', 'soft-torch', 'wandering-light', 'quiet-focus', 'bright-prism', 'very-bright-prism', 'bright-torch', 'very-bright-torch', 'custom'] as const;
export interface TriggerSettings {
  preset: string;
  style: typeof triggerStyles[number]; motif: typeof triggerMotifs[number]; layout: 'tiled' | 'radial';
  path: typeof triggerPaths[number]; color: string; accent: string; lampColor: string;
  symmetry: number; density: number; zoom: number; speed: number; rotation: number; drift: number;
  depth: number; softness: number; glow: number; brightness: number; light: number; lightSpeed: number;
  size: number; trail: number; reaction: number; offsetX: number; offsetY: number; seed: number;
}

export const triggerRanges = {
  symmetry: [3, 16, 1], density: [4, 24, 1], zoom: [.5, 3, .05], speed: [0, 1, .01], rotation: [0, 360, 1], drift: [0, 1, .01],
  depth: [0, 1, .01], softness: [0, 1, .01], glow: [0, 1, .01], brightness: [0, 4, .01], light: [0, 3, .01], lightSpeed: [0, 1, .01],
  size: [.08, 1, .01], trail: [0, 1, .01], reaction: [0, 1, .01], offsetX: [-1, 1, .01], offsetY: [-1, 1, .01], seed: [1, 9999, 1],
} as const;

export const defaultTriggerSettings = (): TriggerSettings => ({ preset: 'prism-lantern', style: 'kaleidoscope', motif: 'beads', layout: 'tiled', path: 'orbit',
  color: '#ee73af', accent: '#45bfc7', lampColor: '#c4edff', symmetry: 6, density: 14, zoom: 1.1, speed: .03, rotation: 0, drift: .12, depth: .45,
  softness: .2, glow: .35, brightness: .55, light: .8, lightSpeed: .32, size: .32, trail: .2, reaction: 0, offsetX: 0, offsetY: 0, seed: 47 });

export function parseTriggerSettings(value: unknown): TriggerSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid light trigger settings.');
  const state = value as Record<string, unknown>, parsed = defaultTriggerSettings();
  const choice = <T extends string>(key: string, choices: readonly T[]): T => {
    if (typeof state[key] !== 'string' || !choices.includes(state[key] as T)) throw new Error('Unknown light trigger option.');
    return state[key] as T;
  };
  parsed.style = choice('style', triggerStyles); parsed.motif = choice('motif', triggerMotifs);
  parsed.layout = choice('layout', ['tiled', 'radial']); parsed.path = choice('path', triggerPaths);
  parsed.preset = choice('preset', triggerPresetIds);
  for (const key of ['color', 'accent', 'lampColor'] as const) {
    if (typeof state[key] !== 'string' || !/^#[\da-f]{6}$/i.test(state[key])) throw new Error('Use a six-digit light color.');
    parsed[key] = state[key].toLowerCase();
  }
  for (const [key, [min, max, step]] of Object.entries(triggerRanges)) {
    const number = state[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (step === 1 && !Number.isInteger(number))) throw new Error('Light trigger value is outside its supported range.');
    (parsed as unknown as Record<string, unknown>)[key] = number;
  }
  return parsed;
}
