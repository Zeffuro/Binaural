import { HrtfRenderer } from './hrtf-renderer';
import type { HrtfPack } from './hrtf-pack';
import { HrtfMotionRenderer, type HrtfMotionState } from './hrtf-motion';
import { QuietApproachRenderer } from './quiet-approach';
import { QuietClickRenderer } from './quiet-click-renderer';
import type { QuietClickBank } from './quiet-click-clips';
import type { AsmrSpatialSettings } from '../asmr-spatial';

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
    if (outputs[0]?.[3]) this.renderer.render(outputs[0], parameters.frequency, currentFrame, sampleRate);
    return true;
  }
}

registerProcessor('asmr-hrtf-motion', HrtfMotionProcessor);

class QuietApproachProcessor extends AudioWorkletProcessor {
  private renderer: QuietApproachRenderer;
  private stopFrame: number;
  constructor(options: { processorOptions: { settings: AsmrSpatialSettings; originFrame: number; offset: number; stopFrame?: number } }) {
    super();
    const { settings, originFrame, offset, stopFrame } = options.processorOptions;
    this.renderer = new QuietApproachRenderer(settings, originFrame, offset);
    this.stopFrame = stopFrame ?? Infinity;
    this.port.onmessage = event => {
      if (event.data.stop) this.stopFrame = -1;
      else if (event.data.settings) this.renderer.configure(event.data.settings);
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (currentFrame >= this.stopFrame) return false;
    if (outputs[0]?.[3]) this.renderer.render(outputs[0], currentFrame, sampleRate);
    return true;
  }
}

registerProcessor('asmr-quiet-approach', QuietApproachProcessor);

class QuietClickProcessor extends AudioWorkletProcessor {
  private renderer: QuietClickRenderer;
  private stopFrame: number;
  constructor(options: { processorOptions: { banks: readonly QuietClickBank[]; settings: AsmrSpatialSettings;
    speed: number; originFrame: number; offset: number; skipPartial: boolean; stopFrame?: number } }) {
    super();
    const { banks, settings, originFrame, offset, speed, skipPartial, stopFrame } = options.processorOptions;
    this.renderer = new QuietClickRenderer(banks, settings, speed, sampleRate, originFrame, offset, skipPartial);
    this.stopFrame = stopFrame ?? Infinity;
    this.port.onmessage = ({ data }) => {
      if (data.stop) this.stopFrame = -1;
      else if (data.settings) this.renderer.configure(data.settings, data.speed);
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (currentFrame >= this.stopFrame) return false;
    if (outputs[0]?.[3]) this.renderer.render(outputs[0], currentFrame, this.stopFrame);
    return true;
  }
}

registerProcessor('asmr-quiet-click', QuietClickProcessor);
