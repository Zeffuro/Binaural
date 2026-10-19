import { defaultAsmr, recordedAsmrSounds, type AsmrLayer, type AsmrSettings } from '../asmr-state';
import { ASMR_RATE, asmrSample } from './asmr-synthesis';
import { smooth } from './graph';
import { recordedAsmrBuffer } from './asmr-assets';
import { cuppingParameters, cuppingWave } from './ear-cupping';

class AsmrVoice {
  private source: AudioBufferSourceNode;
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
  readonly sound: AsmrLayer['sound'];
  constructor(private context: BaseAudioContext, layer: AsmrLayer, output: AudioNode, endAt?: number, audible = true) {
    this.sound = layer.sound;
    this.source = context.createBufferSource();
    if (recordedAsmrSounds.some(sound => sound.id === layer.sound)) {
      const buffer = recordedAsmrBuffer(layer.sound);
      if (!buffer) throw new Error('The ASMR recording is still loading.');
      this.source.buffer = buffer;
    } else {
      const sample = asmrSample(layer.sound), buffer = context.createBuffer(1, sample.length, ASMR_RATE);
      buffer.getChannelData(0).set(sample); this.source.buffer = buffer;
    }
    this.source.loop = true;
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = .4;
    this.level = context.createGain(); this.level.gain.value = 0;
    this.panner = context.createStereoPanner();
    this.motion = context.createOscillator(); this.drift = context.createOscillator();
    this.motion.frequency.value = 1 / layer.period; this.drift.frequency.value = 1 / (layer.period * 2.71);
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
    this.source.connect(this.highpass).connect(this.filter).connect(this.level).connect(this.panner).connect(output);
    this.update(layer, audible);
    this.source.start(); this.motion.start(); this.drift.start(); this.pressure.start();
    if (endAt !== undefined && endAt > context.currentTime) for (const source of [this.source, this.motion, this.drift, this.pressure]) source.stop(endAt);
  }
  update(layer: AsmrLayer, audible: boolean): void {
    const time = this.context.currentTime;
    const pressure = cuppingParameters(audible ? layer.level : 0, layer.tone, layer.pressure ?? 0);
    smooth(this.level.gain, pressure.gain, time);
    smooth(this.pressureLevel.gain, pressure.gainDepth, time);
    smooth(this.pressureTone.gain, pressure.frequencyDepth, time);
    smooth(this.pressure.frequency, 1 / layer.period, time);
    if (this.phase !== (layer.pressurePhase ?? 0)) {
      this.phase = layer.pressurePhase ?? 0; const wave = cuppingWave(this.phase);
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
  }
  dispose(): void {
    const stopAt = this.context.currentTime + .15;
    smooth(this.level.gain, 0, this.context.currentTime);
    for (const source of [this.source, this.motion, this.drift, this.pressure]) source.stop(stopAt);
    setTimeout(() => {
      for (const node of [this.source, this.motion, this.drift, this.filter, this.level, this.panner, this.width, this.wander, this.pressure, this.pressureTone, this.pressureLevel, this.highpass]) node.disconnect();
    }, 200);
  }
}

export class AsmrMixer {
  private bus: GainNode;
  private voices = new Map<string, AsmrVoice>();
  constructor(private context: BaseAudioContext, output: AudioNode, private endAt?: number) {
    this.bus = context.createGain(); this.bus.gain.value = 0; this.bus.connect(output);
  }
  update(settings: AsmrSettings = defaultAsmr(), enabled = true): void {
    const expired = this.endAt !== undefined && this.context.currentTime >= this.endAt;
    smooth(this.bus.gain, expired || !enabled ? 0 : settings.level, this.context.currentTime);
    const solo = settings.layers.some(layer => layer.solo && !layer.muted);
    for (const [id, voice] of this.voices) {
      const layer = settings.layers.find(item => item.id === id);
      if (!layer || layer.sound !== voice.sound || expired) { voice.dispose(); this.voices.delete(id); }
    }
    if (expired) return;
    for (const layer of settings.layers) {
      const audible = !layer.muted && (!solo || layer.solo);
      let voice = this.voices.get(layer.id);
      if (!voice && !enabled) continue;
      if (!voice) { voice = new AsmrVoice(this.context, layer, this.bus, this.endAt, audible); this.voices.set(layer.id, voice); }
      voice.update(layer, audible);
    }
  }
  dispose(): void { this.voices.clear(); this.bus.disconnect(); }
}
