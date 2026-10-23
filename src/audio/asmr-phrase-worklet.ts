import { AsmrPhraseRenderer, type AsmrPhraseConfig, type AsmrPhrasePcm } from './asmr-phrases';
import type { AsmrMarkerSample } from './asmr-markers';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { port: MessagePort; constructor(options?: unknown) }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class AsmrPhraseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'rate', defaultValue: 1, minValue: .5, maxValue: 2, automationRate: 'a-rate' }]; }
  private renderer: AsmrPhraseRenderer;
  private originFrame: number;
  private stopFrame = Infinity;
  private pcm: AsmrPhrasePcm;
  private previous?: AsmrPhraseRenderer;
  private previousOutput: Float32Array[] = [];
  private transition = 0;
  private markerEpoch = 0;
  private markersEnabled = false;
  private markerSamples: AsmrMarkerSample[] = [];
  private nextMarkerPost = 0;
  constructor(options: { processorOptions: { pcm: AsmrPhrasePcm; config: AsmrPhraseConfig; originFrame: number; stopFrame?: number } }) {
    super();
    const settings = options.processorOptions;
    this.pcm = settings.pcm;
    this.renderer = new AsmrPhraseRenderer(settings.pcm, settings.config);
    this.originFrame = settings.originFrame;
    this.stopFrame = settings.stopFrame ?? Infinity;
    this.port.onmessage = event => {
      if (event.data.config) {
        this.previous = this.renderer;
        this.renderer = new AsmrPhraseRenderer(this.pcm, event.data.config);
        this.transition = Math.round(sampleRate * .06);
      }
      if (typeof event.data.stopFrame === 'number') this.stopFrame = event.data.stopFrame;
      if (typeof event.data.markers === 'boolean') {
        this.markersEnabled = event.data.markers;
        this.markerEpoch = event.data.markerEpoch;
        this.markerSamples.length = 0;
        this.nextMarkerPost = currentFrame + Math.ceil(sampleRate / 30);
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (currentFrame >= this.stopFrame) return false;
    const output = outputs[0];
    if (!output?.[0]) return true;
    const observe = this.markersEnabled ? (sample: AsmrMarkerSample) => {
      const time = sample.time + this.originFrame / sampleRate;
      const pose = time * sampleRate >= this.stopFrame ? null : this.transition > 0 ? undefined : sample.pose;
      this.markerSamples.push({ time, pose, event: this.transition > 0 ? 'transition' : sample.event });
      if (this.markerSamples.length > 512) this.markerSamples.shift();
    } : undefined;
    this.renderer.render(output, sampleRate, currentFrame - this.originFrame, parameters.rate, observe);
    if (this.previous && this.transition > 0) {
      if (this.previousOutput.length !== output.length || this.previousOutput[0]?.length !== output[0].length) {
        this.previousOutput = output.map(channel => new Float32Array(channel.length));
      }
      this.previous.render(this.previousOutput, sampleRate, currentFrame - this.originFrame, parameters.rate);
      for (let frame = 0; frame < output[0].length && this.transition > 0; frame++, this.transition--) {
        const oldGain = this.transition / Math.round(sampleRate * .06);
        for (let ear = 0; ear < output.length; ear++) output[ear][frame] =
          this.previousOutput[ear][frame] * oldGain + output[ear][frame] * (1 - oldGain);
      }
      if (this.transition <= 0) this.previous = undefined;
    }
    for (let frame = Math.max(0, this.stopFrame - currentFrame); frame < output[0].length; frame++) {
      for (const channel of output) channel[frame] = 0;
    }
    if (this.markersEnabled && currentFrame + output[0].length >= this.nextMarkerPost) {
      this.port.postMessage({ markerEpoch: this.markerEpoch, markers: this.markerSamples, frame: currentFrame + output[0].length });
      this.markerSamples = [];
      this.nextMarkerPost = currentFrame + output[0].length + Math.ceil(sampleRate / 30);
    }
    return true;
  }
}
registerProcessor('asmr-phrases', AsmrPhraseProcessor as typeof AudioWorkletProcessor);
