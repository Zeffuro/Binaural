import { generatedAsmrSounds, type AsmrSound } from '../asmr-state';
import { fillAsmrTexture } from './asmr-textures';
import type { AsmrMarkerEvent } from './asmr-markers';

export const ASMR_RATE = 24000;
export const ASMR_SECONDS = 12;
export interface AsmrGeneratedSample { samples: Float32Array; events?: AsmrMarkerEvent[] }
const cache = new Map<AsmrSound, AsmrGeneratedSample>();
const variants = new Map<string, AsmrGeneratedSample>();
const VARIANT_CACHE_BYTES = 6 * 1024 * 1024;

function fillOriginalTexture(sound: AsmrSound, data: Float32Array, random: () => number, events?: AsmrMarkerEvent[]): void {
  const noise = new Float32Array(data.length);
  let low = 0;
  for (let i = 0; i < noise.length; i++) {
    low += ((random() * 2 - 1) - low) * .16;
    noise[i] = low;
  }
  if (['brush', 'air', 'scratch', 'cupping'].includes(sound)) {
    let previous = 0;
    let warm = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / ASMR_RATE;
      const stroke = (.5 + .5 * Math.sin(t * Math.PI * 2 * (sound === 'air' ? .25 : .5))) ** 2;
      const detail = noise[i] - previous; previous = noise[i];
      warm += (noise[i] - warm) * .035;
      data[i] = (sound === 'scratch' ? detail * 2.5 : sound === 'cupping' ? warm : noise[i]) * (sound === 'cupping' ? .7 + stroke * .3 : .18 + stroke * .82);
    }
  } else {
    const gap = { wood: .48, glass: .8, paper: .65, water: .7, chimes: 2.1 }[sound as 'wood' | 'glass' | 'paper' | 'water' | 'chimes'];
    for (let onset = .12; onset < ASMR_SECONDS; onset += gap * (.65 + random() * .7)) {
      const duration = sound === 'chimes' ? 1.8 : sound === 'paper' ? .45 : sound === 'water' ? .23 : .18;
      const frequency = (sound === 'wood' ? 220 : sound === 'glass' ? 1300 : sound === 'chimes' ? 560 : 760) * (.8 + random() * .4);
      const strength = .45 + random() * .45;
      events?.push({ start: Math.floor(onset * ASMR_RATE), length: Math.ceil(duration * ASMR_RATE) });
      for (let j = 0; j < duration * ASMR_RATE; j++) {
        const i = (Math.floor(onset * ASMR_RATE) + j) % data.length;
        const t = j / ASMR_RATE;
        const envelope = (1 - Math.exp(-t * 1400)) * Math.exp(-t * (sound === 'chimes' ? 3.5 : sound === 'paper' ? 11 : 32));
        let value: number;
        if (sound === 'paper') value = noise[i] * 2.4 * (.3 + .7 * Math.sin(t * 195) ** 6);
        else if (sound === 'water') value = Math.sin(2 * Math.PI * (frequency * t + 210 * t * t));
        else value = Math.sin(2 * Math.PI * frequency * t) * .7 + Math.sin(2 * Math.PI * frequency * 2.71 * t) * .2 + noise[i] * (sound === 'wood' ? .7 : .15);
        data[i] += value * envelope * strength;
      }
    }
  }
}

export function synthesizeAsmrSample(sound: AsmrSound, variant = 0, markers = true): AsmrGeneratedSample {
  if (!generatedAsmrSounds.some(item => item.id === sound)) throw new Error('Load the recorded ASMR sound before playing it.');
  const data = new Float32Array(ASMR_RATE * ASMR_SECONDS);
  let seed = [...sound].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0), 893);
  if (variant) seed ^= Math.imul(variant, 0x6d2b79f5);
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const events = markers && ['wood', 'glass', 'paper', 'water', 'chimes', 'fingertip-taps', 'keyboard', 'soft-clicks', 'comb'].includes(sound)
    ? [] as AsmrMarkerEvent[] : undefined;
  if (!fillAsmrTexture(sound, data, ASMR_RATE, random, events)) fillOriginalTexture(sound, data, random, events);
  let peak = .001;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const seam = ASMR_RATE * .02;
  for (let i = 0; i < data.length; i++) {
    const edge = Math.min(1, i / seam, (data.length - 1 - i) / seam);
    data[i] = data[i] / peak * .7 * Math.sin(edge * Math.PI / 2) ** 2;
  }
  events?.sort((left, right) => left.start - right.start);
  return { samples: data, events };
}

export function asmrSample(sound: AsmrSound): Float32Array {
  return asmrGeneratedSample(sound).samples;
}

export function asmrVariantSample(sound: AsmrSound, variant: 1 | 2): Float32Array {
  return asmrGeneratedSample(sound, variant).samples;
}

export function asmrGeneratedSample(sound: AsmrSound, variant: 0 | 1 | 2 = 0): AsmrGeneratedSample {
  if (!variant) {
    const existing = cache.get(sound); if (existing) return existing;
    const data = synthesizeAsmrSample(sound); cache.set(sound, data); return data;
  }
  const key = `${sound}:${variant}`, existing = variants.get(key);
  if (existing) { variants.delete(key); variants.set(key, existing); return existing; }
  const data = synthesizeAsmrSample(sound, variant), size = (item: AsmrGeneratedSample) => item.samples.byteLength + (item.events?.length ?? 0) * 16;
  let bytes = size(data);
  for (const item of variants.values()) bytes += size(item);
  while (bytes > VARIANT_CACHE_BYTES && variants.size) {
    const oldest = variants.keys().next().value!; bytes -= size(variants.get(oldest)!); variants.delete(oldest);
  }
  variants.set(key, data); return data;
}
