import { makeAsmrLayer } from './asmr-state';
import { defaultAsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

export const asmrPlasticPresets: AsmrPreset[] = [
  { id: 'plastic-quiet-approach', name: 'Clicks with a quiet return', group: 'Plastic clicks', minutes: 20, light: 'gesture-tap',
    description: 'Toy hinge clicks approach from behind one ear and fade at the front. The return is silent before the other ear takes its turn.',
    make: () => ({ level: .5, layers: [{
      ...makeAsmrLayer('recorded-plastic-toy'), clearTone: true, motion: 'still', rate: .88, level: .48, period: 14,
      spatial: { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return', quietReturn: { closest: .21, approach: 3.5, gap: 3.5 } },
    }] }) },
  { id: 'calculator-snap-detail', name: 'Little casing snaps', group: 'Plastic clicks', minutes: 20, light: 'gesture-tap',
    description: 'A crisp calculator casing snap, slowed down with pauses between short groups of clicks.',
    make: () => ({ level: .48, layers: [{
      ...makeAsmrLayer('recorded-plastic-snap'), clearTone: true, motion: 'still', pan: -.25, rate: .68, level: .38,
    }], variation: { ...defaultAsmrVariation(), mode: 'natural', seed: 8101, amount: .8, phraseSeconds: 6 } }) },
  { id: 'zip-ties-and-lids', name: 'Zip ties and lids', group: 'Plastic clicks', minutes: 30, light: 'gesture-tap',
    description: 'The finer clicks of a zip tie take turns with rounder plastic lid snaps on opposite sides.',
    make: () => ({ level: .46, layers: [
      { ...makeAsmrLayer('recorded-plastic-zip-tie'), clearTone: true, motion: 'still', pan: -.55, rate: .83, level: .42 },
      { ...makeAsmrLayer('recorded-plastic-lid'), clearTone: true, motion: 'still', pan: .55, rate: .94, level: .4 },
    ], variation: { ...defaultAsmrVariation(), mode: 'turns', seed: 8117, amount: .72, phraseSeconds: 12, turnSeconds: 45 } }) },
  { id: 'hinge-clicks-by-ear', name: 'Hinge clicks by each ear', group: 'Plastic clicks', minutes: 20, light: 'gesture-tap',
    description: 'A slow approach brings a small toy hinge click close to one ear. After a quiet pause, the other ear takes its turn.',
    make: () => ({ level: .5, layers: [{
      ...makeAsmrLayer('recorded-plastic-toy'), clearTone: true, motion: 'still', rate: .94, level: .44,
      spatial: { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return',
        quietReturn: { closest: .19, approach: 3.2, gap: 3.9, syncClicks: true } },
    }] }) },
  { id: 'casing-snap-by-ear', name: 'Casing snaps by each ear', group: 'Plastic clicks', minutes: 20, light: 'gesture-tap',
    description: 'A crisp calculator casing snap lands close to alternating ears, with a short quiet pause after each snap fades.',
    make: () => ({ level: .48, layers: [{
      ...makeAsmrLayer('recorded-plastic-snap'), clearTone: true, motion: 'still', rate: .9, level: .38,
      spatial: { azimuth: 0, elevation: 0, distance: .75, motion: 'quiet-return',
        quietReturn: { closest: .23, approach: 2.4, gap: 2.6, syncClicks: true } },
    }] }) },
  { id: 'plastic-clicks-after-dark', name: 'Plastic clicks after dark', group: 'Plastic clicks', minutes: 45, light: 'gesture-tap',
    description: 'Toy hinges, a light switch, a retractable pen and a push button trade close clicks from ear to ear with changing pauses.',
    make: () => ({ level: .46, layers: [{
      ...makeAsmrLayer('recorded-plastic-toy'), clearTone: true, motion: 'still', rate: .95, level: .42,
      spatial: { azimuth: 0, elevation: 0, distance: .85, motion: 'quiet-return',
        quietReturn: { closest: .20, approach: 3.2, gap: 5.2, syncClicks: true,
          sequence: { recordings: ['recorded-plastic-switch', 'recorded-plastic-pen', 'recorded-plastic-button'],
            gapSpread: 3, seed: 26913 } } },
    }] }) },
];
