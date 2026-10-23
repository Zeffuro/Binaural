import type { AsmrMarkerEvent } from './asmr-markers';
const TAU = Math.PI * 2;
type Random = () => number;

function pulse(data: Float32Array, rate: number, onset: number, duration: number, sample: (time: number) => number, events?: AsmrMarkerEvent[]): void {
  const first = Math.round(onset * rate), count = Math.ceil(duration * rate);
  if (first < data.length) events?.push({ start: first, length: Math.min(count, data.length - first) });
  for (let j = 0; j < count && first + j < data.length; j++) {
    if (first + j >= 0) data[first + j] += sample(j / rate);
  }
}

function fingertips(data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]): void {
  for (let onset = .16; onset < data.length / rate; onset += .24 + random() * .36) {
    const frequency = 115 + random() * 95, strength = .3 + random() * .25;
    pulse(data, rate, onset, .14, time => {
      const attack = 1 - Math.exp(-time * 1100);
      return strength * attack * (Math.sin(TAU * frequency * time) * Math.exp(-time * 57)
        + .2 * Math.sin(TAU * frequency * 2.34 * time) * Math.exp(-time * 100)
        + (random() * 2 - 1) * .14 * Math.exp(-time * 190));
    }, events);
    if (random() > .55) pulse(data, rate, onset + .085, .07,
      time => Math.sin(TAU * frequency * 1.08 * time) * Math.sin(Math.min(1, time * 700) * Math.PI / 2) * Math.exp(-time * 85) * strength * .23, events);
  }
}

function keyboard(data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]): void {
  let key = 0;
  for (let onset = .22; onset < data.length / rate; onset += .11 + random() * .2 + (key % 9 === 0 ? .45 : 0)) {
    const frequency = (key++ % 7 === 0 ? 240 : 530) + random() * 140;
    const strength = .2 + random() * .2, release = .035 + random() * .055;
    for (const [offset, gain, pitch] of [[0, strength, frequency], [release, strength * .48, frequency * 1.55]]) {
      pulse(data, rate, onset + offset, .07, time => (1 - Math.exp(-time * 2600))
        * (Math.sin(TAU * pitch * time) * Math.exp(-time * 110)
          + (random() * 2 - 1) * .45 * Math.exp(-time * 310)) * gain, events);
    }
  }
}

function comb(data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]): void {
  for (let onset = .3; onset < data.length / rate; onset += .72 + random() * .55) {
    const teeth = 13 + Math.floor(random() * 14), spacing = .012 + random() * .012;
    const frequency = 1100 + random() * 700;
    const first = Math.round(onset * rate), last = Math.round((onset + spacing * (teeth - 1) * (1 + (teeth - 1) * .012)) * rate) + Math.ceil(.028 * rate);
    events?.push({ start: first, length: Math.min(data.length, last) - first });
    for (let tooth = 0; tooth < teeth; tooth++) {
      const strength = Math.sin(Math.PI * (tooth + 1) / (teeth + 1)) * (.1 + random() * .08);
      pulse(data, rate, onset + spacing * tooth * (1 + tooth * .012), .028, time =>
        (1 - Math.exp(-time * 4000)) * Math.exp(-time * 210) * strength
        * (Math.sin(TAU * frequency * time) + .35 * Math.sin(TAU * frequency * 1.61 * time)));
    }
  }
}

function fabric(data: Float32Array, rate: number, random: Random): void {
  let coarse = 0, fine = 0, movement = 0;
  const coarseStep = 1 - Math.exp(-TAU * 280 / rate), fineStep = 1 - Math.exp(-TAU * 2400 / rate);
  for (let i = 0; i < data.length; i++) {
    const time = i / rate, white = random() * 2 - 1;
    coarse += (white - coarse) * coarseStep;
    fine += (white - fine) * fineStep;
    movement += (random() - .5 - movement) * (1 - Math.exp(-5 / rate));
    const stroke = Math.max(0, Math.sin(TAU * time * .43 + Math.sin(time * 1.7) * .45));
    const weave = .7 + .3 * Math.sin(TAU * time * 31 + Math.sin(time * 9)) ** 2;
    data[i] = (coarse * .7 + (fine - coarse) * .3) * (.04 + stroke ** 1.7 * .7) * weave * (1 + movement);
  }
}

function rainStick(data: Float32Array, rate: number, random: Random): void {
  const seconds = data.length / rate;
  for (let onset = .08; onset < seconds; onset += .006 + random() * .018) {
    const tumble = .15 + .85 * Math.sin(Math.PI * onset / 3.8) ** 2;
    const frequency = 650 + random() * 2300, strength = (.025 + random() * .07) * tumble;
    pulse(data, rate, onset, .045, time => (1 - Math.exp(-time * 4500)) * strength
      * (Math.sin(TAU * frequency * time) * Math.exp(-time * 200)
        + Math.sin(TAU * 185 * time) * .3 * Math.exp(-time * 95)
        + (random() * 2 - 1) * .25 * Math.exp(-time * 280)));
  }
}

function softClicks(data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]): void {
  for (let onset = .25; onset < data.length / rate; onset += .55 + random() * .65) {
    const pitch = 780 + random() * 600, strength = .17 + random() * .14;
    for (const [delay, gain] of [[0, 1], [.012 + random() * .013, .35]]) {
      pulse(data, rate, onset + delay, .055, time => (1 - Math.exp(-time * 5000)) * strength * gain
        * (Math.sin(TAU * pitch * time - 60 * time * time) * Math.exp(-time * 170)
          + Math.sin(TAU * pitch * .43 * time) * .45 * Math.exp(-time * 95)
          + (random() * 2 - 1) * .12 * Math.exp(-time * 450)), events);
    }
  }
}

const textures: Record<string, (data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]) => void> = {
  'fingertip-taps': fingertips, keyboard, comb, fabric, 'rain-stick': rainStick, 'soft-clicks': softClicks,
};

export function fillAsmrTexture(sound: string, data: Float32Array, rate: number, random: Random, events?: AsmrMarkerEvent[]): boolean {
  const fill = Object.hasOwn(textures, sound) ? textures[sound] : undefined;
  if (!fill) return false;
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('The ASMR sample rate must be positive.');
  data.fill(0);
  fill(data, rate, random, events);
  return true;
}
