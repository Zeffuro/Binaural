export type AudioExportFormat = 'wav' | 'flac';
export interface WavProgress {
  completedFrames: number;
  totalFrames: number;
  fraction: number;
  stage: 'preparing' | 'rendering' | 'finishing' | 'saving';
}
export interface WavOptions {
  signal?: AbortSignal;
  onProgress?: (progress: WavProgress) => void;
  music?: File;
}
export interface AudioExportOptions extends WavOptions { format?: AudioExportFormat }
export interface WavWriter {
  write: (data: ArrayBuffer) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
  seek?: (position: number) => Promise<void>;
}
export interface PcmOutput {
  start: (frames: number) => Promise<void>;
  write: (left: Float32Array, right: Float32Array, first: number, frames: number) => Promise<void>;
}
