import { parseAsmrSpatial, spatialTrajectory, type AsmrSpatialSettings } from '../asmr-spatial';
import { hold, smooth } from './graph';
import { phaseCycles, setSinePhase } from './render-timing';
import { preparedHrtfPack } from './hrtf-audio';
import type { HrtfPack } from './hrtf-pack';
import type { HrtfProfile } from '../hrtf-profiles';

export class AsmrPosition {
  private mono: GainNode;
  private panner: PannerNode;
  private output: GainNode;
  private nativeGain: GainNode;
  private customGain?: GainNode;
  private custom?: AudioWorkletNode;
  private profile?: HrtfProfile;
  private profilePending = false;
  private queuedPack?: HrtfPack;
  private sine: OscillatorNode;
  private cosine: OscillatorNode;
  private harmonic: OscillatorNode;
  private matrix: GainNode[];
  private disposed = false;
  get outputNode(): AudioNode { return this.output; }

  constructor(private context: BaseAudioContext, private input: AudioNode, output: AudioNode,
    settings: AsmrSpatialSettings, period: number, private endAt?: number, offsetSeconds = 0, private onFailure?: () => void) {
    settings = parseAsmrSpatial(settings);
    this.checkPeriod(period);
    if (settings.profile) preparedHrtfPack(context, settings.profile);
    this.mono = context.createGain();
    this.mono.channelCount = 1; this.mono.channelCountMode = 'explicit'; this.mono.channelInterpretation = 'speakers';
    this.panner = context.createPanner(); this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse'; this.panner.refDistance = .15;
    this.panner.maxDistance = 3; this.panner.rolloffFactor = .2;
    this.panner.coneInnerAngle = this.panner.coneOuterAngle = 360; this.panner.coneOuterGain = 1;
    this.output = context.createGain(); this.nativeGain = context.createGain();
    this.panner.connect(this.nativeGain).connect(this.output).connect(output);
    this.sine = context.createOscillator(); this.cosine = context.createOscillator(); this.harmonic = context.createOscillator();
    // Custom profiles use one oscillator algorithm at full and section origins.
    if (offsetSeconds > 0 || settings.profile) {
      setSinePhase(context, this.sine, phaseCycles(1 / period, offsetSeconds));
      setSinePhase(context, this.cosine, phaseCycles(1 / period, offsetSeconds) + .25);
      setSinePhase(context, this.harmonic, phaseCycles(2 / period, offsetSeconds));
    } else this.cosine.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array(2), { disableNormalization: true }));
    this.matrix = Array.from({ length: 9 }, () => context.createGain());
    [this.panner.positionX, this.panner.positionY, this.panner.positionZ].forEach((parameter, axis) => {
      [this.sine, this.cosine, this.harmonic].forEach((oscillator, component) => oscillator.connect(this.matrix[axis * 3 + component]).connect(parameter));
    });
    if (settings.profile) {
      this.createCustom(settings.profile);
      this.nativeGain.gain.value = 0; this.customGain!.gain.value = 1;
    }
    this.configure(settings, period, true);
    input.connect(this.mono).connect(this.panner);
    const startAt = context.currentTime;
    for (const oscillator of [this.sine, this.cosine, this.harmonic]) {
      oscillator.start(startAt);
      if (endAt !== undefined) oscillator.stop(Math.max(context.currentTime, endAt));
    }
  }

  private createCustom(profile: HrtfProfile): void {
    const pack = preparedHrtfPack(this.context, profile);
    const node = new AudioWorkletNode(this.context, 'asmr-hrtf', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { pack, stopFrame: this.endAt === undefined ? undefined : Math.ceil(this.endAt * this.context.sampleRate) },
    });
    this.custom = node; this.profile = profile;
    this.customGain = this.context.createGain(); this.customGain.gain.value = 0;
    this.mono.connect(node).connect(this.customGain).connect(this.output);
    ['positionX', 'positionY', 'positionZ'].forEach((name, axis) => {
      node.parameters.get(name)!.value = [this.panner.positionX, this.panner.positionY, this.panner.positionZ][axis].value;
      for (let component = 0; component < 3; component++) this.matrix[axis * 3 + component].connect(node.parameters.get(name)!);
    });
    node.port.onmessage = event => {
      if (!event.data.profileApplied || this.disposed) return;
      this.profilePending = false;
      if (this.queuedPack) { const pack = this.queuedPack; this.queuedPack = undefined; this.sendProfile(pack); }
    };
    node.onprocessorerror = () => {
      if (this.disposed) return;
      this.output.gain.cancelScheduledValues(this.context.currentTime); this.output.gain.value = 0;
      this.dispose(); this.onFailure?.();
    };
  }

  private sendProfile(pack: HrtfPack): void {
    if (this.profilePending) { this.queuedPack = pack; return; }
    this.profilePending = true;
    this.custom!.port.postMessage({ pack });
  }

  private selectProfile(profile: HrtfProfile | undefined): void {
    let warmup = 0;
    if (profile) {
      const pack = preparedHrtfPack(this.context, profile);
      if (!this.custom) { this.createCustom(profile); warmup = pack.taps / this.context.sampleRate; }
      else if (profile !== this.profile) { this.sendProfile(pack); this.profile = profile; }
    }
    if (!this.customGain) return;
    const now = this.context.currentTime, at = now + warmup;
    for (const [gain, value] of [[this.nativeGain.gain, profile ? 0 : 1], [this.customGain.gain, profile ? 1 : 0]] as const) {
      hold(gain, now); gain.setValueAtTime(gain.value, at); gain.linearRampToValueAtTime(value, at + .06);
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
      if (this.custom) set(this.custom.parameters.get(['positionX', 'positionY', 'positionZ'][axis])!, path.center[key]);
      [path.sine, path.cosine, path.harmonic].forEach((coefficient, component) => set(this.matrix[axis * 3 + component].gain, coefficient[key]));
    });
    for (const oscillator of [this.sine, this.cosine]) set(oscillator.frequency, 1 / period);
    set(this.harmonic.frequency, 2 / period);
  }

  update(settings: AsmrSpatialSettings, period: number): void {
    if (this.disposed || (this.endAt !== undefined && this.context.currentTime >= this.endAt)) return;
    settings = parseAsmrSpatial(settings); this.checkPeriod(period);
    this.selectProfile(settings.profile);
    this.configure(settings, period);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const oscillator of [this.sine, this.cosine, this.harmonic]) oscillator.stop();
    this.input.disconnect(this.mono);
    if (this.custom) {
      this.custom.onprocessorerror = null; this.custom.port.onmessage = null;
      this.custom.port.postMessage({ stop: true }); this.custom.port.close(); this.custom.disconnect();
    }
    this.queuedPack = undefined; this.customGain?.disconnect();
    for (const node of [this.mono, this.panner, this.output, this.nativeGain, this.sine, this.cosine, this.harmonic, ...this.matrix]) node.disconnect();
  }
}
