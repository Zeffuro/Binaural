import { parseHrtfProfile, type HrtfProfile } from './hrtf-profiles.ts';
import { supportsQuietClicks, type recordedAsmrSounds } from './asmr-recordings.ts';

export const asmrSpatialMotions = ['still', 'orbit', 'sweep', 'approach', 'rise', 'figure-eight', 'rear-to-front', 'quiet-return'] as const;
export const asmrSpatialMotionLabels = {
  still: 'Stay in place', orbit: 'Orbit around your head', sweep: 'Side to side',
  approach: 'Near and far', rise: 'Up and down', 'figure-eight': 'Figure eight',
  'rear-to-front': 'Behind each ear to front',
  'quiet-return': 'Approach with quiet return',
} satisfies Record<typeof asmrSpatialMotions[number], string>;
export const asmrSpatialRanges = { azimuth: [-180, 180], elevation: [-60, 60], distance: [.15, 3] } as const;
export const quietReturnRanges = { closest: [.15, .55], approach: [.5, 20], gap: [.25, 20] } as const;
export const maxQuietClickGapSpread = 8;
export interface QuietClickSequenceSettings {
  recordings: (typeof recordedAsmrSounds[number]['id'])[];
  gapSpread: number;
  seed: number;
}
export interface QuietReturnSettings {
  closest: number;
  approach: number;
  gap: number;
  syncClicks?: true;
  sequence?: QuietClickSequenceSettings;
}

export function quietClickRecordings(sound: string, timing?: QuietReturnSettings): string[] {
  return timing?.syncClicks ? [sound, ...(timing.sequence?.recordings ?? [])] : [];
}

export interface AsmrSpatialSettings {
  azimuth: number;
  elevation: number;
  distance: number;
  motion: typeof asmrSpatialMotions[number];
  profile?: HrtfProfile;
  quietReturn?: QuietReturnSettings;
}

export const defaultSpatial = (): AsmrSpatialSettings => ({ azimuth: 0, elevation: 0, distance: .6, motion: 'still' });

export function defaultQuietReturn(period: number, distance: number): QuietReturnSettings {
  return { closest: Math.min(.55, Math.round(Math.max(.6, distance) * 25) / 100),
    approach: period / 4, gap: period / 4 };
}

function parseQuietReturn(value: unknown): QuietReturnSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid quiet return settings.');
  const input = value as Record<string, unknown>;
  for (const [field, [min, max]] of Object.entries(quietReturnRanges)) {
    const number = input[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
      throw new Error('Invalid quiet return settings.');
    }
  }
  if (input.syncClicks !== undefined && input.syncClicks !== true) throw new Error('Invalid quiet return click timing.');
  if (input.sequence !== undefined && !input.syncClicks) throw new Error('Click sequences require near-ear timing.');
  return { closest: input.closest as number, approach: input.approach as number, gap: input.gap as number,
    ...(input.syncClicks ? { syncClicks: true } : {}),
    ...(input.sequence === undefined ? {} : { sequence: parseQuietClickSequence(input.sequence) }) };
}

function parseQuietClickSequence(value: unknown): QuietClickSequenceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid near-ear click sequence.');
  const { recordings, gapSpread, seed } = value as Record<string, unknown>;
  if (!Array.isArray(recordings) || recordings.length > 3 || new Set(recordings).size !== recordings.length ||
      recordings.some(sound => typeof sound !== 'string' || !supportsQuietClicks(sound)) ||
      typeof gapSpread !== 'number' || !Number.isFinite(gapSpread) || gapSpread < 0 || gapSpread > maxQuietClickGapSpread ||
      typeof seed !== 'number' || !Number.isInteger(seed) || seed < 1 || seed > 2147483647) {
    throw new Error('Invalid near-ear click sequence.');
  }
  return { recordings: [...recordings], gapSpread, seed };
}

export function parseAsmrSpatial(value: unknown): AsmrSpatialSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ASMR spatial position.');
  const input = value as Record<string, unknown>;
  if (!asmrSpatialMotions.includes(input.motion as AsmrSpatialSettings['motion']) ||
    Object.entries(asmrSpatialRanges).some(([key, [min, max]]) => typeof input[key] !== 'number' ||
      !Number.isFinite(input[key]) || (input[key] as number) < min || (input[key] as number) > max)) {
    throw new Error('Invalid ASMR spatial position.');
  }
  if (input.quietReturn !== undefined && input.motion !== 'quiet-return') throw new Error('Quiet return controls require quiet return motion.');
  return { azimuth: input.azimuth as number, elevation: input.elevation as number,
    distance: input.distance as number, motion: input.motion as AsmrSpatialSettings['motion'],
    ...(input.profile === undefined ? {} : { profile: parseHrtfProfile(input.profile) }),
    ...(input.quietReturn === undefined ? {} : { quietReturn: parseQuietReturn(input.quietReturn) }) };
}

export function spatialPosition(settings: AsmrSpatialSettings): { x: number; y: number; z: number } {
  const azimuth = settings.azimuth * Math.PI / 180, elevation = settings.elevation * Math.PI / 180;
  const radius = settings.distance * Math.cos(elevation);
  return { x: radius * Math.sin(azimuth), y: settings.distance * Math.sin(elevation), z: -radius * Math.cos(azimuth) };
}

type Position = ReturnType<typeof spatialPosition>;
export interface SpatialTrajectory { center: Position; sine: Position; cosine: Position; harmonic: Position }

export function spatialTrajectory(settings: AsmrSpatialSettings): SpatialTrajectory {
  const position = spatialPosition(settings), zero = () => ({ x: 0, y: 0, z: 0 });
  const path = { center: position, sine: zero(), cosine: zero(), harmonic: zero() };
  if (settings.motion === 'still') return path;
  if (settings.motion === 'orbit') return { ...path, center: { x: 0, y: position.y, z: 0 },
    sine: { x: -position.z, y: 0, z: position.x }, cosine: { x: position.x, y: 0, z: position.z } };
  const radius = settings.distance, azimuth = settings.azimuth * Math.PI / 180, elevation = settings.elevation * Math.PI / 180;
  const scale = (vector: Position, factor: number): Position => ({ x: vector.x * factor, y: vector.y * factor, z: vector.z * factor });
  if (settings.motion === 'rear-to-front' || settings.motion === 'quiet-return') {
    // The path crosses the sides twice per cycle while staying outside the near-ear limit.
    const quiet = settings.motion === 'quiet-return';
    const reach = Math.max(quiet ? .60 : .45, radius), horizontal = reach * Math.cos(elevation);
    const lateral = { x: Math.cos(azimuth), y: 0, z: Math.sin(azimuth) };
    const rear = { x: -Math.sin(azimuth), y: 0, z: Math.cos(azimuth) };
    const swing = scale(lateral, -(quiet ? .72 : .6) * Math.SQRT1_2 * horizontal);
    return { center: { ...scale(rear, (quiet ? .20 : .15) * horizontal), y: reach * Math.sin(elevation) },
      sine: swing, cosine: swing, harmonic: scale(rear, (quiet ? .45 : .65) * horizontal) };
  }
  if (settings.motion === 'approach') {
    const depth = radius - Math.max(.15, radius * .35);
    return { ...path, center: scale(position, 1 - depth / (2 * radius)), cosine: scale(position, depth / (2 * radius)) };
  }
  const horizontal = { x: Math.cos(azimuth), y: 0, z: Math.sin(azimuth) };
  const vertical = { x: -Math.sin(azimuth) * Math.sin(elevation), y: Math.cos(elevation), z: Math.cos(azimuth) * Math.sin(elevation) };
  const extent = settings.motion === 'figure-eight' ? 1.25 : 1;
  // Orthogonal motion stays between the near limit and the selected maximum distance.
  const amplitude = Math.min(.6 * radius, Math.sqrt(Math.max(0, radius * radius - .15 ** 2) / extent));
  path.center = scale(position, Math.sqrt(Math.max(.15 ** 2, radius * radius - extent * amplitude ** 2)) / radius);
  path.sine = scale(settings.motion === 'rise' ? vertical : horizontal, amplitude);
  if (settings.motion === 'figure-eight') path.harmonic = scale(vertical, amplitude * .5);
  return path;
}

export function sampleSpatialPosition(settings: AsmrSpatialSettings, seconds: number, period: number): Position {
  if (!Number.isFinite(seconds) || !Number.isFinite(period) || period < 2 || period > 60) throw new Error('Invalid ASMR spatial motion time.');
  const path = spatialTrajectory(settings), phase = ((Math.fround(1 / period) * seconds) % 1 + 1) % 1 * 2 * Math.PI;
  const coordinate = (axis: keyof Position) => path.center[axis] + path.sine[axis] * Math.sin(phase) +
    path.cosine[axis] * Math.cos(phase) + path.harmonic[axis] * Math.sin(2 * phase);
  return { x: coordinate('x'), y: coordinate('y'), z: coordinate('z') };
}
