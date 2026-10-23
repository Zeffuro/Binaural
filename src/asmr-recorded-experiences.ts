import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer> = {}): AsmrLayer =>
  ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const mix = (seed: number, layers: AsmrLayer[], phraseSeconds: number, mode: AsmrVariation['mode'] = 'natural'): AsmrSettings =>
  ({ level: .5, layers, variation: { ...defaultAsmrVariation(), mode, seed, amount: .7, phraseSeconds, turnSeconds: 90 } });

export const asmrRecordedExperiences: AsmrPreset[] = [
  { id: 'blanket-folds', name: 'Folding blankets', group: 'Everyday recordings', minutes: 30, light: 'gesture-brush',
    description: 'Recorded blanket folds stay in front of you, with varied phrases and quiet pauses. A 30-minute session.',
    make: () => mix(6101, [layer('recorded-blanket', { level: .6, rate: .85, tone: .6 })], 12) },
  { id: 'blanket-left', name: 'Blanket warmth on the left', group: 'Everyday recordings', minutes: 20, light: 'gesture-ear',
    description: 'Blanket movement stays entirely in the left ear, with slowly changing muffled warmth and quiet gaps.',
    make: () => mix(6211, [layer('recorded-blanket', { level: .6, pan: -1, rate: .85, tone: .5, pressure: .8, period: 36 })], 10) },
  { id: 'blanket-right', name: 'Blanket warmth on the right', group: 'Everyday recordings', minutes: 20, light: 'gesture-ear',
    description: 'Blanket movement stays entirely in the right ear, with slowly changing muffled warmth and quiet gaps.',
    make: () => mix(6311, [layer('recorded-blanket', { level: .6, pan: 1, rate: .9, tone: .5, pressure: .8, period: 40 })], 10) },
  { id: 'zipper-details', name: 'Little zipper details', group: 'Everyday recordings', minutes: 20, light: 'gesture-trace',
    description: 'Small recorded bag-zipper movements just to the right, softened and spaced with quiet pauses.',
    make: () => mix(6421, [layer('recorded-zipper', { level: .45, pan: .35, rate: .8, tone: .5 })], 8) },
  { id: 'pencil-studies', name: 'Pencil studies', group: 'Everyday recordings', minutes: 45, light: 'gesture-trace',
    description: 'Recorded pencil drawing stays close in front of you. Varied strokes and pauses fill a 45-minute session.',
    make: () => mix(6521, [layer('recorded-sketching', { level: .6, rate: .95, tone: .8 })], 14) },
  { id: 'sketchbook-turns', name: 'Sketchbook turns', group: 'Everyday recordings', minutes: 30, light: 'gesture-inspect',
    description: 'Recorded sketchbook pages turn near the center, with gentle pace changes and breathing room.',
    make: () => mix(6637, [layer('recorded-sketchbook', { level: .55, rate: .9, tone: .65 })], 12) },
  { id: 'paper-and-pencil-hour', name: 'An hour of paper and pencil', group: 'Everyday recordings', minutes: 60, light: 'gesture-trace',
    description: 'Sketchbook turns on the left alternate with pencil strokes on the right in 90-second turns. Quiet pauses separate phrases.',
    make: () => mix(6733, [layer('recorded-sketchbook', { level: .5, pan: -.35, tone: .6 }),
      layer('recorded-sketching', { level: .55, pan: .35, tone: .75 })], 12, 'turns') },
  { id: 'mist-at-the-temples', name: 'Mist at the temples', group: 'Everyday recordings', minutes: 30, light: 'gesture-follow',
    description: 'Recorded bottle mist moves slowly across the front in 3D headphones, with pauses between phrases.',
    make: () => mix(6841, [layer('recorded-mist', { level: .45, rate: .9, tone: .6, period: 48,
      spatial: { azimuth: 0, elevation: 15, distance: .65, motion: 'sweep' } })], 8) },
  { id: 'water-at-the-basin', name: 'Water at the basin', group: 'Everyday recordings', minutes: 30, light: 'gesture-drop',
    description: 'Recorded running water stays centered, with changing excerpts and quiet gaps. No other sounds are layered in.',
    make: () => mix(6949, [layer('recorded-running-water', { level: .45, tone: .55, rate: .95 })], 12) },
  { id: 'fresh-towels', name: 'Fresh towels', group: 'Everyday recordings', minutes: 45, light: 'gesture-brush',
    description: 'Blanket folds on the left take turns with bottle mist on the right, with soft ear warmth and quiet pauses.',
    make: () => mix(7057, [layer('recorded-blanket', { level: .5, pan: -.3, tone: .55, pressure: .3, period: 40 }),
      layer('recorded-mist', { level: .4, pan: .3, tone: .55, rate: .9 })], 10, 'turns') },
  { id: 'unpacking-a-sketchbook', name: 'Unpacking a sketchbook', group: 'Everyday recordings', minutes: 45, light: 'gesture-inspect',
    description: 'Bag-zipper details alternate with sketchbook pages, one material at a time, in a 45-minute session.',
    make: () => mix(7159, [layer('recorded-zipper', { level: .4, pan: -.3, tone: .45, rate: .9 }),
      layer('recorded-sketchbook', { level: .5, pan: .3, tone: .6 })], 10, 'turns') },
  { id: 'basin-and-cloth', name: 'Basin and cloth', group: 'Everyday recordings', minutes: 60, light: 'gesture-drop',
    description: 'Running water and blanket movement take quiet 90-second turns at opposite sides. A sparse one-hour session.',
    make: () => mix(7277, [layer('recorded-running-water', { level: .4, pan: -.3, tone: .55 }),
      layer('recorded-blanket', { level: .5, pan: .3, tone: .55, rate: .85 })], 12, 'turns') },
];
