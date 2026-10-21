import { AsmrPhraseRenderer, type AsmrPhraseConfig, type AsmrPhrasePcm } from './asmr-phrases';

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
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (currentFrame >= this.stopFrame) return false;
    const output = outputs[0];
    if (!output?.[0]) return true;
    this.renderer.render(output, sampleRate, currentFrame - this.originFrame, parameters.rate);
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
    return true;
  }
}
registerProcessor('asmr-phrases', AsmrPhraseProcessor as typeof AudioWorkletProcessor);
