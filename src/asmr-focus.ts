import type { AsmrSettings } from './asmr-state.ts';
import { listeningMode, modeGains, type ListeningMode } from './listening-mode.ts';

export const ASMR_FOCUS_GAIN = 10 ** (-10 / 20);

export function asmrBackgroundGain(session: { master: number; mode?: ListeningMode; asmr?: AsmrSettings }, ready = true): number {
  const settings = session.asmr;
  if (!settings?.focus || !ready || session.master <= 0 || settings.level <= 0 || !modeGains(listeningMode(session)).asmr) return 1;
  const solo = settings.layers.some(layer => layer.solo && !layer.muted);
  return settings.layers.some(layer => layer.level > 0 && !layer.muted && (!solo || layer.solo)) ? ASMR_FOCUS_GAIN : 1;
}
