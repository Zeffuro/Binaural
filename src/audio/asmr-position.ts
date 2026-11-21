import { parseAsmrSpatial, spatialTrajectory, type AsmrSpatialSettings } from '../asmr-spatial';
import { hold, smooth } from './graph';
import { phaseCycles, setSinePhase } from './render-timing';
import { preparedHrtfPack } from './hrtf-audio';
import type { HrtfPack } from './hrtf-pack';
import type { HrtfProfile } from '../hrtf-profiles';
import { HrtfMotionClock, motionPhase } from './hrtf-motion';
import type { QuietClickBank } from './quiet-click-clips';

interface QuietClickInput { banks: readonly QuietClickBank[]; speed: number; destination: AudioNode }

const approachCurve = Float32Array.from({ length: 257 }, (_, index) => {
  // Depth increases on the return when the second harmonic's cosine is positive.
  const approach = Math.min(1, Math.max(0, (1 - index / 128) / .32));
  return approach ** 2 * (3 - 2 * approach);
});

export class AsmrPosition {
  private mono: GainNode;
  private panner: PannerNode;
  private output: GainNode;
  private nativeGain: GainNode;
  private customGain?: GainNode;
  private custom?: AudioWorkletNode;
  private customMotion?: AudioWorkletNode;
  private customSplitter?: ChannelSplitterNode;
  private customMatrix: GainNode[] = [];
  private motionClock!: HrtfMotionClock;
  private profile?: HrtfProfile;
  private profilePending = false;
  private queuedPack?: HrtfPack;
  private sine: OscillatorNode;
  private cosine: OscillatorNode;
  private harmonic: OscillatorNode;
  private adjustableMotion?: AudioWorkletNode;
  private adjustableSplitter?: ChannelSplitterNode;
  private adjustableSignature = '';
  private returnGate?: { clock: OscillatorNode; shape: WaveShaperNode; mix: GainNode };
  private quietReturn = false;
  private matrix: GainNode[];
  private disposed = false;
  get outputNode(): AudioNode { return this.output; }

  constructor(private context: BaseAudioContext, private input: AudioNode, output: AudioNode,
    settings: AsmrSpatialSettings, period: number, private endAt?: number, offsetSeconds = 0, private onFailure?: () => void,
    clicks?: QuietClickInput) {
    settings = parseAsmrSpatial(settings);
    this.checkPeriod(period);
    if (!!settings.quietReturn?.syncClicks !== !!clicks) throw new Error('Invalid quiet return click source.');
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
    if (offsetSeconds > 0) {
      setSinePhase(context, this.sine, phaseCycles(1 / period, offsetSeconds));
      setSinePhase(context, this.cosine, phaseCycles(1 / period, offsetSeconds) + .25);
      setSinePhase(context, this.harmonic, phaseCycles(2 / period, offsetSeconds));
    } else this.cosine.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array(2), { disableNormalization: true }));
    this.matrix = Array.from({ length: 9 }, () => {
      const coefficient = context.createGain();
      coefficient.gain.value = 0;
      return coefficient;
    });
    [this.panner.positionX, this.panner.positionY, this.panner.positionZ].forEach((parameter, axis) => {
      [this.sine, this.cosine, this.harmonic].forEach((oscillator, component) => oscillator.connect(this.matrix[axis * 3 + component]).connect(parameter));
    });
    if (!settings.quietReturn) this.configure(settings, period, true);
    input.connect(this.mono).connect(this.panner);
    const startAt = context.currentTime;
    this.motionClock = new HrtfMotionClock(period, offsetSeconds, startAt);
    if (settings.quietReturn) this.createAdjustable(settings, startAt, offsetSeconds, clicks);
    else this.configureReturn(settings.motion === 'quiet-return', period, startAt, true);
    if (settings.profile) {
      this.createCustom(settings.profile, startAt);
      this.nativeGain.gain.value = 0; this.customGain!.gain.value = 1;
      if (!this.adjustableMotion) this.configure(settings, period, true);
    }
    if (!this.adjustableMotion) for (const oscillator of [this.sine, this.cosine, this.harmonic]) {
      oscillator.start(startAt);
      if (endAt !== undefined) oscillator.stop(Math.max(context.currentTime, endAt));
    }
  }

  private connectAdjustable(parameters: AudioParam[]): void {
    parameters.forEach((parameter, axis) => {
      parameter.value = 0;
      this.adjustableSplitter!.connect(parameter, axis);
    });
  }

  private createAdjustable(settings: AsmrSpatialSettings, time: number, offset: number, clicks?: QuietClickInput): void {
    const node = new AudioWorkletNode(this.context, clicks ? 'asmr-quiet-click' : 'asmr-quiet-approach', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [4], channelInterpretation: 'discrete',
      processorOptions: { settings, originFrame: Math.round(time * this.context.sampleRate), offset,
        ...(clicks ? { banks: clicks.banks, speed: clicks.speed, skipPartial: !('length' in this.context) } : {}),
        stopFrame: this.endAt === undefined ? undefined : Math.ceil(this.endAt * this.context.sampleRate) },
    });
    this.adjustableMotion = node;
    this.adjustableSignature = JSON.stringify({ settings, speed: clicks?.speed });
    this.adjustableSplitter = this.context.createChannelSplitter(4);
    node.connect(this.adjustableSplitter);
    const parameters = [this.panner.positionX, this.panner.positionY, this.panner.positionZ];
    if (clicks) this.adjustableSplitter.connect(clicks.destination, 3);
    else parameters.push(this.mono.gain);
    this.connectAdjustable(parameters);
    node.onprocessorerror = () => this.fail();
  }

  private fail(): void {
    if (this.disposed) return;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.value = 0;
    this.dispose();
    this.onFailure?.();
  }

  private createCustom(profile: HrtfProfile, editTime: number): void {
    const pack = preparedHrtfPack(this.context, profile);
    const node = new AudioWorkletNode(this.context, 'asmr-hrtf', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { pack, stopFrame: this.endAt === undefined ? undefined : Math.ceil(this.endAt * this.context.sampleRate) },
    });
    this.custom = node; this.profile = profile;
    this.customGain = this.context.createGain(); this.customGain.gain.value = 0;
    this.mono.connect(node).connect(this.customGain).connect(this.output);
    if (this.adjustableMotion) {
      this.connectAdjustable(['positionX', 'positionY', 'positionZ'].map(name => node.parameters.get(name)!));
    } else {
      this.customMotion = new AudioWorkletNode(this.context, 'asmr-hrtf-motion', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [3], channelInterpretation: 'discrete',
        parameterData: { frequency: this.motionClock.frequency(editTime) },
        processorOptions: { state: this.motionClock.snapshot(), originFrame: Math.round(editTime * this.context.sampleRate),
          stopFrame: this.endAt === undefined ? undefined : Math.ceil(this.endAt * this.context.sampleRate) },
      });
      this.customSplitter = this.context.createChannelSplitter(3); this.customMotion.connect(this.customSplitter);
      this.customMatrix = this.matrix.map(original => { const gain = this.context.createGain(); gain.gain.value = original.gain.value; return gain; });
      ['positionX', 'positionY', 'positionZ'].forEach((name, axis) => {
        node.parameters.get(name)!.value = [this.panner.positionX, this.panner.positionY, this.panner.positionZ][axis].value;
        for (let component = 0; component < 3; component++) {
          this.customSplitter!.connect(this.customMatrix[axis * 3 + component], component);
          this.customMatrix[axis * 3 + component].connect(node.parameters.get(name)!);
        }
      });
      this.customMotion.onprocessorerror = () => this.fail();
    }
    node.port.onmessage = event => {
      if (!event.data.profileApplied || this.disposed) return;
      this.profilePending = false;
      if (this.queuedPack) { const pack = this.queuedPack; this.queuedPack = undefined; this.sendProfile(pack); }
    };
    node.onprocessorerror = () => this.fail();
  }

  private sendProfile(pack: HrtfPack): void {
    if (this.profilePending) { this.queuedPack = pack; return; }
    this.profilePending = true;
    this.custom!.port.postMessage({ pack });
  }

  private selectProfile(profile: HrtfProfile | undefined, editTime: number): void {
    let warmup = 0;
    if (profile) {
      const pack = preparedHrtfPack(this.context, profile);
      if (!this.custom) { this.createCustom(profile, editTime); warmup = pack.taps / this.context.sampleRate; }
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

  private configureReturn(enabled: boolean, period: number, time: number, initial = false): void {
    if (!this.returnGate && enabled) {
      const clock = this.context.createOscillator(), shape = this.context.createWaveShaper(), mix = this.context.createGain();
      const cycles = motionPhase(this.motionClock.snapshot(), time);
      setSinePhase(this.context, clock, 2 * cycles + .25);
      clock.frequency.value = 2 * this.motionClock.frequency(time);
      shape.curve = approachCurve;
      mix.gain.value = initial ? 1 : 0;
      clock.connect(shape).connect(mix).connect(this.mono.gain);
      clock.start(time);
      if (this.endAt !== undefined) clock.stop(Math.max(time, this.endAt));
      this.returnGate = { clock, shape, mix };
    }
    if (!this.returnGate) return;
    if (!initial) smooth(this.returnGate.clock.frequency, 2 / period, time);
    if (enabled === this.quietReturn) return;
    this.quietReturn = enabled;
    if (initial) this.mono.gain.value = 0;
    else {
      smooth(this.mono.gain, enabled ? 0 : 1, time);
      smooth(this.returnGate.mix.gain, enabled ? 1 : 0, time);
    }
  }

  private configure(settings: AsmrSpatialSettings, period: number, initial = false, editTime = this.context.currentTime): void {
    const path = spatialTrajectory(settings);
    const set = (param: AudioParam, value: number, custom = false) => {
      if (initial) param.value = value;
      else smooth(param, value, custom ? editTime : this.context.currentTime);
    };
    // Shared phases keep motion continuous through position and trajectory edits.
    [this.panner.positionX, this.panner.positionY, this.panner.positionZ].forEach((parameter, axis) => {
      const key = (['x', 'y', 'z'] as const)[axis]; set(parameter, path.center[key]);
      if (this.custom) set(this.custom.parameters.get(['positionX', 'positionY', 'positionZ'][axis])!, path.center[key], true);
      [path.sine, path.cosine, path.harmonic].forEach((coefficient, component) => set(this.matrix[axis * 3 + component].gain, coefficient[key]));
      if (this.customMatrix.length) [path.sine, path.cosine, path.harmonic].forEach((coefficient, component) => set(this.customMatrix[axis * 3 + component].gain, coefficient[key], true));
    });
    if (!initial) this.motionClock.update(period, editTime);
    if (this.customMotion) set(this.customMotion.parameters.get('frequency')!, 1 / period, true);
    for (const oscillator of [this.sine, this.cosine]) set(oscillator.frequency, 1 / period);
    set(this.harmonic.frequency, 2 / period);
  }

  update(settings: AsmrSpatialSettings, period: number, speed?: number): void {
    if (this.disposed || (this.endAt !== undefined && this.context.currentTime >= this.endAt)) return;
    settings = parseAsmrSpatial(settings); this.checkPeriod(period);
    const editTime = this.context.currentTime;
    if (this.adjustableMotion) {
      const signature = JSON.stringify({ settings, speed });
      if (signature !== this.adjustableSignature) {
        this.adjustableSignature = signature;
        this.adjustableMotion.port.postMessage({ settings, speed });
      }
      this.selectProfile(settings.profile, editTime);
      return;
    }
    this.motionClock.update(period, editTime);
    this.selectProfile(settings.profile, editTime);
    this.configure(settings, period, false, editTime);
    this.configureReturn(settings.motion === 'quiet-return', period, editTime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.adjustableMotion) for (const oscillator of [this.sine, this.cosine, this.harmonic]) oscillator.stop();
    if (this.returnGate) {
      this.returnGate.clock.stop();
      this.returnGate.clock.disconnect(); this.returnGate.shape.disconnect(); this.returnGate.mix.disconnect();
    }
    this.input.disconnect(this.mono);
    if (this.adjustableMotion) {
      this.adjustableMotion.onprocessorerror = null;
      this.adjustableMotion.port.postMessage({ stop: true });
      this.adjustableMotion.port.close(); this.adjustableMotion.disconnect(); this.adjustableSplitter?.disconnect();
    }
    if (this.custom) {
      this.custom.onprocessorerror = null; this.custom.port.onmessage = null;
      this.custom.port.postMessage({ stop: true }); this.custom.port.close(); this.custom.disconnect();
    }
    if (this.customMotion) {
      this.customMotion.onprocessorerror = null; this.customMotion.port.postMessage({ stop: true });
      this.customMotion.port.close(); this.customMotion.disconnect();
    }
    this.customSplitter?.disconnect(); this.customMatrix.forEach(gain => gain.disconnect());
    this.queuedPack = undefined; this.customGain?.disconnect();
    for (const node of [this.mono, this.panner, this.output, this.nativeGain, this.sine, this.cosine, this.harmonic, ...this.matrix]) node.disconnect();
  }
}
