import { defaultAsmr, recordedAsmrSounds, type AsmrLayer, type AsmrSettings } from '../asmr-state';
import { ASMR_RATE, asmrSample } from './asmr-synthesis';
import { smooth } from './graph';
import { recordedAsmrBuffer } from './asmr-assets';
import { cuppingParameters, cuppingWave } from './ear-cupping';
import { AsmrPosition } from './asmr-position';
import { phaseCycles, setSinePhase } from './render-timing';
import { createAsmrPhraseSource, phraseConfig, type AsmrSource } from './asmr-phrase-source';
import type { AsmrPhraseConfig } from './asmr-phrases';
import { AsmrCueDetector, earRms, type AsmrCue } from './asmr-cues';

class AsmrVoice {
  private source: AsmrSource;
  private filter: BiquadFilterNode;
  private level: GainNode;
  private panner: StereoPannerNode;
  private motion: OscillatorNode;
  private drift: OscillatorNode;
  private width: GainNode;
  private wander: GainNode;
  private pressure: OscillatorNode;
  private pressureTone: GainNode;
  private pressureLevel: GainNode;
  private highpass: BiquadFilterNode;
  private phase = -1;
  private disposed = false;
  private position?: AsmrPosition;
  private cue: AsmrCueDetector;
  private cueAudible = false;
  private cueTap?: { output: AudioNode; splitter: ChannelSplitterNode; ears: AnalyserNode[]; samples: Float32Array<ArrayBuffer>[] };
  readonly sound: AsmrLayer['sound'];
  readonly spatial: boolean;
  readonly phrases: boolean;
  constructor(private context: BaseAudioContext, layer: AsmrLayer, output: AudioNode, endAt?: number, audible = true,
    private offsetSeconds = 0, config?: AsmrPhraseConfig, onFailure?: () => void, originSeconds = context.currentTime - offsetSeconds) {
    this.sound = layer.sound;
    this.cue = new AsmrCueDetector(layer.id, layer.sound);
    this.spatial = !!layer.spatial;
    this.phrases = !!config;
    if (config) {
      this.source = createAsmrPhraseSource(context, layer, config, offsetSeconds, endAt, onFailure, originSeconds);
      this.offsetSeconds = offsetSeconds = context.currentTime - originSeconds;
    }
    else {
      const source = context.createBufferSource();
      if (recordedAsmrSounds.some(sound => sound.id === layer.sound)) {
        const buffer = recordedAsmrBuffer(layer.sound);
        if (!buffer) throw new Error('The ASMR recording is still loading.');
        source.buffer = buffer;
      } else {
        const sample = asmrSample(layer.sound), buffer = context.createBuffer(1, sample.length, ASMR_RATE);
        buffer.getChannelData(0).set(sample); source.buffer = buffer;
      }
      source.loop = true;
      source.playbackRate.value = layer.rate;
      this.source = { playbackRate: source.playbackRate, connect: node => source.connect(node), disconnect: () => source.disconnect(),
        start: () => source.start(0, (offsetSeconds * source.playbackRate.value) % source.buffer!.duration), stop: time => source.stop(time) };
    }
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = .4;
    this.level = context.createGain(); this.level.gain.value = 0;
    this.panner = context.createStereoPanner();
    this.motion = context.createOscillator(); this.drift = context.createOscillator();
    this.motion.frequency.value = 1 / layer.period; this.drift.frequency.value = 1 / (layer.period * 2.71);
    if (offsetSeconds > 0) {
      setSinePhase(context, this.motion, phaseCycles(1 / layer.period, offsetSeconds));
      setSinePhase(context, this.drift, phaseCycles(1 / (layer.period * 2.71), offsetSeconds));
    }
    this.filter.frequency.value = 500 * 24 ** layer.tone;
    this.source.playbackRate.value = layer.rate; this.panner.pan.value = layer.pan;
    this.width = context.createGain(); this.wander = context.createGain();
    this.pressure = context.createOscillator(); this.pressure.frequency.value = 1 / layer.period;
    this.pressureTone = context.createGain(); this.pressureLevel = context.createGain();
    this.pressureTone.gain.value = this.pressureLevel.gain.value = 0;
    this.pressure.connect(this.pressureTone).connect(this.filter.frequency);
    this.pressure.connect(this.pressureLevel).connect(this.level.gain);
    this.highpass = context.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.frequency.value = 30; this.highpass.Q.value = .4;
    this.width.gain.value = this.wander.gain.value = 0;
    this.motion.connect(this.width).connect(this.panner.pan);
    this.drift.connect(this.wander).connect(this.panner.pan);
    this.source.connect(this.highpass).connect(this.filter).connect(this.level);
    if (layer.spatial) this.position = new AsmrPosition(context, this.level, output, layer.spatial, layer.period, endAt, offsetSeconds);
    else this.level.connect(this.panner).connect(output);
    this.update(layer, audible);
    this.source.start();
    this.motion.start(); this.drift.start(); this.pressure.start();
    if (endAt !== undefined && endAt > context.currentTime) for (const source of [this.source, this.motion, this.drift, this.pressure]) source.stop(endAt);
  }
  update(layer: AsmrLayer, audible: boolean, config?: AsmrPhraseConfig): void {
    this.cueAudible = audible && layer.level > 0;
    if (!this.cueAudible) this.cue.reset();
    if (config) this.source.configure?.(config);
    const time = this.context.currentTime;
    const pressure = cuppingParameters(audible ? layer.level : 0, layer.tone, layer.pressure ?? 0);
    smooth(this.level.gain, pressure.gain, time);
    smooth(this.pressureLevel.gain, pressure.gainDepth, time);
    smooth(this.pressureTone.gain, pressure.frequencyDepth, time);
    smooth(this.pressure.frequency, 1 / layer.period, time);
    if (this.phase !== (layer.pressurePhase ?? 0)) {
      this.phase = layer.pressurePhase ?? 0;
      const wave = cuppingWave(this.phase + 360 * phaseCycles(1 / layer.period, this.offsetSeconds));
      this.pressure.setPeriodicWave(this.context.createPeriodicWave(wave.real, wave.imaginary, { disableNormalization: true }));
    }
    smooth(this.source.playbackRate, layer.rate, time);
    smooth(this.filter.frequency, pressure.frequency, time);
    smooth(this.panner.pan, layer.pan, time);
    const width = layer.motion === 'still' ? 0 : layer.width * (1 - Math.abs(layer.pan));
    smooth(this.width.gain, width * (layer.motion === 'wander' ? .7 : 1), time);
    smooth(this.wander.gain, layer.motion === 'wander' ? width * .3 : 0, time);
    smooth(this.motion.frequency, 1 / layer.period, time);
    smooth(this.drift.frequency, 1 / (layer.period * 2.71), time);
    if (layer.spatial) this.position?.update(layer.spatial, layer.period);
  }
  readCue(gain: number, time: number): AsmrCue | undefined {
    if (this.disposed || !this.cueAudible || gain <= 0) { this.cue.reset(); return; }
    if (!this.cueTap) {
      const output = this.position?.outputNode ?? this.panner, splitter = this.context.createChannelSplitter(2);
      const ears = [this.context.createAnalyser(), this.context.createAnalyser()];
      ears.forEach((ear, channel) => { ear.fftSize = 1024; splitter.connect(ear, channel); });
      output.connect(splitter);
      this.cueTap = { output, splitter, ears, samples: [new Float32Array(1024), new Float32Array(1024)] };
    }
    const { ears, samples } = this.cueTap;
    ears.forEach((ear, index) => ear.getFloatTimeDomainData(samples[index]));
    return this.cue.read(time, earRms(samples[0]) * gain, earRms(samples[1]) * gain);
  }
  clearCue(): void { this.cue.reset(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cue.reset();
    if (this.cueTap) {
      this.cueTap.output.disconnect(this.cueTap.splitter);
      this.cueTap.splitter.disconnect(); this.cueTap.ears.forEach(ear => ear.disconnect());
      this.cueTap = undefined;
    }
    const stopAt = this.context.currentTime + .15;
    smooth(this.level.gain, 0, this.context.currentTime);
    smooth(this.pressureLevel.gain, 0, this.context.currentTime);
    for (const source of [this.source, this.motion, this.drift, this.pressure]) source.stop(stopAt);
    setTimeout(() => {
      this.position?.dispose();
      for (const node of [this.source, this.motion, this.drift, this.filter, this.level, this.panner, this.width, this.wander, this.pressure, this.pressureTone, this.pressureLevel, this.highpass]) node.disconnect();
    }, 200);
  }
}

export class AsmrMixer {
  private bus: GainNode;
  private voices = new Map<string, AsmrVoice>();
  private origin: number;
  private cueLevel = 0;
  constructor(private context: BaseAudioContext, output: AudioNode, private endAt?: number, private offsetSeconds = 0,
    private onFailure?: () => void) {
    this.origin = context.currentTime;
    this.bus = context.createGain(); this.bus.gain.value = 0; this.bus.connect(output);
  }
  update(settings: AsmrSettings = defaultAsmr(), enabled = true): void {
    const expired = this.endAt !== undefined && this.context.currentTime >= this.endAt;
    this.cueLevel = expired || !enabled ? 0 : settings.level;
    if (this.cueLevel <= 0) this.clearCues();
    smooth(this.bus.gain, expired || !enabled ? 0 : settings.level, this.context.currentTime);
    const solo = settings.layers.some(layer => layer.solo && !layer.muted);
    const phrases = !!settings.variation && settings.variation.mode !== 'steady';
    for (const [id, voice] of this.voices) {
      const layer = settings.layers.find(item => item.id === id);
      if (!layer || layer.sound !== voice.sound || !!layer.spatial !== voice.spatial || voice.phrases !== phrases || expired) { voice.dispose(); this.voices.delete(id); }
    }
    if (expired) return;
    for (const [ordinal, layer] of settings.layers.entries()) {
      const audible = !layer.muted && (!solo || layer.solo);
      let voice = this.voices.get(layer.id);
      if (!voice && !enabled) continue;
      const config = phrases ? phraseConfig(settings, ordinal) : undefined;
      if (!voice) { voice = new AsmrVoice(this.context, layer, this.bus, this.endAt, audible,
        this.offsetSeconds + this.context.currentTime - this.origin, config, this.onFailure,
        this.origin - this.offsetSeconds); this.voices.set(layer.id, voice); }
      voice.update(layer, audible, config);
    }
  }
  readCues(gain = 1, time = this.context.currentTime): AsmrCue[] {
    if (this.cueLevel <= 0 || gain <= 0 || (this.endAt !== undefined && this.context.currentTime >= this.endAt)) {
      this.clearCues(); return [];
    }
    const cues: AsmrCue[] = [];
    for (const voice of [...this.voices.values()].slice(0, 6)) {
      const cue = voice.readCue(gain * this.cueLevel, time);
      if (cue) cues.push(cue);
    }
    return cues;
  }
  clearCues(): void { for (const voice of this.voices.values()) voice.clearCue(); }
  dispose(): void {
    for (const voice of this.voices.values()) voice.dispose();
    this.voices.clear(); this.bus.disconnect();
  }
}
