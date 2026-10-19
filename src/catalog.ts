import { initialSession, makeLayer, type Session } from './model';

export const catalogSources = {
  beats: 'https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php',
  solfeggio: 'https://mynoise.net/NoiseMachines/solfeggioTonesGenerator.php',
  schumann: 'https://www.frequencydetector.com/theta-wave-generator/',
  tuning: 'https://www.iawaketechnologies.com/product/shortcuts-to-awakening/',
  combinations: 'https://www.binauralbeatsmeditation.com/frequency-guide/',
  love: 'https://www.iawaketechnologies.com/product/in-nature/',
  concert: 'https://cdn.korg.com/jp/support/download/files/f503a5f82b6b7e3006a81747f6032330.pdf',
};

export interface Frequency {
  label: string;
  detail: string;
  hz: number;
  kind: 'beat' | 'carrier';
  group: string;
  tags: string[];
  aliases: string[];
  sources: string[];
  evidence: string;
}

const exploratory = 'An exploratory audio setting; an EEG band name does not establish a listening outcome.';
const traditional = 'Editorial browsing label for a documented modern wellness association; attributed effects are unproven.';
const original = 'Original Binaural sound design; the recipe has not been clinically validated.';
const beat = (label: string, hz: number, detail: string, tags: string[] = []): Frequency => ({
  label, hz, detail, kind: 'beat', group: 'Brainwave bands', tags, aliases: [],
  sources: [catalogSources.beats], evidence: exploratory,
});

export const frequencies: Frequency[] = [
  beat('Delta', 2, '0.5–4 Hz: sleep-associated EEG band', ['delta', 'rest']),
  beat('Theta', 6, '4–8 Hz: drowsiness / meditation association', ['theta', 'meditation']),
  beat('Alpha', 10, '8–13 Hz: relaxed wakefulness association', ['alpha', 'unwind']),
  beat('Beta', 18, '13–30 Hz: active thinking association', ['beta', 'focus']),
  beat('Gamma', 40, '30+ Hz: experimental 40 Hz setting', ['gamma', 'experiment']),
  ...([
    [174, 'Grounding', ['Pain relief (claimed)']], [285, 'Restoration', ['Expanded consciousness (claimed)']],
    [396, 'Release', ['Ut', 'Fear and guilt']], [417, 'Change', ['Re', 'Transition']],
    [528, 'Love', ['Mi', 'Miracle tone']], [639, 'Connection', ['Fa', 'Relationships']],
    [741, 'Expression', ['Sol', 'Problem solving']], [852, 'Intuition', ['La', 'Pure spirit']],
    [963, 'Consciousness', ['Si', 'Supreme state of mind (claimed)']],
  ] as [number, string, string[]][]).map(([hz, label, aliases]): Frequency => ({
    hz, label, aliases, kind: 'carrier', group: 'Solfeggio tradition',
    detail: 'Wellness label with an unproven effect',
    tags: ['solfeggio', 'tradition', 'meditation'],
    sources: hz === 528 ? [catalogSources.solfeggio, catalogSources.love] : [catalogSources.solfeggio], evidence: traditional,
  })),
  { label: '432 Hz tuning', hz: 432, kind: 'carrier', group: 'Tuning', aliases: ['A4 alternative'],
    detail: 'Alternative pitch reference; no special effect established', tags: ['tuning', '432'],
    sources: [catalogSources.tuning], evidence: 'Documented musical tuning choice; a pure tone does not retune your music.' },
  { label: '440 Hz tuning', hz: 440, kind: 'carrier', group: 'Tuning', aliases: ['A4 concert pitch'],
    detail: 'A4 concert pitch reference', tags: ['tuning', 'reference'],
    sources: [catalogSources.concert], evidence: 'Instrument pitch reference, with no wellness effect implied.' },
  ...([
    ['Slow delta', 0.5, 'delta'], ['One hertz', 1, 'delta'], ['Upper delta', 3, 'delta'],
    ['Delta / theta edge', 4, 'theta'], ['Low theta', 5, 'theta'], ['Upper theta', 7, 'theta'],
    ['Theta / alpha edge', 8, 'alpha'], ['Soft alpha', 9, 'alpha'], ['Upper alpha', 11, 'alpha'],
    ['Twelve hertz', 12, 'alpha'], ['Low beta', 14, 'beta'], ['Sixteen hertz', 16, 'beta'],
    ['Upper beta', 24, 'beta'], ['Low gamma', 32, 'gamma'],
  ] as [string, number, string][]).map(([label, hz, band]) =>
    beat(label, hz, `${hz} Hz difference, an illustrative ${band} setting; band boundaries vary`, [band, 'explore'])),
  { label: 'Schumann-inspired', hz: 7.83, kind: 'beat', group: 'Named beat references',
    detail: '7.83 Hz difference, inspired by an electromagnetic resonance, not a recreation of it',
    tags: ['theta', 'schumann', 'earth', 'meditation'], aliases: ['Schumann resonance', 'Earth resonance'],
    sources: [catalogSources.schumann, catalogSources.tuning],
    evidence: 'Documented audio-generator label; an acoustic beat is not an electromagnetic field or proven Earth synchronizer.' },
  ...[100, 128, 256, 512, 1000].map((hz): Frequency => ({
    label: `${hz} Hz reference`, hz, kind: 'carrier', group: 'Sound design', aliases: [],
    detail: 'Plain sine-tone building block with no special effect attributed', tags: ['reference', 'sound design'],
    sources: [], evidence: 'An independently selected synthesis reference, not a sourced wellness claim.',
  })),
];

export interface Preset {
  id: string;
  name: string;
  category: string;
  description: string;
  session: Session;
  tags: string[];
  aliases: string[];
  sources: string[];
  evidence: string;
}

type Tone = [left: number, difference: number, level?: number];
const recipe = (id: string, name: string, category: string, description: string,
  tones: Tone[], ambient: Session['ambient'], minutes = 20,
  tags: string[] = [], sources: string[] = [catalogSources.beats]): Preset => ({
  id, name, category, description, tags, aliases: [], sources, evidence: original,
  session: { ...initialSession(), name, ambient, minutes,
    layers: tones.map(([left, difference, level = 0.6]) => ({
      ...makeLayer(left, left + difference, `${left} Hz: ${difference} Hz difference`), level,
      route: difference === 0 ? 'mixed' : 'binaural',
    })),
  },
});
const preset = (id: string, name: string, category: string, description: string,
  left: number, difference: number, ambient: Session['ambient'], minutes = 20): Preset =>
  recipe(id, name, category, description, [[left, difference]], ambient, minutes,
    [category.toLowerCase(), `${difference} Hz`],
    [difference === 6 && left === 528 ? catalogSources.love : left === 963 ? catalogSources.solfeggio : catalogSources.beats]);

export const presets: Preset[] = [
  preset('morning', 'Quiet morning', 'UNWIND', 'An airy 10 Hz pair, softened by pink noise.', 200, 10, 'pink'),
  preset('tide', 'Low tide', 'DRIFT', 'A low 6 Hz pair and a slowly moving synthetic sea.', 180, 6, 'ocean', 30),
  preset('night', 'After hours', 'REST', 'A 2 Hz difference over a warm brown-noise bed.', 120, 2, 'brown', 30),
  preset('desk', 'Clear desk', 'FOCUS', 'An 18 Hz experiment with a little less background.', 220, 18, 'none', 25),
  preset('love', 'Heart space', 'TRADITION', '528 Hz “Love” carrier + 6 Hz difference. A traditional label, not a promised effect.', 528, 6, 'pink'),
  preset('orbit', 'Inner orbit', 'EXPLORE', '963 Hz “Consciousness” carrier + 10 Hz difference. Claims are unproven.', 963, 10, 'none'),
  recipe('schumann', 'Earth interval', 'TRADITION',
    '200 / 207.83 Hz: an acoustic nod to the Schumann label, over synthetic ocean. No electromagnetic field is generated.',
    [[200, 7.83]], 'ocean', 20, ['schumann', 'earth', 'theta', '7.83 Hz'], [catalogSources.schumann]),
  recipe('432-theta', '432 theta', 'TRADITION',
    '432 / 438 Hz gives a 6 Hz difference. An original pairing of a familiar pitch reference and theta label.',
    [[432, 6]], 'brown', 20, ['432', 'theta', 'meditation'], [catalogSources.tuning]),
  recipe('432-alpha', '432 alpha', 'TRADITION',
    '432 / 441 Hz gives a 9 Hz difference with a quiet pink bed. A listening experiment, without a tuning benefit claim.',
    [[432, 9]], 'pink', 20, ['432', 'alpha', 'unwind'], [catalogSources.tuning]),
  recipe('528-alpha', 'Love alpha', 'TRADITION',
    '528 / 539 Hz gives an 11 Hz difference. “Love” is a wellness alias, not an emotional outcome.',
    [[528, 11]], 'pink', 20, ['528', 'love', 'alpha', 'solfeggio'], [catalogSources.love, catalogSources.combinations]),
  recipe('396-theta', 'Release theta', 'TRADITION',
    '396 / 402 Hz over brown noise. The “Release” association is symbolic; this is an original static recipe.',
    [[396, 6]], 'brown', 20, ['396', 'release', 'theta', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('417-alpha', 'Change alpha', 'TRADITION',
    '417 / 426 Hz with an ocean bed. “Change” names a modern tradition, without a promised personal effect.',
    [[417, 9]], 'ocean', 20, ['417', 'change', 'alpha', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('639-theta', 'Connection theta', 'TRADITION',
    '639 / 644 Hz with pink noise. Explore the “Connection” label as a sound choice.',
    [[639, 5]], 'pink', 20, ['639', 'connection', 'theta', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('741-alpha', 'Expression alpha', 'TRADITION',
    '741 / 751 Hz, with no background. This higher carrier makes a brighter comparison to Quiet morning.',
    [[741, 10]], 'none', 15, ['741', 'expression', 'alpha', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('852-theta', 'Intuition theta', 'TRADITION',
    '852 / 859 Hz over a low brown bed. The “Intuition” association is unproven.',
    [[852, 7]], 'brown', 15, ['852', 'intuition', 'theta', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('174-285', 'Foundation duet', 'TRADITION',
    'Two steady mixed tones at 174 and 285 Hz. No binaural offset; listen to the interval itself.',
    [[174, 0, 0.4], [285, 0, 0.4]], 'brown', 15, ['174', '285', 'grounding', 'restoration', 'mixed', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('396-417', 'Release & change', 'TRADITION',
    '396 / 402 Hz and 417 / 423 Hz together. Extra tones also create same-ear interference; this is a texture experiment.',
    [[396, 6, 0.35], [417, 6, 0.35]], 'pink', 20, ['396', '417', 'theta', 'layers', 'solfeggio'], [catalogSources.solfeggio]),
  recipe('528-639', 'Love & connection', 'TRADITION',
    'Steady 528 and 639 Hz mixed tones plus a separate 160 / 166 Hz pair. Symbolic names, original combination.',
    [[528, 0, 0.25], [639, 0, 0.25], [160, 6, 0.4]], 'ocean', 20,
    ['528', '639', 'love', 'connection', 'theta', 'layers', 'solfeggio'], [catalogSources.solfeggio, catalogSources.love]),
  recipe('delta-half', 'Long interval', 'REST',
    '100 / 100.5 Hz: one very slow difference cycle every two seconds, with a brown bed.',
    [[100, 0.5]], 'brown', 30, ['delta', '0.5 Hz', 'rest']),
  recipe('theta-layers', 'Double horizon', 'DRIFT',
    'Two 5 Hz pairs at 160 and 320 Hz. Widely spaced carriers make an original layered theta texture.',
    [[160, 5, 0.4], [320, 5, 0.35]], 'ocean', 25, ['theta', '5 Hz', 'layers', 'meditation']),
  recipe('alpha-layers', 'Open window', 'UNWIND',
    'A 9 Hz pair at 190 Hz plus a quieter 11 Hz pair at 380 Hz. Simultaneous settings; no frequency ramp.',
    [[190, 9, 0.4], [380, 11, 0.3]], 'pink', 20, ['alpha', '9 Hz', '11 Hz', 'layers']),
  recipe('beta-low', 'Reading room', 'FOCUS',
    '180 / 194 Hz: a 14 Hz experiment with a little pink noise. No concentration improvement is guaranteed.',
    [[180, 14]], 'pink', 25, ['beta', '14 Hz', 'study', 'focus']),
  recipe('gamma', 'Forty hertz study', 'EXPLORE',
    '220 / 260 Hz, a 40 Hz difference. A short gamma-range audio experiment; no cognitive or medical result is implied.',
    [[220, 40, 0.45]], 'none', 10, ['gamma', '40 Hz', 'experiment']),
  recipe('octaves', 'Octave lanterns', 'EXPLORE',
    'Steady 128, 256 and 512 Hz mixed tones, spaced by octaves. A plain synthesis texture without a beat target.',
    [[128, 0, 0.4], [256, 0, 0.3], [512, 0, 0.2]], 'none', 15, ['octaves', 'mixed', 'reference', 'layers'], []),
];
