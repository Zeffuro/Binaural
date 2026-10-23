import type { Session } from '../model';
import { AudioEngine } from './engine';

export interface AsmrPreviewState {
  readonly id?: string;
  readonly phase: 'idle' | 'loading' | 'playing' | 'stopping';
  readonly error?: string;
}

export interface AsmrPreviewEngine {
  readonly remaining: number | undefined;
  readonly failure?: string;
  start(session: Session): Promise<void>;
  stop(): Promise<void>;
}

function previewSession(session: Session, id: string): Session {
  const layer = session.asmr?.layers.find(candidate => candidate.id === id);
  if (!layer || !session.asmr) throw new Error('Choose an ASMR sound to preview.');
  return {
    version: 2, name: session.name, layers: structuredClone(session.layers),
    tonesMuted: true, mode: 'asmr', ambient: 'none', ambientLevel: 0, musicLevel: 0,
    master: session.master, ...(session.volumeBoost === undefined ? {} : { volumeBoost: session.volumeBoost }),
    minutes: 0, timelineDuration: 5,
    asmr: { level: session.asmr.level, layers: [{ ...structuredClone(layer), muted: false, solo: false }],
      ...(session.asmr.space ? { space: structuredClone(session.asmr.space) } : {}) },
  };
}

const message = (error: unknown): string => error instanceof Error ? error.message : 'The ASMR preview could not play.';

export class AsmrPreview {
  private snapshot: AsmrPreviewState = Object.freeze({ phase: 'idle' });
  private epoch = 0;
  private engine?: AsmrPreviewEngine;
  private closing: Promise<void> = Promise.resolve();
  private poll?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(private changed: (state: AsmrPreviewState) => void,
    private createEngine: () => AsmrPreviewEngine = () => new AudioEngine()) {}

  get state(): AsmrPreviewState { return this.snapshot; }
  get active(): boolean { return this.snapshot.phase !== 'idle'; }

  private publish(state: AsmrPreviewState): void {
    this.snapshot = Object.freeze(state);
    this.changed(this.snapshot);
  }

  private clearTimers(): void {
    clearInterval(this.poll); clearTimeout(this.watchdog);
    this.poll = undefined; this.watchdog = undefined;
  }

  private retire(): Promise<void> {
    this.clearTimers();
    const engine = this.engine;
    this.engine = undefined;
    if (engine) {
      // Startup may still await a recording; failed closure blocks replacement to prevent overlap.
      this.closing = this.closing.then(() => engine.stop());
      void this.closing.catch(() => {});
    }
    return this.closing;
  }

  private watch(epoch: number, engine: AsmrPreviewEngine): void {
    const finish = (error?: string) => { if (this.epoch === epoch) void this.end(error).catch(() => {}); };
    this.poll = setInterval(() => {
      if (engine.failure) finish(engine.failure);
      else if (engine.remaining === 0) finish();
    }, 50);
    this.watchdog = setTimeout(() => finish('The ASMR preview timed out and was stopped.'), 15_000);
  }

  // Cancelled starts resolve quietly; a current startup failure rejects after cleanup.
  async start(session: Session, layerId: string): Promise<void> {
    const epoch = ++this.epoch;
    const closing = this.retire();
    if (this.active) this.publish({ id: this.state.id, phase: 'stopping' });
    this.publish({ id: layerId, phase: 'loading' });
    try {
      const isolated = previewSession(session, layerId);
      await closing;
      if (this.epoch !== epoch) return;
      const engine = this.createEngine();
      this.engine = engine;
      this.watch(epoch, engine);
      await engine.start(isolated);
      if (this.epoch !== epoch) return;
      if (engine.failure) throw new Error(engine.failure);
      this.publish({ id: layerId, phase: 'playing' });
    } catch (error) {
      if (this.epoch !== epoch) return;
      await this.end(message(error));
      if (this.epoch !== epoch + 1) return;
      throw error;
    }
  }

  private async end(error?: string): Promise<void> {
    const epoch = ++this.epoch;
    if (this.active) this.publish({ id: this.state.id, phase: 'stopping' });
    const closing = this.retire();
    try { await closing; }
    catch (failure) {
      if (this.epoch === epoch) this.publish({ phase: 'idle', error: message(failure) });
      throw failure;
    }
    if (this.epoch === epoch) this.publish({ phase: 'idle', ...(error ? { error } : {}) });
  }

  async stop(): Promise<void> { await this.end(); }
}
