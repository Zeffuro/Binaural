export type OutputDynamicsProfile = 'balanced' | 'open' | 'soft';

export const outputDynamicsProfiles: readonly {
  id: OutputDynamicsProfile; name: string; description: string; threshold: number;
}[] = [
  { id: 'balanced', name: 'Balanced', description: 'The original balance of detail and peak compression.', threshold: -10 },
  { id: 'open', name: 'More contrast', description: 'Less compression, with more difference between quiet and loud sounds.', threshold: -4 },
  { id: 'soft', name: 'Soft peaks', description: 'Earlier compression for less difference between quiet and loud sounds.', threshold: -18 },
];
