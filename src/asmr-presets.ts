import { makeAsmrLayer, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { asmrExperiences } from './asmr-experiences';
import { asmrRoutines } from './asmr-routines';
import { asmrGesturePresets } from './asmr-gesture-presets';
import { asmrSpatialExperiences } from './asmr-spatial-experiences';
import { asmrDetailExperiences } from './asmr-detail-experiences';
import { asmrSpaceExperiences } from './asmr-space-experiences';
import { asmrRecordedExperiences } from './asmr-recorded-experiences';

const layer = (sound: AsmrSound, values: Partial<AsmrLayer> = {}): AsmrLayer => ({ ...makeAsmrLayer(sound), ...values });
export interface AsmrPreset {
  id: string; name: string; description: string; group?: string; light: string; minutes?: number;
  make: () => AsmrSettings;
}
export const asmrPresets: AsmrPreset[] = [
  { id: 'glass-lantern', name: 'Glass lantern', description: 'Small glass taps and soft brushes with cool moving reflections.', light: 'prism-lantern',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('glass', { level: .45, period: 12 }), layer('brush', { level: .6, motion: 'wander', period: 18, tone: .3 })] }) },
  { id: 'red-sweep', name: 'Red sweep', description: 'An airy left-to-right sweep with a soft red scan.', light: 'red-scan',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('air', { period: 10, width: 1, tone: .35 }), layer('scratch', { level: .3, period: 20, rate: .65, tone: .25 })] }) },
  { id: 'rose-brushes', name: 'Rose brushes', description: 'Two slow brushes cross each other beneath warm rose glass.', light: 'rose-glass',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('brush', { pan: -.3, period: 16, rate: .75 }), layer('brush', { pan: .3, period: 23, rate: .6, tone: .3 })] }) },
  { id: 'paper-prism', name: 'Paper prism', description: 'Delicate paper folds and warm wood tapping with amber facets.', light: 'amber-facets',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('paper', { level: .55, period: 14, tone: .35 }), layer('wood', { level: .5, motion: 'wander', period: 22, rate: .8 })] }) },
  { id: 'blue-droplets', name: 'Blue droplets', description: 'Rounded water drops and muted chimes beneath blue glass.', light: 'blue-hour',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('water', { level: .55, period: 18 }), layer('chimes', { level: .3, motion: 'wander', period: 32, rate: .7, tone: .3 })] }) },
  { id: 'torch-whisper', name: 'Torch and air', description: 'A soft moving torch with gentle air and slow textured strokes.', light: 'soft-torch',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('air', { level: .45, period: 20, tone: .25 }), layer('brush', { level: .5, period: 28, rate: .5, tone: .3 })] }) },
  { id: 'ear-cupping', name: 'Warm ear cups', group: 'Ear focus', description: 'Warm textures close to each ear, with slowly changing muffled color.', light: 'amber-facets',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('cupping', { pan: -1, motion: 'still', pressure: .85, tone: .25, level: .6, period: 14 }), layer('cupping', { pan: 1, motion: 'still', pressure: .85, pressurePhase: 180, tone: .25, level: .6, period: 14 })] }) },
  { id: 'left-ear-focus', name: 'Left ear attention', group: 'Ear focus', description: 'Warm cupping and fine brushing entirely in your left ear.', light: 'rose-glass',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('cupping', { pan: -1, motion: 'still', pressure: .9, tone: .2, period: 12 }), layer('brush', { pan: -1, motion: 'still', level: .25, tone: .3, rate: .7 })] }) },
  { id: 'right-ear-focus', name: 'Right ear attention', group: 'Ear focus', description: 'Warm cupping and fine brushing entirely in your right ear.', light: 'blue-hour',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('cupping', { pan: 1, motion: 'still', pressure: .9, tone: .2, period: 12 }), layer('brush', { pan: 1, motion: 'still', level: .25, tone: .3, rate: .7 })] }) },
  { id: 'alternating-cupping', name: 'Alternating ear cups', group: 'Ear focus', description: 'Each ear takes a turn with a deep, soft muffled sweep. The cupping cycles run in opposite phases.', light: 'red-orbit',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('cupping', { pan: -1, motion: 'still', pressure: 1, period: 8, tone: .4, level: .65 }), layer('cupping', { pan: 1, motion: 'still', pressure: 1, period: 8, tone: .4, level: .65, pressurePhase: 180 })] }) },
  { id: 'slow-ear-sweep', name: 'Slow ear sweep', group: 'Ear focus', description: 'Recorded hand rubbing travels slowly from one ear to the other.', light: 'wandering-light',
    make: (): AsmrSettings => ({ level: .65, layers: [layer('recorded-hands', { width: 1, period: 18, pressure: .35, tone: .6, level: .8 })] }) },
  { id: 'hands-close', name: 'Hands up close', group: 'Recorded textures', description: 'Real hand rubbing with a quiet warm texture underneath.', light: 'soft-torch',
    make: (): AsmrSettings => ({ level: .65, layers: [layer('recorded-hands', { level: .85, period: 20, tone: .65, pressure: .4 }), layer('cupping', { level: .2, motion: 'wander', period: 24, tone: .25 })] }) },
  { id: 'cloth-cocoon', name: 'Soft cloth cocoon', group: 'Recorded textures', description: 'Recorded cloth rustles close to each ear, with alternating muffled movement.', light: 'rose-glass',
    make: (): AsmrSettings => ({ level: .65, layers: [layer('recorded-cloth', { pan: -1, motion: 'still', level: .8, tone: .6, pressure: .8, period: 16 }), layer('recorded-cloth', { pan: 1, motion: 'still', level: .8, tone: .6, pressure: .8, period: 16, pressurePhase: 180, rate: .92 })] }) },
  { id: 'soft-crinkle-room', name: 'Delicate crinkles', group: 'Recorded textures', description: 'Real packaging folds with a soft brush moving behind them.', light: 'violet-jewels',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('recorded-crinkles', { level: .9, tone: .65, period: 18 }), layer('brush', { level: .25, tone: .35, motion: 'wander', period: 25 })] }) },
  { id: 'tiny-metal-taps', name: 'Tiny metal taps', group: 'Recorded textures', description: 'Small recorded radiator taps, softened and slowed for close listening.', light: 'crystal-stars',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('recorded-metal', { level: .5, tone: .35, rate: .75, period: 16 }), layer('air', { level: .12, tone: .3, motion: 'still' })] }) },
  { id: 'meadow-brushing', name: 'Meadow brushing', group: 'Recorded textures', description: 'Real grass brushing in the breeze, with faint water in the distance.', light: 'mint-prism',
    make: (): AsmrSettings => ({ level: .6, layers: [layer('recorded-grass', { level: .65, tone: .6, motion: 'wander', width: .5, period: 30 })] }) },
  { id: 'fingertip-duet', name: 'Fingertip duet', group: 'Sensory textures', description: 'Rounded fingertip taps take opposite sides at two gentle speeds.', light: 'amber-facets',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('fingertip-taps', { pan: -.8, motion: 'still', level: .55, rate: .85, tone: .45 }), layer('fingertip-taps', { pan: .8, motion: 'still', level: .5, rate: 1.1, tone: .4 })] }) },
  { id: 'quiet-keyboard', name: 'Quiet keyboard', group: 'Sensory textures', description: 'A single close keyboard with little presses, releases and pauses.', light: 'blue-hour',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('keyboard', { motion: 'still', width: 0, level: .65, rate: .85, tone: .4 })] }) },
  { id: 'comb-and-cloth', name: 'Comb and cloth', group: 'Sensory textures', description: 'Fine comb flutters cross a background of softly recorded cloth.', light: 'rose-glass',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('comb', { level: .45, period: 16, rate: .8, tone: .45 }), layer('recorded-cloth', { level: .35, motion: 'wander', period: 27, tone: .45 })] }) },
  { id: 'woven-hush', name: 'Woven hush', group: 'Sensory textures', description: 'A slow fabric brushing texture sits gently in the center.', light: 'soft-torch',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('fabric', { motion: 'still', level: .7, rate: .75, tone: .5, pressure: .25, period: 20 })] }) },
  { id: 'rain-stick-garden', name: 'Rain stick garden', group: 'Sensory textures', description: 'Tiny cascading beads drift above real grass and a few rounded drops.', light: 'mint-prism',
    make: (): AsmrSettings => ({ level: .55, layers: [layer('rain-stick', { level: .55, motion: 'wander', period: 25, tone: .45 }), layer('recorded-grass', { level: .3, motion: 'still', tone: .4 }), layer('water', { level: .18, period: 32, rate: .7, tone: .35 })] }) },
  { id: 'little-object-tray', name: 'Little object tray', group: 'Sensory textures', description: 'Gentle object clicks, recorded metal taps and soft fingertips around a small tray.', light: 'crystal-stars',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('soft-clicks', { level: .45, pan: -.35, motion: 'still', tone: .35, rate: .8 }), layer('recorded-metal', { level: .28, pan: .4, motion: 'still', tone: .3, rate: .7 }), layer('fingertip-taps', { level: .25, period: 24, tone: .4 })] }) },
  { id: 'left-soft-attention', name: 'Left soft attention', group: 'Sensory textures', description: 'Fabric brushing and warm cupping stay entirely in the left ear.', light: 'rose-glass',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('fabric', { pan: -1, motion: 'still', level: .5, tone: .45, rate: .8 }), layer('cupping', { pan: -1, motion: 'still', level: .35, tone: .25, pressure: .8, period: 18 })] }) },
  { id: 'right-comb-attention', name: 'Right comb attention', group: 'Sensory textures', description: 'Small comb flutters and recorded hand rubbing stay entirely in the right ear.', light: 'blue-hour',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('comb', { pan: 1, motion: 'still', level: .4, tone: .4, rate: .75 }), layer('recorded-hands', { pan: 1, motion: 'still', level: .4, tone: .5, pressure: .4, period: 20 })] }) },
  { id: 'soft-object-check', name: 'Soft object check', group: 'Sensory textures', description: 'A dentist-inspired sound scene of gentle tray clicks, cloth and nearby hand movements.', light: 'prism-lantern',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('soft-clicks', { level: .35, period: 18, rate: .7, tone: .3 }), layer('recorded-cloth', { level: .28, pan: -.4, motion: 'still', tone: .45 }), layer('recorded-hands', { level: .28, pan: .4, motion: 'still', tone: .45 }), layer('air', { level: .12, motion: 'still', tone: .2 })] }) },
  { id: 'parcel-on-desk', name: 'Parcel on the desk', group: 'Sensory textures', description: 'Recorded packaging folds beside quiet keys and a few fingertip taps.', light: 'violet-jewels',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('recorded-crinkles', { level: .45, pan: -.25, motion: 'still', tone: .5, rate: .85 }), layer('keyboard', { level: .28, pan: .35, motion: 'still', tone: .35, rate: .75 }), layer('fingertip-taps', { level: .25, motion: 'wander', period: 26, tone: .4 })] }) },
  { id: 'shoulder-side-fabric', name: 'Shoulder-side fabric', group: 'Sensory textures', description: 'Soft fabric rests above your right shoulder in 3D headphones, with recorded cloth centered nearby.', light: 'amber-facets',
    make: (): AsmrSettings => ({ level: .5, layers: [layer('fabric', { level: .5, motion: 'still', rate: .85, tone: .45, spatial: { azimuth: 110, elevation: 25, distance: .7, motion: 'still' } }), layer('recorded-cloth', { level: .25, motion: 'still', rate: .9, tone: .45 })] }) },
  { id: 'around-your-head', name: 'Around your head', group: 'Sensory textures', description: 'Soft fabric slowly circles your head in 3D headphones, beside comb flutters and recorded hand rubbing.', light: 'wandering-light',
    make: (): AsmrSettings => ({ level: .45, layers: [layer('fabric', { level: .4, period: 30, tone: .45, rate: .85, spatial: { azimuth: -90, elevation: 10, distance: .8, motion: 'orbit' } }), layer('comb', { level: .2, pan: .5, motion: 'still', tone: .4, rate: .7 }), layer('recorded-hands', { level: .25, pan: -.5, motion: 'still', tone: .45, pressure: .3 })] }) },
  ...asmrExperiences,
  ...asmrRoutines,
  ...asmrGesturePresets,
  ...asmrSpatialExperiences,
  ...asmrDetailExperiences,
  ...asmrSpaceExperiences,
  ...asmrRecordedExperiences,
];
