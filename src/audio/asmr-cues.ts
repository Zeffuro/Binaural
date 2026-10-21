import type { AsmrSound } from '../asmr-state';

export type AsmrCueKind = 'follow' | 'brush' | 'tap' | 'trace' | 'inspect' | 'ear' | 'drop';
export interface AsmrCue {
  id: string;
  kind: AsmrCueKind;
  pan: number;
  strength: number;
  progress: number;
  contact: number;
  time: number;
}

const families: Record<AsmrSound, AsmrCueKind> = {
  brush: 'brush', wood: 'tap', glass: 'tap', paper: 'inspect', scratch: 'trace', air: 'follow',
  water: 'drop', chimes: 'inspect', cupping: 'ear', 'fingertip-taps': 'tap', keyboard: 'tap',
  comb: 'brush', fabric: 'brush', 'rain-stick': 'drop', 'soft-clicks': 'tap',
  'recorded-hands': 'brush', 'recorded-crinkles': 'inspect', 'recorded-metal': 'tap',
  'recorded-cloth': 'brush', 'recorded-grass': 'brush', 'recorded-pages': 'inspect',
  'recorded-hair': 'brush', 'recorded-spray': 'follow', 'recorded-writing': 'trace',
};
export const asmrCueKind = (sound: AsmrSound): AsmrCueKind => families[sound];
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function earRms(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) if (Number.isFinite(sample)) energy += sample * sample;
  return samples.length ? Math.sqrt(energy / samples.length) : 0;
}

// These cues follow measured envelopes; they do not reconstruct authored source events.
export class AsmrCueDetector {
  private lastTime?: number;
  private lastOnset = -Infinity;
  private baseline = 0;
  private previous = 0;
  private strength = 0;
  private progress = 0;
  private contact = 0;
  private lastHeard = -Infinity;
  private pan = 0;
  readonly kind: AsmrCueKind;

  constructor(private id: string, sound: AsmrSound) { this.kind = asmrCueKind(sound); }

  reset(): void {
    this.lastTime = undefined; this.lastOnset = this.lastHeard = -Infinity;
    this.baseline = this.previous = this.strength = this.progress = this.contact = this.pan = 0;
  }

  read(time: number, left: number, right: number): AsmrCue | undefined {
    if (!Number.isFinite(time) || !Number.isFinite(left) || !Number.isFinite(right)) { this.reset(); return; }
    if (this.lastTime !== undefined && (time < this.lastTime || time - this.lastTime > .75)) this.reset();
    const dt = this.lastTime === undefined ? 1 / 60 : clamp(time - this.lastTime, 0, .1);
    this.lastTime = time;
    left = clamp(left); right = clamp(right);
    const level = Math.sqrt((left * left + right * right) / 2), audible = level > .00008;
    const transient = this.kind === 'tap' || this.kind === 'drop';
    const onset = audible && time - this.lastOnset >= (transient ? .5 : .85) &&
      (this.lastHeard === -Infinity || level > Math.max(.00015, this.baseline * 1.7, this.previous * 1.12));
    this.contact *= Math.exp(-dt / (transient ? .16 : .45));
    if (onset) {
      this.lastOnset = time; this.progress = 0;
      this.contact = clamp(1 - Math.exp(-level * 35), .12, .85);
    }
    this.baseline += (level - this.baseline) * (1 - Math.exp(-dt / .45));
    this.previous = level;
    if (audible) {
      this.lastHeard = time;
      const measuredPan = (right * right - left * left) / (right * right + left * left);
      this.pan += (clamp(measuredPan, -1, 1) - this.pan) * (1 - Math.exp(-dt / .09));
    }
    const target = audible ? 1 - Math.exp(-level * 18) : 0;
    this.strength += (target - this.strength) * (1 - Math.exp(-dt / (target > this.strength ? .04 : .18)));
    if (transient) this.progress = clamp((time - this.lastOnset) / .65);
    else if (audible) this.progress = (this.progress + dt / (3.8 - this.strength)) % 1;
    if (time - this.lastHeard > .35 || this.strength < .0005 || (transient && time - this.lastOnset > .65)) return;
    return { id: this.id, kind: this.kind, pan: this.pan, strength: clamp(this.strength),
      progress: this.progress, contact: this.contact, time };
  }
}
