import type { Preset } from './catalog';
import { initialSession, makeLayer, type Ambient } from './model';
import { defaultVisualSettings } from './visual-state';

function experience(id: string, name: string, description: string, scene: string, visualLabel: string,
  ambient: Ambient, left: number, difference: number, minutes: number, muted = false): Preset {
  return { id, name, category: 'SOUNDSCAPES', description, visualLabel, tags: ['visual', 'soundscape', visualLabel.toLowerCase()], aliases: [], sources: [],
    evidence: 'Original sound and scene pairing. The name describes a listening atmosphere, without a promised effect.',
    session: { ...initialSession(), version: 2, name, ambient, minutes, tonesMuted: muted,
      layers: [makeLayer(left, left + difference, `${left} Hz: ${difference} Hz difference`)],
      visual: { ...defaultVisualSettings(), scene } } };
}

export const experienceRecipes: Preset[] = [
  experience('forest-clearing', 'Forest clearing', 'A 6 Hz pair and a soft wind bed beneath a forest panorama.',
    'nature:forest-slope', 'Forest slope panorama', 'wind', 180, 6, 20),
  experience('first-light', 'First light', 'A gentle 10 Hz pair, pink noise and a mountain at dawn.',
    'nature:mountain-dawn', 'Mountain dawn panorama', 'pink', 200, 10, 20),
  experience('meadow-air', 'Meadow air', 'Just synthetic wind and an autumn landscape. Tone layers start muted.',
    'nature:autumn-meadow', 'Autumn meadow panorama', 'wind', 160, 6, 15, true),
  experience('blue-current', 'Blue current', 'A 5 Hz pair over slow synthetic ocean, with quiet water patterns.',
    'water', 'Quiet water', 'ocean', 160, 5, 25),
  experience('northern-quiet', 'Northern quiet', 'A low 2 Hz pair with brown noise and slow aurora ribbons.',
    'aurora', 'Aurora', 'brown', 120, 2, 30),
  experience('music-room', 'Music room', 'An oscilloscope for your own soundtrack. Tones and background start silent; choose a local music file.',
    'scope', 'Oscilloscope', 'none', 200, 10, 20, true),
];
