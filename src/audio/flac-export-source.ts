import { validateFlacFrames, validateFlacPcm, validateFlacHeader,
  type FlacExportRequest, type FlacExportResponse } from './flac-export-protocol';
export { FLAC_SAMPLE_RATE, FLAC_HEADER_BYTES, FLAC_MAX_CHUNK_FRAMES } from './flac-export-protocol';

type Reply = Extract<FlacExportResponse, { type: 'encoded' | 'finished' }>;
interface Pending {
  id: number;
  kind: 'encode' | 'finish';
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
}

export class FlacExportSource {
  readonly ready: Promise<void>;
  readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private worker?: Worker;
  private failure?: Error;
  private pending?: Pending;
  private busy = false;
  private initialized = false;
  private finished = false;
  private cursor = 0;
  private request = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private abort = (): void => { this.fail(new DOMException('FLAC export was cancelled.', 'AbortError')); };

  constructor(private totalFrames: number, private signal?: AbortSignal) {
    this.ready = this.readyPromise = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => undefined);
    if (signal?.aborted) { this.abort(); return; }
    signal?.addEventListener('abort', this.abort, { once: true });
    try {
      validateFlacFrames(totalFrames);
      this.worker = new Worker(new URL('./flac-export-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => this.receive(event.data as FlacExportResponse);
      this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'The FLAC export worker failed.')); };
      this.worker.onmessageerror = () => this.fail(new Error('The FLAC export worker returned unreadable audio.'));
      this.timer = setTimeout(() => this.fail(new Error('The FLAC encoder took too long to initialize.')), 20000);
      this.worker.postMessage({ type: 'init', totalFrames });
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }

  async encode(left: Float32Array, right: Float32Array): Promise<ArrayBuffer> {
    this.check();
    validateFlacPcm(left, right, this.totalFrames - this.cursor);
    const frames = left.length;
    const channels = [left.slice(), right.slice()];
    this.busy = true;
    try {
      await this.ready;
      this.check(false);
      const reply = await this.send({ type: 'encode', id: ++this.request, left: channels[0], right: channels[1] },
        [channels[0].buffer, channels[1].buffer]);
      this.cursor += frames;
      return reply.data;
    } finally { this.busy = false; }
  }

  async finish(): Promise<{ data: ArrayBuffer; header: ArrayBuffer }> {
    this.check();
    if (this.cursor !== this.totalFrames) throw new Error('The FLAC export frame count is incomplete.');
    this.busy = true;
    try {
      await this.ready;
      this.check(false);
      const reply = await this.send({ type: 'finish', id: ++this.request });
      if (reply.type !== 'finished') throw new Error('Invalid FLAC finalization response.');
      this.finished = true;
      this.stop();
      return { data: reply.data, header: reply.header };
    } finally { this.busy = false; }
  }

  dispose(): void { if (!this.finished) this.abort(); }

  private check(checkBusy = true): void {
    if (this.failure) throw this.failure;
    if (this.finished) throw new Error('The FLAC export is already finished.');
    if (checkBusy && this.busy) throw new Error('A FLAC export request is already in progress.');
  }

  private send(message: Exclude<FlacExportRequest, { type: 'init' }>, transfer: Transferable[] = []): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { id: message.id, kind: message.type, resolve, reject };
      try { this.worker!.postMessage(message, transfer); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private receive(message: FlacExportResponse): void {
    if (this.failure || this.finished) return;
    if (message?.type === 'error') { this.fail(new Error(message.message)); return; }
    if (message?.type === 'ready' && !this.initialized && !this.pending) {
      this.initialized = true;
      clearTimeout(this.timer);
      this.resolveReady();
      return;
    }
    const pending = this.pending;
    if (!pending || message?.type !== (pending.kind === 'encode' ? 'encoded' : 'finished') ||
        message.id !== pending.id || !(message.data instanceof ArrayBuffer)) {
      this.fail(new Error('The FLAC export worker returned invalid data.'));
      return;
    }
    if (message.type === 'finished') {
      try { validateFlacHeader(message.header, this.totalFrames); }
      catch (error) { this.fail(error as Error); return; }
    }
    this.pending = undefined;
    pending.resolve(message);
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    this.worker?.terminate();
    this.worker = undefined;
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.stop();
    this.rejectReady(error);
    this.pending?.reject(error);
    this.pending = undefined;
  }
}
