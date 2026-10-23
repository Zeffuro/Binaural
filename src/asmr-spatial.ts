export const asmrSpatialMotions = ['still', 'orbit', 'sweep', 'approach', 'rise', 'figure-eight'] as const;
export const asmrSpatialMotionLabels = {
  still: 'Stay in place', orbit: 'Orbit around your head', sweep: 'Side to side',
  approach: 'Near and far', rise: 'Up and down', 'figure-eight': 'Figure eight',
} satisfies Record<typeof asmrSpatialMotions[number], string>;
export const asmrSpatialRanges = { azimuth: [-180, 180], elevation: [-60, 60], distance: [.15, 3] } as const;

export interface AsmrSpatialSettings {
  azimuth: number;
  elevation: number;
  distance: number;
  motion: typeof asmrSpatialMotions[number];
}

export const defaultSpatial = (): AsmrSpatialSettings => ({ azimuth: 0, elevation: 0, distance: .6, motion: 'still' });

export function parseAsmrSpatial(value: unknown): AsmrSpatialSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ASMR spatial position.');
  const input = value as Record<string, unknown>;
  if (!asmrSpatialMotions.includes(input.motion as AsmrSpatialSettings['motion']) ||
    Object.entries(asmrSpatialRanges).some(([key, [min, max]]) => typeof input[key] !== 'number' ||
      !Number.isFinite(input[key]) || (input[key] as number) < min || (input[key] as number) > max)) {
    throw new Error('Invalid ASMR spatial position.');
  }
  return { azimuth: input.azimuth as number, elevation: input.elevation as number,
    distance: input.distance as number, motion: input.motion as AsmrSpatialSettings['motion'] };
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
