import { defaultAsmrSpace, type AsmrSpaceSettings } from '../asmr-space';
import { smooth } from './graph';

const arrivals = [.011, .023, .037];
const weights = [.5, .3, .2];

export class AsmrSpace {
  private bank?: { direct: GainNode; wet: GainNode; damping: BiquadFilterNode; delays: DelayNode[]; taps: GainNode[] };
  private settings = defaultAsmrSpace();
  private disposed = false;

  constructor(private context: BaseAudioContext, private input: AudioNode, private output: AudioNode) {
    input.connect(output);
  }

  update(settings: AsmrSpaceSettings = defaultAsmrSpace()): void {
    if (this.disposed) return;
    const cutoff = Math.min(this.context.sampleRate * .2, 8000 * (1000 / 8000) ** settings.warmth);
    const creating = !this.bank && settings.amount > 0;
    if (!this.bank && settings.amount > 0) {
      const direct = this.context.createGain(), wet = this.context.createGain(), damping = this.context.createBiquadFilter();
      direct.gain.value = 1; wet.gain.value = 0;
      // Lowpass Q is in dB; critical damping and this cutoff cap keep its impulse nonnegative.
      damping.type = 'lowpass'; damping.Q.value = 20 * Math.log10(.5);
      damping.frequency.value = cutoff;
      const delays = arrivals.map(arrival => {
        const delay = this.context.createDelay(.06);
        delay.delayTime.value = arrival * settings.size;
        return delay;
      });
      const taps = weights.map(weight => {
        const tap = this.context.createGain(); tap.gain.value = weight; return tap;
      });
      this.input.disconnect(this.output);
      this.input.connect(direct).connect(this.output);
      delays.forEach((delay, index) => this.input.connect(delay).connect(taps[index]).connect(damping));
      damping.connect(wet).connect(this.output);
      this.bank = { direct, wet, damping, delays, taps };
    }
    if (this.bank) {
      // Tick-zero ramps can lose their explicit start value when Firefox first activates a silent node.
      const time = Math.max(this.context.currentTime, 1 / this.context.sampleRate), { direct, wet, damping, delays } = this.bank;
      if (settings.amount !== this.settings.amount) {
        smooth(direct.gain, 1 - settings.amount, time);
        smooth(wet.gain, settings.amount, time);
      }
      if (!creating && settings.warmth !== this.settings.warmth) smooth(damping.frequency, cutoff, time);
      if (!creating && settings.size !== this.settings.size) delays.forEach((delay, index) => smooth(delay.delayTime, arrivals[index] * settings.size, time));
    }
    this.settings = { ...settings };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.bank) this.input.disconnect(this.output);
    else {
      this.input.disconnect(this.bank.direct);
      for (const delay of this.bank.delays) this.input.disconnect(delay);
      for (const node of [this.bank.direct, this.bank.wet, this.bank.damping, ...this.bank.delays, ...this.bank.taps]) node.disconnect();
      this.bank = undefined;
    }
  }
}
