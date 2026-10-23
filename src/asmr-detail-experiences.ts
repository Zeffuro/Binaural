import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer>): AsmrLayer => ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const mix = (seed: number, layers: AsmrLayer[], mode: AsmrVariation['mode'] = 'natural'): AsmrSettings => ({ level: .45, layers,
  variation: { ...defaultAsmrVariation(), mode, seed, amount: .7, phraseSeconds: 18, turnSeconds: 60 } });

export const asmrDetailExperiences: AsmrPreset[] = [
  { id: 'wooden-keepsakes', name: 'Wooden keepsakes', group: 'Small sound details', minutes: 20, light: 'gesture-tap',
    description: 'Centered hollow wood taps take turns with small clicks to the right, with quiet gaps and soft points of light. A 20-minute paired session.',
    make: () => mix(4603, [layer('wood', { level: .5, rate: .7, tone: .3 }),
      layer('soft-clicks', { level: .25, rate: .65, tone: .3, pan: .45 })], 'turns') },
  { id: 'counting-on-glass', name: 'Counting on glass', group: 'Small sound details', minutes: 30, light: 'gesture-tap',
    description: 'Small glass taps move slowly between the ears, with changing phrases, quiet pauses and little light contacts. A 30-minute paired session.',
    make: () => mix(4721, [layer('glass', { level: .45, rate: .65, tone: .25, motion: 'sweep', width: .65, period: 48 })]) },
  { id: 'paper-beside-the-keys', name: 'Paper beside the keys', group: 'Small sound details', minutes: 45, light: 'gesture-trace',
    description: 'Dry paper folds on the left alternate with soft keyboard clusters on the right. Quiet pauses and gentle traces accompany a 45-minute session.',
    make: () => mix(4831, [layer('paper', { level: .4, rate: .7, tone: .3, pan: -.4 }),
      layer('keyboard', { level: .3, rate: .75, tone: .3, pan: .4 })], 'turns') },
  { id: 'water-under-small-bells', name: 'Water under small bells', group: 'Small sound details', minutes: 60, light: 'gesture-drop',
    description: 'Centered droplets sit beside faint chimes to the right, with varied phrases and quiet gaps. Soft rings accompany a 60-minute paired session.',
    make: () => mix(4951, [layer('water', { level: .4, rate: .75, tone: .35 }),
      layer('chimes', { level: .15, rate: .65, tone: .25, pan: .3 })]) },
  { id: 'trail-of-fingertips', name: 'A trail of fingertips', group: 'Small sound details', minutes: 20, light: 'gesture-follow',
    description: 'Rounded fingertip taps sweep across the front in 3D headphones, with quiet gaps and a soft following light. A 20-minute paired session.',
    make: () => mix(5077, [layer('fingertip-taps', { level: .5, rate: .7, tone: .3, period: 44,
      spatial: { azimuth: 0, elevation: 0, distance: .8, motion: 'sweep' } })]) },
  { id: 'comb-and-quiet-clicks', name: 'Comb and quiet clicks', group: 'Small sound details', minutes: 30, light: 'gesture-brush',
    description: 'Fine comb flutters on the left take turns with small clicks on the right. Quiet gaps and soft brush passes accompany a 30-minute paired session.',
    make: () => mix(5197, [layer('comb', { level: .45, rate: .65, tone: .3, pan: -.3 }),
      layer('soft-clicks', { level: .2, rate: .7, tone: .25, pan: .35 })], 'turns') },
];
