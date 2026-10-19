export const listeningModes = ['binaural', 'asmr', 'mixed'] as const;
export type ListeningMode = typeof listeningModes[number];
export interface ModeSource { mode?: ListeningMode; asmr?: { layers: unknown[] } }
export const listeningMode = (source: ModeSource): ListeningMode => source.mode ?? (source.asmr?.layers.length ? 'mixed' : 'binaural');
export const modeGains = (mode: ListeningMode) => ({ tones: mode === 'asmr' ? 0 : 1, asmr: mode === 'binaural' ? 0 : 1 });
