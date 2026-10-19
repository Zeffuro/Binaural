import type { Layer, Session } from '../model';
import { parseBwg } from './bwg-format';
import { bwgDuration, encodeBwg } from './bwg-program';
import { evaluateCurve, validateCurves } from '../audio/bwg-curves';
import { backgroundReference } from './bwg-background';

export interface BwgImportResult {
  session: Session;
  warnings: string[];
  summary: string;
}

export function importBwg(input: ArrayBuffer | Uint8Array): BwgImportResult {
  const preset = parseBwg(input);
  validateCurves(preset);
  const duration = bwgDuration(preset);
  const voices = Math.max(...preset.segments.map(segment => segment.voices));
  const segment = preset.segments[0];
  const layers = Array.from({ length: voices }, (_, index): Layer => {
    const offset = 36 + index * 14;
    const active = index < segment.voices;
    const pitch = active ? evaluateCurve(segment, offset + 1, 0) / 100 : 200;
    const beat = active ? evaluateCurve(segment, offset, 0) / 1000 : 0;
    const separate = active && segment.curves[offset + 1].channelMode !== 0;
    return { id: crypto.randomUUID(), name: `BWGen voice ${index + 1}`,
      left: Math.max(0, pitch + (separate ? 0 : beat / 2)),
      right: Math.max(0, separate ? evaluateCurve(segment, offset + 2, 0) / 100 : pitch - beat / 2),
      level: 1, route: 'binaural' };
  });
  const warnings = [
    'The full sound sequence is retained, including repeats, nonlinear sweeps and modulation.',
    'Visual flashing and AudioStrobe are preserved in exports but never activate lights.',
    'Browser playback may differ from BWGen in sample precision and loudness.',
  ];
  const background = backgroundReference(preset);
  if (background) warnings.push(background.approximation
    ? `Background: ${background.name}. A built-in sound plays when no recording is loaded. Change it under “BWGen background sounds”.`
    : `Recorded background: ${background.name} (${background.file}). Link a WAV under “BWGen background sounds”; no built-in sound matches this reference.`);
  const name = preset.name.slice(0, 80);
  const session: Session = { version: 1, name, layers, ambient: 'none', ambientLevel: 0,
    musicLevel: 0, master: 0.2, minutes: duration / 60, timelineDuration: duration,
    bwg: encodeBwg(input), source: { format: 'bwg', name, description: preset.description } };
  return { session, warnings,
    summary: `${preset.segments.length} segment(s), ${voices} voice(s), ${(duration / 60).toFixed(2)} minutes. BWGen ${preset.creatorVersion}.` };
}
