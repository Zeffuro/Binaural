import { type Ambient, type Layer } from '../model';
import { schedule } from './automation';

export function hold(param: AudioParam, time: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else {
    // Firefox needs an explicit hold before replacing automation.
    const current = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(current, time);
  }
}

export function smooth(param: AudioParam, value: number, time: number): void {
  hold(param, time);
  param.setTargetAtTime(value, time, 0.035);
}

export class ToneVoice {
  private sources: OscillatorNode[];
  private gains: GainNode[] = [];
  private output: GainNode;
  private merger: ChannelMergerNode;
  private envelopes: GainNode[];

  constructor(private context: BaseAudioContext, layer: Layer, destination: AudioNode,
    count: number, endAt?: number, origin = context.currentTime) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.merger = context.createChannelMerger(2);
    this.merger.connect(this.output).connect(destination);
    this.sources = [context.createOscillator(), context.createOscillator()];
    this.envelopes = [context.createGain(), context.createGain()];
    this.sources[0].frequency.value = layer.left;
    this.sources[1].frequency.value = layer.right;
    // Keep both merger inputs connected, including when one ear is silent.
    for (const [ear, source] of this.sources.entries()) {
      source.connect(this.envelopes[ear]);
      for (let channel = 0; channel < 2; channel++) {
        const gain = context.createGain();
        gain.gain.value = 0;
        this.envelopes[ear].connect(gain).connect(this.merger, 0, channel);
        this.gains.push(gain);
      }
      source.start();
      if (endAt !== undefined) source.stop(endAt);
    }
    this.update(layer, count);
    if (layer.automation) {
      schedule(this.sources[0].frequency, layer.automation.left, origin, context.currentTime);
      schedule(this.sources[1].frequency, layer.automation.right, origin, context.currentTime);
      schedule(this.envelopes[0].gain, layer.automation.leftLevel, origin, context.currentTime);
      schedule(this.envelopes[1].gain, layer.automation.rightLevel, origin, context.currentTime);
    }
  }

  update(layer: Layer, count: number): void {
    const time = this.context.currentTime;
    if (!layer.automation) {
      smooth(this.sources[0].frequency, layer.left, time);
      smooth(this.sources[1].frequency, layer.right, time);
    }
    const weights = { binaural: [1, 0, 0, 1], mixed: [0.5, 0.5, 0.5, 0.5],
      left: [1, 0, 0, 0], right: [0, 0, 0, 1] }[layer.route];
    this.gains.forEach((gain, i) => smooth(gain.gain, weights[i], time));
    smooth(this.output.gain, 0.22 * layer.level / Math.max(1, count), time);
  }

  dispose(): void {
    smooth(this.output.gain, 0, this.context.currentTime);
    const end = this.context.currentTime + 0.25;
    for (const source of this.sources) source.stop(end);
    setTimeout(() => {
      this.sources.forEach(source => source.disconnect());
      this.envelopes.forEach(gain => gain.disconnect());
      this.gains.forEach(gain => gain.disconnect());
      this.merger.disconnect();
      this.output.disconnect();
    }, 300);
  }
}

export function noiseBuffer(context: BaseAudioContext, type: Exclude<Ambient, 'none'>): AudioBuffer {
  const buffer = context.createBuffer(2, context.sampleRate * 8, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let brown = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.02) / 1.02;
      p0 = 0.99765 * p0 + white * 0.099046;
      p1 = 0.963 * p1 + white * 0.2965164;
      p2 = 0.57 * p2 + white * 1.0526913;
      const pink = (p0 + p1 + p2 + white * 0.1848) * 0.08;
      data[i] = type === 'white' ? white * 0.6 : type === 'pink' ? pink : brown * 3;
    }
    // A short seam blend prevents a discontinuity at the loop boundary.
    const seam = Math.floor(context.sampleRate * 0.04);
    for (let i = 0; i < seam; i++) {
      const weight = i / seam;
      data[data.length - seam + i] = data[data.length - seam + i] * (1 - weight) + data[i] * weight;
    }
  }
  return buffer;
}
