import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { defaultAsmrVariation, type AsmrVariation } from './asmr-variation';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer> = {}): AsmrLayer => ({ ...makeAsmrLayer(sound), motion: 'still', ...values });
const flow = (mode: AsmrVariation['mode'], seed: number, phraseSeconds: number): AsmrVariation =>
  ({ ...defaultAsmrVariation(), mode, seed, phraseSeconds, turnSeconds: 180 });

export const asmrRoutines = [
  { id: 'pages-evening', name: 'Pages in the evening', group: 'Long sessions', minutes: 30, light: 'amber-facets',
    description: 'Recorded page turns with changing phrase positions and quiet pauses. A 30-minute session from Explore.',
    make: (): AsmrSettings => ({ level: .55, variation: flow('natural', 1461, 18), layers: [layer('recorded-pages', { level: .7, tone: .7 })] }) },
  { id: 'hairbrush-unhurried', name: 'Unhurried hair brushing', group: 'Long sessions', minutes: 45, light: 'rose-glass',
    description: 'Recorded hair brushing keeps its stereo texture, with varied strokes and pauses. A 45-minute session from Explore.',
    make: (): AsmrSettings => ({ level: .55, variation: flow('natural', 3059, 20), layers: [layer('recorded-hair', { level: .7, tone: .75, rate: .85 })] }) },
  { id: 'water-preparation', name: 'Water preparation', group: 'Long sessions', minutes: 30, light: 'blue-hour',
    description: 'Real spray-bottle sounds beside a few soft water drops, each with breathing room. A 30-minute session from Explore.',
    make: (): AsmrSettings => ({ level: .5, variation: flow('natural', 4211, 14), layers: [layer('recorded-spray', { level: .6, pan: -.25, tone: .6 }), layer('water', { level: .2, pan: .3, rate: .75, tone: .35 })] }) },
  { id: 'pencil-notes', name: 'Pencil notes', group: 'Long sessions', minutes: 45, light: 'soft-torch',
    description: 'Recorded pencil strokes on paper with changing phrases and little pauses. A 45-minute session from Explore.',
    make: (): AsmrSettings => ({ level: .55, variation: flow('natural', 5351, 16), layers: [layer('recorded-writing', { level: .7, tone: .7, rate: .9 })] }) },
  { id: 'unhurried-salon', name: 'Unhurried salon', group: 'Long sessions', minutes: 60, light: 'wandering-light',
    description: 'Hair brushing, mist and comb textures take three-minute turns, with varied phrases. A one-hour session from Explore.',
    make: (): AsmrSettings => ({ level: .5, variation: flow('turns', 6491, 18), layers: [layer('recorded-hair', { level: .65, tone: .7 }), layer('recorded-spray', { level: .5, tone: .55 }), layer('comb', { level: .4, tone: .4, rate: .7 })] }) },
  { id: 'quiet-desk-journey', name: 'Quiet desk journey', group: 'Long sessions', minutes: 60, light: 'quiet-focus',
    description: 'Pencil writing, page turns and warm wood taps take three-minute turns. A one-hour session from Explore.',
    make: (): AsmrSettings => ({ level: .5, variation: flow('turns', 7717, 16), layers: [layer('recorded-writing', { level: .65, tone: .65 }), layer('recorded-pages', { level: .55, tone: .6 }), layer('wood', { level: .4, tone: .3, rate: .7 })] }) },
];
