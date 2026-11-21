import { makeAsmrLayer } from './asmr-state';
import { defaultAsmrVariation } from './asmr-variation';
import type { AsmrPreset } from './asmr-presets';

export const asmrContrastPresets: AsmrPreset[] = [
  { id: 'small-sound-sampler', name: 'Small sound sampler', group: 'Sound contrasts', minutes: 20, light: 'gesture-inspect',
    description: 'Zip tie ratchets, slow hair brushing and paper folds take short turns, with pauses between phrases.',
    make: () => ({ level: .46, layers: [
      { ...makeAsmrLayer('recorded-plastic-zip-tie'), motion: 'still', pan: -.48, level: .36, clearTone: true },
      { ...makeAsmrLayer('recorded-hair'), motion: 'still', pan: .42, rate: .76, tone: .58, level: .42 },
      { ...makeAsmrLayer('recorded-sketchbook'), motion: 'still', rate: .88, level: .45, clearTone: true },
    ], variation: { ...defaultAsmrVariation(), seed: 8123, mode: 'turns', amount: .75, phraseSeconds: 6, turnSeconds: 18 } }) },
  { id: 'unhurried-materials', name: 'Unhurried materials', group: 'Sound contrasts', minutes: 30, light: 'gesture-brush',
    description: 'Soft cloth, pencil sketching and hollow taps get long turns, with space to settle into each sound.',
    make: () => ({ level: .45, layers: [
      { ...makeAsmrLayer('recorded-blanket'), motion: 'still', pan: -.22, tone: .65, rate: .82, level: .48 },
      { ...makeAsmrLayer('recorded-sketching-long'), motion: 'still', clearTone: true, rate: .95, level: .47 },
      { ...makeAsmrLayer('wood'), motion: 'still', pan: .26, rate: .75, tone: .38, level: .33 },
    ], variation: { ...defaultAsmrVariation(), seed: 8167, mode: 'turns', amount: .38, phraseSeconds: 26, turnSeconds: 150 } }) },
  { id: 'brushing-with-a-pause', name: 'Brushing with a pause', group: 'Sound contrasts', minutes: 20, light: 'gesture-brush',
    description: 'Recorded hair brushing makes a slow pass from each ear, with a longer quiet stretch before it switches sides.',
    make: () => ({ level: .45, layers: [{
      ...makeAsmrLayer('recorded-hair'), motion: 'still', rate: .85, clearTone: true, level: .45,
      spatial: { azimuth: 0, elevation: 4, distance: .9, motion: 'quiet-return', quietReturn: { closest: .27, approach: 7, gap: 9 } },
    }] }) },
];
