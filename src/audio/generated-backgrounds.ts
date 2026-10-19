import type { AudioSample } from '../import/wave';

export const generatedBackgrounds = [
  { id: 'night', name: 'Night insects', group: 'Nature', seconds: 8, interval: false },
  { id: 'brook', name: 'Babbling brook', group: 'Water', seconds: 8, interval: false },
  { id: 'rain', name: 'Rain', group: 'Water', seconds: 8, interval: false },
  { id: 'seagulls', name: 'Seagulls', group: 'Animals', seconds: 9, interval: false },
  { id: 'thunder', name: 'Distant thunder', group: 'Nature', seconds: 6, interval: true },
  { id: 'cow', name: 'Cow', group: 'Animals', seconds: 4, interval: true },
  { id: 'wind', name: 'Wind', group: 'Nature', seconds: 9, interval: false },
  { id: 'river', name: 'River', group: 'Water', seconds: 8, interval: false },
  { id: 'traffic', name: 'Distant traffic', group: 'Places', seconds: 10, interval: false },
  { id: 'pigeons', name: 'Pigeons', group: 'Animals', seconds: 8, interval: false },
  { id: 'birds', name: 'Birdsong', group: 'Animals', seconds: 8, interval: false },
  { id: 'tropical-birds', name: 'Tropical birds', group: 'Animals', seconds: 10, interval: false },
  { id: 'horse', name: 'Horse hoofbeats', group: 'Animals', seconds: 8, interval: false },
  { id: 'wood', name: 'Wood knocks', group: 'Places', seconds: 3, interval: true },
  { id: 'explosions', name: 'Distant impacts', group: 'Places', seconds: 6, interval: true },
  { id: 'sheep', name: 'Sheep', group: 'Animals', seconds: 4, interval: true },
  { id: 'dog', name: 'Dog', group: 'Animals', seconds: 5, interval: true },
] as const;

export type GeneratedBackgroundId = typeof generatedBackgrounds[number]['id'];

const rate = 24000;
const tau = 2 * Math.PI;
const cache = new Map<GeneratedBackgroundId, Float32Array>();
type Random = () => number;

function randomFor(id: string): Random {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function bed(data: Float32Array, random: Random, gain: number, cutoff: number,
  modulation: (time: number) => number = () => 1, highpass = 0): void {
  const coefficient = 1 - Math.exp(-tau * cutoff / rate);
  const slowCoefficient = 1 - Math.exp(-tau * highpass / rate);
  let low = 0, slow = 0;
  for (let i = 0; i < data.length; i++) {
    low += coefficient * (2 * random() - 1 - low);
    slow += slowCoefficient * (low - slow);
    data[i] += gain * (low - slow) * modulation(i / rate);
  }
}

function event(data: Float32Array, start: number, duration: number, gain: number,
  voice: (time: number, position: number) => number, shape = 1): void {
  const first = Math.round(start * rate), count = Math.round(duration * rate);
  for (let i = 0; i < count && first + i < data.length; i++) {
    if (first + i < 0) continue;
    const position = i / (count - 1);
    data[first + i] += gain * Math.pow(Math.sin(Math.PI * position), shape) * voice(i / rate, position);
  }
}

function chirp(data: Float32Array, start: number, duration: number, gain: number,
  pitch: number, sweep: number, vibrato = 0, speed = 9): void {
  let phase = 0;
  event(data, start, duration, gain, (time, position) => {
    phase += tau * (pitch + sweep * position + vibrato * Math.sin(tau * speed * time)) / rate;
    return Math.sin(phase) + 0.13 * Math.sin(phase * 2);
  }, 1.4);
}

function burst(data: Float32Array, random: Random, start: number, duration: number,
  gain: number, cutoff: number, decay = 4, resonance = 0): void {
  const coefficient = 1 - Math.exp(-tau * cutoff / rate);
  let low = 0;
  event(data, start, duration, gain, (time, position) => {
    low += coefficient * (2 * random() - 1 - low);
    return (low + 0.22 * Math.sin(tau * resonance * time)) * Math.exp(-decay * position);
  }, 0.4);
}

function animal(data: Float32Array, start: number, duration: number, gain: number,
  pitch: number, sweep: number, formant: number, flutter = 0): void {
  const weights = Array.from({ length: 12 }, (_, index) => {
    const harmonic = index + 1, hz = harmonic * pitch;
    return (0.28 + Math.exp(-Math.pow((hz - formant) / 230, 2)) +
      0.6 * Math.exp(-Math.pow((hz - formant * 2.2) / 330, 2))) / harmonic;
  });
  let phase = 0;
  event(data, start, duration, gain, (time, position) => {
    phase += tau * (pitch + sweep * Math.sin(Math.PI * position) + 3 * Math.sin(tau * 5 * time)) / rate;
    let value = 0;
    for (let harmonic = 1; harmonic <= 12; harmonic++) {
      value += weights[harmonic - 1] * Math.sin(phase * harmonic);
    }
    return value * (1 - flutter * 0.5 + flutter * 0.5 * Math.sin(tau * 9 * time));
  }, 0.7);
}

function water(data: Float32Array, random: Random, river: boolean): void {
  bed(data, random, river ? 0.8 : 0.35, river ? 1500 : 2600,
    time => 0.8 + 0.12 * Math.sin(tau * time * 0.37) + 0.08 * Math.sin(tau * time * 1.7), 80);
  bed(data, random, river ? 0.35 : 0.1, 130);
  const seconds = data.length / rate;
  for (let start = 0.05; start < seconds; start += river ? 0.11 : 0.065) {
    const pitch = (river ? 280 : 650) + random() * (river ? 650 : 1900);
    chirp(data, start, 0.025 + random() * 0.08, river ? 0.12 : 0.17, pitch, -pitch * 0.45);
  }
}

function birds(data: Float32Array, random: Random, tropical: boolean): void {
  bed(data, random, 0.025, 1700, undefined, 250);
  const seconds = data.length / rate;
  for (let start = 0.3; start < seconds - 0.6; start += 0.65 + random() * 0.7) {
    const pitch = tropical ? 650 + random() * 1200 : 1900 + random() * 1600;
    const count = tropical ? 3 : 2 + Math.floor(random() * 3);
    for (let call = 0; call < count; call++) {
      chirp(data, start + call * 0.16, tropical ? 0.24 : 0.11, 0.2 + random() * 0.12,
        pitch + call * 100, tropical ? 650 : -600, tropical ? 180 : 55, tropical ? 18 : 28);
    }
  }
}

function compose(id: GeneratedBackgroundId, data: Float32Array, random: Random): void {
  const seconds = data.length / rate;
  switch (id) {
    case 'night':
      bed(data, random, 0.035, 700);
      for (let start = 0.1; start < seconds; start += 0.43) {
        event(data, start, 0.29, 0.2, time => Math.sin(tau * 3700 * time) *
          Math.pow(0.5 + 0.5 * Math.sin(tau * 35 * time), 3));
      }
      animal(data, 3.7, 0.75, 0.12, 320, -25, 500);
      break;
    case 'brook': water(data, random, false); break;
    case 'river': water(data, random, true); break;
    case 'rain':
      bed(data, random, 0.65, 7200, time => 0.9 + 0.1 * Math.sin(tau * time / 7), 180);
      bed(data, random, 0.2, 700);
      for (let start = 0; start < seconds; start += 0.037 + random() * 0.065) {
        burst(data, random, start, 0.035, 0.12, 4700, 6);
      }
      break;
    case 'wind':
      bed(data, random, 1.4, 340, time => 0.5 + 0.22 * Math.sin(tau * time / 5.7) +
        0.16 * Math.sin(tau * time / 2.9), 35);
      bed(data, random, 0.07, 2100, time => 0.5 + 0.4 * Math.sin(tau * time / 4.3));
      break;
    case 'seagulls':
      bed(data, random, 0.05, 1200);
      for (const start of [0.6, 2.3, 4.8, 6.3, 7.4]) {
        chirp(data, start, 0.7, 0.3, 950, -510, 65, 13);
        chirp(data, start + 0.7, 0.3, 0.14, 760, -230, 35, 18);
      }
      break;
    case 'thunder':
      bed(data, random, 3.2, 130, time => Math.pow(Math.sin(Math.PI * time / seconds), 0.7) *
        Math.exp(-time * 0.5) * (0.8 + 0.2 * Math.sin(tau * time * 2.7)));
      burst(data, random, 0.2, 1.5, 0.45, 550, 4);
      break;
    case 'cow':
      animal(data, 0.2, 2.9, 0.5, 95, 32, 480);
      break;
    case 'traffic':
      bed(data, random, 0.8, 240, time => 0.65 + 0.15 * Math.sin(tau * time / 8), 30);
      for (const start of [-0.8, 3.5, 7]) {
        let phase = 0;
        event(data, start, 4, 0.17, (_time, position) => {
          phase += tau * (135 - position * 65) / rate;
          return Math.sin(phase) + 0.22 * Math.sin(phase * 3);
        }, 2);
      }
      bed(data, random, 0.1, 1800, time => 0.5 + 0.3 * Math.sin(tau * time / 4.1), 350);
      break;
    case 'pigeons':
      bed(data, random, 0.025, 700);
      for (const start of [0.4, 2.8, 5.2, 7]) {
        animal(data, start, 0.4, 0.28, 340, -30, 650);
        animal(data, start + 0.47, 0.7, 0.35, 300, 22, 610, 0.15);
      }
      break;
    case 'birds': birds(data, random, false); break;
    case 'tropical-birds': birds(data, random, true); break;
    case 'horse':
      bed(data, random, 0.025, 650);
      for (let start = 0.1; start < seconds; start += 0.65) {
        for (const [offset, gain, pitch] of [[0, 0.8, 95], [0.13, 0.55, 140], [0.34, 0.7, 115]]) {
          burst(data, random, start + offset, 0.15, gain, 850, 5, pitch);
        }
      }
      break;
    case 'wood':
      for (const [start, gain] of [[0.15, 0.7], [0.62, 0.45], [1.25, 0.6], [1.52, 0.4], [2.2, 0.6]]) {
        burst(data, random, start, 0.2, gain, 2300, 7, 610);
        event(data, start, 0.22, gain * 0.2, time => Math.exp(-28 * time) *
          (Math.sin(tau * 470 * time) + 0.5 * Math.sin(tau * 1130 * time)), 0.4);
      }
      break;
    case 'explosions':
      burst(data, random, 0.2, 4.8, 3, 190, 4, 46);
      burst(data, random, 0.22, 0.7, 0.4, 750, 6);
      burst(data, random, 1.9, 3.5, 0.7, 120, 4, 36);
      break;
    case 'sheep':
      animal(data, 0.2, 1.3, 0.45, 175, 45, 950, 0.8);
      animal(data, 2.1, 1.1, 0.4, 195, 25, 1050, 0.8);
      break;
    case 'dog':
      for (const start of [0.2, 0.8, 1.6]) {
        animal(data, start, 0.32, 0.5, 155, -45, 670, 0.2);
        burst(data, random, start, 0.13, 0.2, 1700, 5);
      }
      animal(data, 2.5, 1.9, 0.26, 310, 85, 850, 0.1);
      break;
  }
}

function finish(data: Float32Array, frames: number, interval: boolean): Float32Array {
  const fade = Math.round(rate * 0.12);
  const output = data.slice(0, frames);
  if (!interval) {
    // The extra tail becomes the loop start, preserving noise continuity at wrap.
    for (let i = 0; i < fade; i++) {
      const blend = 0.5 - 0.5 * Math.cos(Math.PI * i / (fade - 1));
      output[i] = data[frames + i] * (1 - blend) + data[i] * blend;
    }
  }
  let mean = 0;
  for (const value of output) mean += value / frames;
  let square = 0, peak = 0;
  for (let i = 0; i < frames; i++) {
    let value = output[i] - mean;
    if (interval) {
      const edge = Math.min(i, frames - 1 - i) / fade;
      value *= edge < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * edge) : 1;
    }
    output[i] = value;
    peak = Math.max(peak, Math.abs(value));
    square += value * value;
  }
  const gain = Math.min(0.11 / Math.sqrt(square / frames), 0.65 / peak);
  for (let i = 0; i < frames; i++) output[i] *= gain;
  return output;
}

export function makeGeneratedBackground(id: GeneratedBackgroundId): AudioSample {
  let pcm = cache.get(id);
  if (!pcm) {
    const entry = generatedBackgrounds.find(item => item.id === id);
    if (!entry) throw new Error(`Unknown generated background: ${id}`);
    const frames = entry.seconds * rate;
    const data = new Float32Array(frames + (entry.interval ? 0 : Math.round(rate * 0.12)));
    compose(id, data, randomFor(id));
    pcm = finish(data, frames, entry.interval);
    cache.set(id, pcm);
  }
  // Consumers own their PCM; worklet transfers and edits cannot corrupt the cache.
  return { rate, channels: [pcm.slice()] };
}
