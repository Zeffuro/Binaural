export const hrtfProfiles = [
  { id: 'sadie-d1', name: 'SADIE dummy head' },
  { id: 'sadie-h10', name: 'SADIE listener 10' },
] as const;

export type HrtfProfile = typeof hrtfProfiles[number]['id'];

export function parseHrtfProfile(value: unknown): HrtfProfile {
  if (!hrtfProfiles.some(profile => profile.id === value)) throw new Error('Invalid ASMR HRTF profile.');
  return value as HrtfProfile;
}
