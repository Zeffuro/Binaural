import { HrtfRenderer } from './hrtf-renderer';
import type { HrtfPack } from './hrtf-pack';
import { HrtfMotionRenderer, type HrtfMotionState } from './hrtf-motion';

declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort; constructor(options?: unknown) }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class HrtfProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['positionX', 'positionY', 'positionZ'].map(name => ({ name, defaultValue: name === 'positionZ' ? -.6 : 0,
      minValue: -10, maxValue: 10, automationRate: 'a-rate' }));
  }
  private renderer: HrtfRenderer;
  private stopFrame: number;
  constructor(options: { processorOptions: { pack: HrtfPack; stopFrame?: number } }) {
    super();
    this.renderer = new HrtfRenderer(options.processorOptions.pack);
    this.stopFrame = options.processorOptions.stopFrame ?? Infinity;
    this.port.onmessage = event => {
      if (event.data.pack) { this.renderer.changeProfile(event.data.pack); this.port.postMessage({ profileApplied: true }); }
      if (event.data.stop) this.stopFrame = -1;
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (currentFrame >= this.stopFrame) return false;
    const output = outputs[0];
    if (output?.[0] && output[1]) this.renderer.render(inputs[0]?.[0], output[0], output[1], parameters);
    return true;
  }
}

registerProcessor('asmr-hrtf', HrtfProcessor);

class HrtfMotionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'frequency', defaultValue: 1 / 12, minValue: 1 / 60, maxValue: .5, automationRate: 'a-rate' }]; }
  private renderer: HrtfMotionRenderer;
  private stopFrame: number;
  constructor(options: { processorOptions: { state: HrtfMotionState; originFrame: number; stopFrame?: number } }) {
    super();
    this.renderer = new HrtfMotionRenderer(options.processorOptions.state, options.processorOptions.originFrame);
    this.stopFrame = options.processorOptions.stopFrame ?? Infinity;
    this.port.onmessage = event => { if (event.data.stop) this.stopFrame = -1; };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (currentFrame >= this.stopFrame) return false;
    if (outputs[0]?.[2]) this.renderer.render(outputs[0], parameters.frequency, currentFrame, sampleRate);
    return true;
  }
}

registerProcessor('asmr-hrtf-motion', HrtfMotionProcessor);
