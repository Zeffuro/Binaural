import type { BwgSegment } from '../import/bwg-format';
import type { BoundBackground } from '../background-assets';
import { evaluateCurve } from './bwg-curves';
import { bwgGain, modulatedVolume } from './bwg-gain';

const TAU = Math.PI * 2;
const modulo = (value: number, size: number): number => ((value % size) + size) % size;

export class BwgBackground {
  private counters = [0, 0];
  private phases = [TAU * 0.75, TAU * 0.75];
  private length: number;
  private output = [0, 0];

  constructor(private binding: BoundBackground, private rate: number) {
    this.length = Math.ceil(binding.sample.channels[0].length * rate / binding.sample.rate);
  }

  render(segment: BwgSegment, position: number): number[] {
    const value = (index: number): number => evaluateCurve(segment, index, position);
    const shift = Math.trunc(Math.trunc(value(4) / 100) * this.rate / 1000);
    const phase = Math.trunc(value(13) / 100) * Math.PI / 180;
    for (let ear = 0; ear < 2; ear++) {
      const interval = this.binding.interval ? Math.round(value(2 + ear) / 100 * this.rate) : 0;
      const cycle = Math.max(this.length, interval);
      const index = ear ? modulo(this.counters[ear] + shift, cycle) : this.counters[ear];
      let sample = 0;
      if (index < this.length) {
        const samples = this.binding.sample.channels[ear] ?? this.binding.sample.channels[0];
        const source = index * this.binding.sample.rate / this.rate;
        const first = Math.floor(source), fraction = source - first;
        const next = first + 1 < samples.length ? samples[first + 1] : this.binding.interval ? 0 : samples[0];
        sample = samples[first] + (next - samples[first]) * fraction;
      }
      const depth = value(9 + ear), period = value(11 + ear) / 1000;
      this.output[ear] = sample * bwgGain(modulatedVolume(value(ear), depth, this.phases[ear] + (ear ? phase : 0)));
      if (depth > 0 && period > 0) this.phases[ear] = (this.phases[ear] + TAU * 1000 / period / this.rate) % TAU;
      this.counters[ear]++;
      // Native interval playback includes the endpoint; continuous loops reset at it.
      if (this.binding.interval ? this.counters[ear] > cycle : this.counters[ear] >= this.length) this.counters[ear] = 0;
    }
    return this.output;
  }
}
