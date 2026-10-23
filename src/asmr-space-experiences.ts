import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer>): AsmrLayer => ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const room = (seed: number, layers: AsmrLayer[], space: NonNullable<AsmrSettings['space']>,
  mode: AsmrVariation['mode'] = 'natural', phraseSeconds = 20, turnSeconds = 150): AsmrSettings => ({ level: .45, layers, space,
  variation: { ...defaultAsmrVariation(), mode, seed, amount: .65, phraseSeconds, turnSeconds } });

export const asmrSpaceExperiences: AsmrPreset[] = [
  { id: 'reading-alcove', name: 'Reading alcove', group: 'Quiet rooms', minutes: 30, light: 'gesture-trace',
    description: 'Recorded page turns with varied phrases, quiet pauses and a little warm room color. Soft light traces accompany a 30-minute paired session.',
    make: () => room(6323, [layer('recorded-pages', { level: .55, tone: .6, rate: .9 })],
      { amount: .12, size: .7, warmth: .8 }, 'natural', 22) },
  { id: 'little-wooden-workshop', name: 'Little wooden workshop', group: 'Quiet rooms', minutes: 20, light: 'gesture-tap',
    description: 'Hollow wood and faint recorded metal taps take turns across a small imagined workbench. Warm room color and soft lights accompany a 20-minute session.',
    make: () => room(6469, [layer('wood', { level: .45, tone: .3, rate: .7, pan: -.3 }),
      layer('recorded-metal', { level: .2, tone: .3, rate: .75, pan: .35 })],
      { amount: .16, size: .85, warmth: .9 }, 'turns', 18, 120) },
  { id: 'linen-room', name: 'Linen room', group: 'Quiet rooms', minutes: 45, light: 'gesture-brush',
    description: 'Recorded cloth rustles sit beside slow fabric strokes, with quiet gaps and a soft room color. Gentle brush lights accompany a 45-minute paired session.',
    make: () => room(6607, [layer('recorded-cloth', { level: .4, tone: .5, rate: .85, pan: -.2 }),
      layer('fabric', { level: .25, tone: .35, rate: .7, pan: .25 })],
      { amount: .08, size: .6, warmth: .75 }, 'natural', 25) },
  { id: 'water-on-the-table', name: 'Water on the table', group: 'Quiet rooms', minutes: 30, light: 'gesture-drop',
    description: 'Rounded droplets alternate with small glass taps, with light room reflections and quiet pauses. Soft rings accompany a 30-minute paired session.',
    make: () => room(6761, [layer('water', { level: .4, tone: .35, rate: .7, pan: -.25 }),
      layer('glass', { level: .25, tone: .25, rate: .65, pan: .3 })],
      { amount: .2, size: 1.15, warmth: .35 }, 'turns', 20, 150) },
  { id: 'rain-stick-corner', name: 'Rain-stick corner', group: 'Quiet rooms', minutes: 60, light: 'gesture-follow',
    description: 'A slow rain stick rests beside recorded grass brushing, with changing phrases and spacious room color. A soft following light accompanies a one-hour session.',
    make: () => room(6907, [layer('rain-stick', { level: .4, tone: .4, rate: .75, pan: -.2 }),
      layer('recorded-grass', { level: .25, tone: .45, rate: .9, pan: .25 })],
      { amount: .24, size: 1.3, warmth: .6 }, 'natural', 24, 180) },
  { id: 'after-hours-writing', name: 'After-hours writing', group: 'Quiet rooms', minutes: 45, light: 'gesture-trace',
    description: 'Recorded pencil strokes and quiet keyboard clusters take turns, with warm room color and quiet gaps. Gentle light traces accompany a 45-minute paired session.',
    make: () => room(7043, [layer('recorded-writing', { level: .45, tone: .55, rate: .9, pan: -.3 }),
      layer('keyboard', { level: .25, tone: .3, rate: .75, pan: .35 })],
      { amount: .14, size: .95, warmth: .7 }, 'turns', 16, 180) },
];
