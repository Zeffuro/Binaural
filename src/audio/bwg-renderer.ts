import type { BwgPreset, BwgSegment } from '../import/bwg-format';
import { bwgContinues } from '../import/bwg-program';
import { bwgGain, modulatedVolume } from './bwg-gain';
export { bwgGain, modulatedVolume } from './bwg-gain';
import { BwgWaveBank } from './bwg-wave';
import { evaluateCurve, segmentAt, validateCurves } from './bwg-curves';
import type { BoundBackground } from '../background-assets';
import { BwgBackground } from './bwg-background';

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

class NativeNoise {
  private seed = 1;
  private previous = 0;
  next(smoothness: number): number {
    const m = Math.trunc(Math.trunc(clamp(smoothness, 0, 10000) / 100) * 128 / 100);
    if (m === 128) { this.previous = 0; return 0; }
    const denominator = Math.max(1, ((16384 - m * (m + 128)) * m + 2097152) >>> 7);
    const coefficient = ((16384 - m * m) ** 2) >>> 14;
    this.seed = (Math.imul(this.seed, 0x15a4e35) + 1) >>> 0;
    const z = (((Math.imul(m, this.previous) >>> 7) << 16) + Math.imul(this.seed >>> 16, coefficient)) >>> 0;
    this.previous = Math.trunc((z | 0) / 65536);
    return (Math.trunc(z / denominator) - 32768) / 32768;
  }
  constructor(seed: number) { this.seed = seed; }
}

interface VoiceState { carrier: number[]; modulation: number[] }

export class BwgRenderer {
  private frames = 0;
  private waves = new BwgWaveBank();
  private states: VoiceState[];
  private noise = [new NativeNoise(1), new NativeNoise(719)];
  private noisePhase = [TAU * 0.75, TAU * 0.75];
  private background?: BwgBackground;
  backgroundGain = 1;
  private currentBackgroundGain = 1;
  private backgroundSmoothing: number;
  levels: number[];
  readonly continues: boolean;

  constructor(readonly preset: BwgPreset, readonly rate: number, background?: BoundBackground) {
    this.backgroundSmoothing = 1 - Math.exp(-1 / (.035 * rate));
    validateCurves(preset);
    const count = Math.max(...preset.segments.map(segment => segment.voices));
    this.states = Array.from({ length: count }, () => ({ carrier: [0, 0], modulation: [TAU * 0.75, TAU * 0.75] }));
    this.levels = Array(count).fill(1);
    this.continues = bwgContinues(preset);
    if (background) this.background = new BwgBackground(background, rate);
    for (const segment of preset.segments) {
      for (let voice = 0; voice < segment.voices; voice++) {
        for (let ear = 0; ear < 2; ear++) {
          const offset = 36 + voice * 14;
          this.waves.sample(0, evaluateCurve(segment, offset + 5 + ear, 0), evaluateCurve(segment, offset + 7 + ear, 0));
        }
      }
    }
  }

  render(left: Float32Array, right: Float32Array): boolean {
    let alive = true;
    for (let frame = 0; frame < left.length; frame++, this.frames++) {
      const cursor = segmentAt(this.preset, this.frames / this.rate);
      if (cursor.ended && !this.continues) { alive = false; left[frame] = right[frame] = 0; continue; }
      const { segment, position } = cursor;
      let l = 0, r = 0;
      for (let voice = 0; voice < segment.voices; voice++) {
        const offset = 36 + voice * 14;
        const state = this.states[voice];
        const value = (index: number): number => evaluateCurve(segment, offset + index, position);
        const pitch = value(1) / 100;
        const beat = value(0) / 1000;
        const separate = segment.curves[offset + 1].channelMode !== 0;
        const frequencies = [pitch + (separate ? 0 : beat / 2), separate ? value(2) / 100 : pitch - beat / 2];
        const phase = Math.trunc(value(13) / 100) * Math.PI / 180;
        for (let ear = 0; ear < 2; ear++) {
          const hz = clamp(frequencies[ear], 0, this.rate * 0.49);
          const depth = value(9 + ear);
          const volume = modulatedVolume(value(3 + ear), depth, state.modulation[ear] + (ear ? phase : 0));
          const signal = this.waves.sample(state.carrier[ear], value(5 + ear), value(7 + ear)) * bwgGain(volume) * (this.levels[voice] ?? 1) * 0.22 / this.states.length;
          if (ear) r += signal; else l += signal;
          state.carrier[ear] = (state.carrier[ear] + TAU * hz / this.rate) % TAU;
          const period = value(11 + ear) / 1000;
          if (depth > 0 && period > 0) state.modulation[ear] = (state.modulation[ear] + TAU * 1000 / period / this.rate) % TAU;
        }
      }
      const noise = this.renderNoise(segment, position);
      const background = this.background?.render(segment, position);
      this.currentBackgroundGain += (this.backgroundGain - this.currentBackgroundGain) * this.backgroundSmoothing;
      left[frame] = l + noise[0] * this.currentBackgroundGain + (background?.[0] ?? 0) * 0.22 / this.states.length * this.currentBackgroundGain;
      right[frame] = r + noise[1] * this.currentBackgroundGain + (background?.[1] ?? 0) * 0.22 / this.states.length * this.currentBackgroundGain;
    }
    return alive;
  }

  private renderNoise(segment: BwgSegment, position: number): number[] {
    const value = (index: number): number => evaluateCurve(segment, index, position);
    const phase = Math.trunc(value(34) / 100) * Math.PI / 180;
    const inside = segment.settings[12] !== 0 && segment.curves[7].channelMode === 0;
    const first = this.noise[0].next(value(7));
    return [0, 1].map(ear => {
      const depth = value(30 + ear);
      const gain = bwgGain(modulatedVolume(value(5 + ear), depth, this.noisePhase[ear] + (ear ? phase : 0)));
      const period = value(32 + ear) / 1000;
      if (depth > 0 && period > 0) this.noisePhase[ear] = (this.noisePhase[ear] + TAU * 1000 / period / this.rate) % TAU;
      const sample = ear ? inside ? -first : this.noise[1].next(value(8)) : first;
      return sample * gain * 0.22 / this.states.length;
    });
  }
}
