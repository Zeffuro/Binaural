import { BwgRenderer } from './bwg-renderer';
import type { BwgPreset } from '../import/bwg-format';
import type { BoundBackground } from '../background-assets';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class BwgProcessor extends AudioWorkletProcessor {
  private renderer: BwgRenderer;
  constructor(options: { processorOptions: { preset: BwgPreset; background?: BoundBackground } }) {
    super();
    this.renderer = new BwgRenderer(options.processorOptions.preset, sampleRate, options.processorOptions.background);
    this.port.onmessage = event => {
      if (Array.isArray(event.data?.levels)) this.renderer.levels = event.data.levels;
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!outputs[0]?.[0] || !outputs[0]?.[1]) return true;
    return this.renderer.render(outputs[0][0], outputs[0][1]);
  }
}
registerProcessor('bwg-sequence', BwgProcessor as typeof AudioWorkletProcessor);
