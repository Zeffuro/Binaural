import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation } from './asmr-variation';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer> = {}): AsmrLayer => ({ ...makeAsmrLayer(sound), ...values });
const mix = (seed: number, layers: AsmrLayer[], steady = false): AsmrSettings => ({ level: .55, layers,
  variation: { ...defaultAsmrVariation(), mode: steady ? 'steady' : 'natural', seed, phraseSeconds: 8 } });

export const asmrGesturePresets = [
  { id: 'follow-my-light', name: 'Follow my light', group: 'Sound and gesture', minutes: 20, light: 'gesture-follow',
    description: 'A soft point follows airy sound from ear to ear. Light movement follows the sound you hear.',
    make: () => mix(2811, [layer('air', { level: .7, tone: .3, period: 20, width: 1, rate: .8 })]) },
  { id: 'brush-in-front', name: 'Brush in front of you', group: 'Sound and gesture', minutes: 30, light: 'gesture-brush',
    description: 'Soft textured brush passes drift across your view with close brushing sounds and quiet pauses.',
    make: () => mix(2927, [layer('brush', { level: .7, tone: .4, period: 18, width: .9, rate: .75 })]) },
  { id: 'tap-and-follow', name: 'Little points of contact', group: 'Sound and gesture', minutes: 20, light: 'gesture-tap',
    description: 'Rounded fingertip sounds create small points of contact on the side you hear them.',
    make: () => mix(3041, [layer('fingertip-taps', { level: .65, period: 24, width: .85, tone: .4, rate: .8 })]) },
  { id: 'pencil-trace', name: 'Pencil and light tracing', group: 'Sound and gesture', minutes: 30, light: 'gesture-trace',
    description: 'Recorded pencil strokes guide a fine light trace, with real stereo detail and pauses between phrases.',
    make: () => mix(3163, [layer('recorded-writing', { level: .7, motion: 'still', tone: .7, rate: .9 })]) },
  { id: 'close-object-study', name: 'A closer look', group: 'Sound and gesture', minutes: 20, light: 'gesture-inspect',
    description: 'A translucent object moves closer with recorded crinkles, then recedes into the dark.',
    make: () => mix(3271, [layer('recorded-crinkles', { level: .7, motion: 'wander', width: .7, period: 28, tone: .6, rate: .8 })]) },
  { id: 'ear-attention-lights', name: 'Ear attention in the dark', group: 'Sound and gesture', minutes: 30, light: 'gesture-ear',
    description: 'Warm ear cups and soft light at each edge follow the changing sound pressure on that side.',
    make: () => mix(3391, [layer('cupping', { pan: -1, motion: 'still', pressure: .9, tone: .25, level: .55, period: 16 }),
      layer('cupping', { pan: 1, motion: 'still', pressure: .9, pressurePhase: 180, tone: .25, level: .55, period: 16 })], true) },
  { id: 'water-light-ritual', name: 'Drops in the light', group: 'Sound and gesture', minutes: 20, light: 'gesture-drop',
    description: 'Small water sounds create gentle rings that travel with the sound. A quiet spray sits behind them.',
    make: () => mix(3511, [layer('water', { level: .6, period: 22, width: .8, tone: .45, rate: .8 }),
      layer('recorded-spray', { level: .15, motion: 'still', tone: .5, pan: .25, rate: .8 })]) },
];
