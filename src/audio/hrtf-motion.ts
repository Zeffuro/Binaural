export interface HrtfMotionState {
  phase: number;
  time: number;
  from: number;
  target: number;
}

const tau = .035;
export function motionPhase(state: HrtfMotionState, time: number): number {
  const elapsed = Math.max(0, time - state.time);
  const cycles = state.phase + state.target * elapsed + (state.from - state.target) * tau * (1 - Math.exp(-elapsed / tau));
  return ((cycles % 1) + 1) % 1;
}

export class HrtfMotionClock {
  private state: HrtfMotionState;
  constructor(period: number, offset: number, time: number) {
    const frequency = Math.fround(1 / period);
    this.state = { phase: ((frequency * offset % 1) + 1) % 1, time, from: frequency, target: frequency };
  }
  frequency(time: number): number {
    return this.state.target + (this.state.from - this.state.target) * Math.exp(-Math.max(0, time - this.state.time) / tau);
  }
  update(period: number, time: number): void {
    const target = Math.fround(1 / period);
    if (target === this.state.target) return;
    this.state = { phase: motionPhase(this.state, time), time, from: this.frequency(time), target };
  }
  snapshot(): HrtfMotionState { return { ...this.state }; }
}

export class HrtfMotionRenderer {
  private phase?: number;
  constructor(private state: HrtfMotionState, private originFrame: number) {}
  render(output: Float32Array[], frequency: Float32Array, frame: number, rate: number): void {
    for (let sample = 0; sample < output[0].length; sample++) {
      if (frame + sample < this.originFrame) { output[0][sample] = output[1][sample] = output[2][sample] = 0; continue; }
      // Seed from the audio frame even when realtime construction arrives late.
      this.phase ??= motionPhase(this.state, (frame + sample) / rate);
      const angle = 2 * Math.PI * this.phase;
      output[0][sample] = Math.sin(angle); output[1][sample] = Math.cos(angle); output[2][sample] = Math.sin(2 * angle);
      this.phase += frequency[frequency.length === 1 ? 0 : sample] / rate;
      if (this.phase >= 1) this.phase -= 1;
    }
  }
}
