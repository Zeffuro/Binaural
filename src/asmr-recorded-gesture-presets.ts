import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer> = {}): AsmrLayer =>
  ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const mix = (seed: number, layers: AsmrLayer[], phraseSeconds: number, mode: AsmrVariation['mode'] = 'natural'): AsmrSettings =>
  ({ level: .5, layers, variation: { ...defaultAsmrVariation(), mode, seed, amount: .7, phraseSeconds, turnSeconds: 90 } });

export const asmrRecordedGesturePresets: AsmrPreset[] = [
  { id: 'hands-in-soft-light', name: 'Hands in soft light', group: 'Recorded gestures', minutes: 20, light: 'gesture-follow',
    description: 'Recorded hand rubbing moves slowly between your ears. A soft point follows the sound, with quiet pauses between phrases.',
    make: () => mix(7411, [layer('recorded-hands', { level: .55, motion: 'sweep', width: .75, period: 42, rate: .8, tone: .55 })], 12) },
  { id: 'hairbrush-at-each-ear', name: 'Hairbrush at each ear', group: 'Recorded gestures', minutes: 30, light: 'gesture-ear',
    description: 'Slow recorded hair brushing on the left alternates with a slightly quicker brush on the right in 90-second turns. Soft edge lights follow each side.',
    make: () => mix(7523, [layer('recorded-hair', { level: .5, pan: -.8, rate: .75, tone: .55 }),
      layer('recorded-hair', { level: .45, pan: .8, rate: .95, tone: .6 })], 14, 'turns') },
  { id: 'zipper-and-page-study', name: 'Zipper and page study', group: 'Recorded gestures', minutes: 30, light: 'gesture-inspect',
    description: 'Recorded zipper movements on the left take turns with sketchbook pages on the right. A small translucent shape accompanies the details and pauses.',
    make: () => mix(7639, [layer('recorded-zipper', { level: .4, pan: -.65, rate: .7, tone: .5 }),
      layer('recorded-sketchbook', { level: .5, pan: .65, rate: .9, tone: .6 })], 10, 'turns') },
  { id: 'pencil-lines-after-dark', name: 'Pencil lines after dark', group: 'Recorded gestures', minutes: 60, light: 'gesture-trace',
    description: 'Recorded pencil sketching stays in front of you, with unhurried strokes, quiet gaps and a fine light trace. A sparse one-hour session.',
    make: () => mix(7753, [layer('recorded-sketching', { level: .55, rate: .8, tone: .7 })], 16) },
  { id: 'mist-across-the-light', name: 'Mist across the light', group: 'Recorded gestures', minutes: 20, light: 'gesture-drop',
    description: 'Recorded bottle mist sweeps slowly across the front in 3D headphones. Small rings accompany the spray phrases, with quiet gaps.',
    make: () => mix(7867, [layer('recorded-mist', { level: .4, rate: .75, tone: .55, period: 56,
      spatial: { azimuth: 0, elevation: 10, distance: .8, motion: 'sweep' } })], 8) },
  { id: 'metal-points-in-the-dark', name: 'Metal points in the dark', group: 'Recorded gestures', minutes: 45, light: 'gesture-tap',
    description: 'Recorded radiator taps drift from side to side at a slow pace. Small points of light accompany the contacts, with varied phrases and pauses.',
    make: () => mix(7981, [layer('recorded-metal', { level: .35, motion: 'sweep', width: .65, period: 50, rate: .85, tone: .35 })], 10) },
];
