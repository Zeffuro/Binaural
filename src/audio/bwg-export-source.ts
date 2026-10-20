import type { BoundBackground } from '../background-assets';
import type { BwgPreset } from '../import/bwg-format';
import { validateBwgExportRange, type BwgExportResponse } from './bwg-export-protocol';
export { BWG_EXPORT_HISTORY_SECONDS, BWG_EXPORT_MAX_READ_SECONDS } from './bwg-export-protocol';

interface PendingRead {
  id: number;
  frames: number;
  resolve: (channels: [Float32Array, Float32Array]) => void;
  reject: (error: Error) => void;
}

export class BwgExportSource {
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private worker?: Worker;
  private failure?: Error;
  private pending?: PendingRead;
  private reading = false;
  private cursor = 0;
  private request = 0;
  private abort = (): void => { this.fail(new DOMException('WAV export was cancelled.', 'AbortError')); };

  constructor(preset: BwgPreset, private rate: number, levels: number[], background?: BoundBackground,
      private signal?: AbortSignal) {
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => undefined);
    if (signal?.aborted) { this.abort(); return; }
    signal?.addEventListener('abort', this.abort, { once: true });
    try {
      this.worker = new Worker(new URL('./bwg-export-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => this.receive(event.data as BwgExportResponse);
      this.worker.onerror = event => {
        event.preventDefault();
        this.fail(new Error(event.message || 'The BWGen export worker failed.'));
      };
      this.worker.onmessageerror = () => this.fail(new Error('The BWGen export worker returned unreadable audio.'));
      this.worker.postMessage({ type: 'init', preset, rate, levels, background });
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }

  async read(startFrame: number, frames: number): Promise<[Float32Array, Float32Array]> {
    if (this.failure) throw this.failure;
    if (this.reading) throw new Error('A BWGen export read is already in progress.');
    this.reading = true;
    try {
      await this.ready;
      if (this.failure) throw this.failure;
      validateBwgExportRange(startFrame, frames, this.cursor, this.rate);
      const channels = await new Promise<[Float32Array, Float32Array]>((resolve, reject) => {
        const id = ++this.request;
        this.pending = { id, frames, resolve, reject };
        try { this.worker!.postMessage({ type: 'read', id, startFrame, frames }); }
        catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
      });
      this.cursor = startFrame + frames;
      return channels;
    } finally { this.reading = false; }
  }

  dispose(): void { this.abort(); }

  private receive(message: BwgExportResponse): void {
    if (this.failure) return;
    if (message?.type === 'ready') { this.resolveReady(); return; }
    if (message?.type === 'error') { this.fail(new Error(message.message)); return; }
    const pending = this.pending;
    if (message?.type !== 'pcm' || !pending || message.id !== pending.id ||
        !(message.left instanceof Float32Array) || !(message.right instanceof Float32Array) ||
        message.left.length !== pending.frames || message.right.length !== pending.frames ||
        !message.left.every(Number.isFinite) || !message.right.every(Number.isFinite)) {
      this.fail(new Error('The BWGen export worker returned invalid audio.'));
      return;
    }
    this.pending = undefined;
    pending.resolve([message.left, message.right]);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.signal?.removeEventListener('abort', this.abort);
    this.worker?.terminate();
    this.worker = undefined;
    this.rejectReady(error);
    this.pending?.reject(error);
    this.pending = undefined;
  }
}
