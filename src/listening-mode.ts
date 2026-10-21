export const listeningModes = ['binaural', 'asmr', 'mixed', 'ambient'] as const;
export type ListeningMode = typeof listeningModes[number];
export interface ModeSource { mode?: ListeningMode; asmr?: { layers: unknown[] } }
export const listeningMode = (source: ModeSource): ListeningMode => source.mode ?? (source.asmr?.layers.length ? 'mixed' : 'binaural');
export const modeGains = (mode: ListeningMode) => ({ tones: mode === 'binaural' || mode === 'mixed' ? 1 : 0, asmr: mode === 'asmr' || mode === 'mixed' ? 1 : 0 });
export const modeForSources = (tones: boolean, asmr: boolean): ListeningMode => tones ? asmr ? 'mixed' : 'binaural' : asmr ? 'asmr' : 'ambient';
