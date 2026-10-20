export const asmrSpatialMotions = ['still', 'orbit'] as const;
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
