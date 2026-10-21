import type { AsmrCue } from './asmr-cues';

export interface VisualFrame {
  frequency: Uint8Array<ArrayBuffer>;
  waveform: Uint8Array<ArrayBuffer>;
  left: Uint8Array<ArrayBuffer>;
  right: Uint8Array<ArrayBuffer>;
  time: number;
  asmr?: AsmrCue[];
}

export class VisualAnalysis {
  readonly node: AnalyserNode;
  private frame: VisualFrame;
  private ears: AnalyserNode[];

  constructor(private context: AudioContext) {
    this.node = context.createAnalyser();
    this.node.fftSize = 1024;
    this.node.smoothingTimeConstant = 0.8;
    const splitter = context.createChannelSplitter(2);
    this.node.connect(splitter);
    this.ears = [context.createAnalyser(), context.createAnalyser()];
    this.ears.forEach((ear, channel) => { ear.fftSize = 1024; splitter.connect(ear, channel); });
    this.frame = { frequency: new Uint8Array(this.node.frequencyBinCount), waveform: new Uint8Array(1024),
      left: new Uint8Array(1024), right: new Uint8Array(1024), time: 0 };
  }

  read(): VisualFrame {
    this.node.getByteFrequencyData(this.frame.frequency);
    this.node.getByteTimeDomainData(this.frame.waveform);
    this.ears[0].getByteTimeDomainData(this.frame.left);
    this.ears[1].getByteTimeDomainData(this.frame.right);
    this.frame.time = this.context.currentTime;
    return this.frame;
  }
}
