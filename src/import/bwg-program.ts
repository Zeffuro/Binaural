import { MAX_BWG_BYTES, parseBwg, type BwgPreset } from './bwg-format';

export interface BwgProgram { version: 1; data: string }

export function encodeBwg(input: ArrayBuffer | Uint8Array): BwgProgram {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { version: 1, data: btoa(text) };
}

export function decodeBwg(value: unknown): { program: BwgProgram; preset: BwgPreset } {
  const input = value as Partial<BwgProgram> | null;
  if (!input || input.version !== 1 || typeof input.data !== 'string' ||
      input.data.length > Math.ceil(MAX_BWG_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) {
    throw new Error('Invalid embedded BWGen program.');
  }
  let text: string;
  try { text = atob(input.data); } catch { throw new Error('Invalid embedded BWGen encoding.'); }
  const bytes = Uint8Array.from(text, character => character.charCodeAt(0));
  return { program: { version: 1, data: input.data }, preset: parseBwg(bytes) };
}

export const bwgDuration = (preset: BwgPreset): number =>
  preset.segments.reduce((sum, segment) => sum + segment.seconds * segment.repeats, 0);

export const bwgContinues = (preset: BwgPreset): boolean => preset.settings[1760 - 398] !== 0;
