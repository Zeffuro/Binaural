import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer>): AsmrLayer => ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const mix = (seed: number, layers: AsmrLayer[], mode: AsmrVariation['mode'] = 'natural'): AsmrSettings => ({ level: .5, layers,
  variation: { ...defaultAsmrVariation(), mode, seed, phraseSeconds: 16, turnSeconds: 75 } });

export const asmrSpatialExperiences: AsmrPreset[] = [
  { id: 'brush-across-view', name: 'Brush across your view', group: 'Spatial and gesture', minutes: 30, light: 'gesture-brush',
    description: 'A single soft brush sweeps across the front in 3D headphones, with varied strokes and quiet pauses. A 30-minute paired session.',
    make: () => mix(3631, [layer('brush', { level: .65, rate: .65, tone: .3, period: 32,
      spatial: { azimuth: 0, elevation: 5, distance: .6, motion: 'sweep' } })]) },
  { id: 'hands-near-and-far', name: 'Hands near and far', group: 'Spatial and gesture', minutes: 20, light: 'gesture-inspect',
    description: 'Recorded hand rubbing gently approaches and recedes in 3D headphones. Soft light accompanies a 20-minute session with pauses.',
    make: () => mix(3761, [layer('recorded-hands', { level: .6, rate: .8, tone: .4, period: 36,
      spatial: { azimuth: -20, elevation: 10, distance: .85, motion: 'approach' } })]) },
  { id: 'comb-floating-up', name: 'Comb floating up', group: 'Spatial and gesture', minutes: 30, light: 'gesture-follow',
    description: 'Fine comb flutters rise and settle in front in 3D headphones, beside faint recorded cloth. A 30-minute paired session.',
    make: () => mix(3881, [layer('comb', { level: .55, rate: .65, tone: .35, period: 40,
      spatial: { azimuth: 15, elevation: 15, distance: .65, motion: 'rise' } }),
    layer('recorded-cloth', { level: .12, rate: .8, tone: .35, pan: -.2 })]) },
  { id: 'fabric-ribbon', name: 'A ribbon of fabric', group: 'Spatial and gesture', minutes: 45, light: 'gesture-brush',
    description: 'One soft fabric texture traces a slow figure eight in 3D headphones. A sparse 45-minute session with changing phrases and soft light.',
    make: () => mix(4001, [layer('fabric', { level: .6, rate: .7, tone: .35, period: 48,
      spatial: { azimuth: 0, elevation: 5, distance: .75, motion: 'figure-eight' } })]) },
  { id: 'paper-circling-light', name: 'Paper circling the light', group: 'Spatial and gesture', minutes: 30, light: 'gesture-inspect',
    description: 'Delicate paper folds circle slowly in 3D headphones, with a faint centered cloth texture. A 30-minute paired session.',
    make: () => mix(4127, [layer('paper', { level: .5, rate: .65, tone: .3, period: 54,
      spatial: { azimuth: -60, elevation: 5, distance: .85, motion: 'orbit' } }),
    layer('recorded-cloth', { level: .1, rate: .8, tone: .35 })]) },
  { id: 'small-tapping-visits', name: 'Small tapping visits', group: 'Spatial and gesture', minutes: 20, light: 'gesture-tap',
    description: 'Wood taps sweep in front in 3D headphones, taking turns with still glass taps on the right. A 20-minute session with small light contacts.',
    make: () => mix(4243, [layer('wood', { level: .55, rate: .7, tone: .3, period: 40,
      spatial: { azimuth: -15, elevation: 0, distance: .7, motion: 'sweep' } }),
    layer('glass', { level: .3, rate: .65, tone: .3, pan: .6 })], 'turns') },
  { id: 'pages-and-pencil-light', name: 'Pages beside a pencil', group: 'Spatial and gesture', minutes: 45, light: 'gesture-trace',
    description: 'Recorded pages and pencil strokes take quiet turns with their original stereo detail. Soft traces accompany a 45-minute session.',
    make: () => mix(4363, [layer('recorded-pages', { level: .55, rate: .85, tone: .6 }),
      layer('recorded-writing', { level: .6, rate: .9, tone: .65 })], 'turns') },
  { id: 'hairbrush-and-mist-light', name: 'Hairbrush and a little mist', group: 'Spatial and gesture', minutes: 30, light: 'gesture-ear',
    description: 'Recorded hair brushing and mist take gentle turns, preserving their stereo texture. A 30-minute session with soft edge lights.',
    make: () => mix(4481, [layer('recorded-hair', { level: .6, rate: .85, tone: .65 }),
      layer('recorded-spray', { level: .35, rate: .85, tone: .5 })], 'turns') },
];
