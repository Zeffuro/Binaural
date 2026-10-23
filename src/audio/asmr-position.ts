import { parseAsmrSpatial, spatialTrajectory, type AsmrSpatialSettings } from '../asmr-spatial';
import { smooth } from './graph';
import { phaseCycles, setSinePhase } from './render-timing';

export class AsmrPosition {
  private mono: GainNode;
  private panner: PannerNode;
  private sine: OscillatorNode;
  private cosine: OscillatorNode;
  private harmonic: OscillatorNode;
  private matrix: GainNode[];
  private disposed = false;
  get outputNode(): AudioNode { return this.panner; }

  constructor(private context: BaseAudioContext, private input: AudioNode, output: AudioNode,
    settings: AsmrSpatialSettings, period: number, private endAt?: number, offsetSeconds = 0) {
    settings = parseAsmrSpatial(settings);
    this.checkPeriod(period);
    this.mono = context.createGain();
    this.mono.channelCount = 1; this.mono.channelCountMode = 'explicit'; this.mono.channelInterpretation = 'speakers';
    this.panner = context.createPanner(); this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse'; this.panner.refDistance = .15;
    this.panner.maxDistance = 3; this.panner.rolloffFactor = .2;
    this.panner.coneInnerAngle = this.panner.coneOuterAngle = 360; this.panner.coneOuterGain = 1;
    this.sine = context.createOscillator(); this.cosine = context.createOscillator(); this.harmonic = context.createOscillator();
    if (offsetSeconds > 0) {
      setSinePhase(context, this.sine, phaseCycles(1 / period, offsetSeconds));
      setSinePhase(context, this.cosine, phaseCycles(1 / period, offsetSeconds) + .25);
      setSinePhase(context, this.harmonic, phaseCycles(2 / period, offsetSeconds));
    } else this.cosine.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array(2), { disableNormalization: true }));
    this.matrix = Array.from({ length: 9 }, () => context.createGain());
    [this.panner.positionX, this.panner.positionY, this.panner.positionZ].forEach((parameter, axis) => {
      [this.sine, this.cosine, this.harmonic].forEach((oscillator, component) => oscillator.connect(this.matrix[axis * 3 + component]).connect(parameter));
    });
    this.configure(settings, period, true);
    input.connect(this.mono).connect(this.panner).connect(output);
    const startAt = context.currentTime;
    for (const oscillator of [this.sine, this.cosine, this.harmonic]) {
      oscillator.start(startAt);
      if (endAt !== undefined) oscillator.stop(Math.max(context.currentTime, endAt));
    }
  }

  private checkPeriod(period: number): void {
    if (!Number.isFinite(period) || period < 2 || period > 60) throw new Error('Invalid ASMR spatial motion period.');
  }

  private configure(settings: AsmrSpatialSettings, period: number, initial = false): void {
    const path = spatialTrajectory(settings);
    const set = (param: AudioParam, value: number) => {
      if (initial) param.value = value;
      else smooth(param, value, this.context.currentTime);
    };
    // Shared phases keep motion continuous through position and trajectory edits.
    [this.panner.positionX, this.panner.positionY, this.panner.positionZ].forEach((parameter, axis) => {
      const key = (['x', 'y', 'z'] as const)[axis]; set(parameter, path.center[key]);
      [path.sine, path.cosine, path.harmonic].forEach((coefficient, component) => set(this.matrix[axis * 3 + component].gain, coefficient[key]));
    });
    for (const oscillator of [this.sine, this.cosine]) set(oscillator.frequency, 1 / period);
    set(this.harmonic.frequency, 2 / period);
  }

  update(settings: AsmrSpatialSettings, period: number): void {
    if (this.disposed || (this.endAt !== undefined && this.context.currentTime >= this.endAt)) return;
    settings = parseAsmrSpatial(settings); this.checkPeriod(period);
    this.configure(settings, period);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const oscillator of [this.sine, this.cosine, this.harmonic]) oscillator.stop();
    this.input.disconnect(this.mono);
    for (const node of [this.mono, this.panner, this.sine, this.cosine, this.harmonic, ...this.matrix]) node.disconnect();
  }
}
