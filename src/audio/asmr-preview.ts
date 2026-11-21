import type { Session } from '../model';
import { defaultQuietReturn } from '../asmr-spatial';
import { AudioEngine, type PlaybackEnvelope } from './engine';
import { quietClickTailSeconds } from './quiet-click-clips';
import { quietClickTurns } from './quiet-click-sequence';

export interface AsmrPreviewState {
  readonly id?: string;
  readonly phase: 'idle' | 'loading' | 'playing' | 'stopping';
  readonly error?: string;
  readonly bothEars?: boolean;
}

export interface AsmrPreviewEngine {
  readonly remaining: number | undefined;
  readonly failure?: string;
  start(session: Session, envelope?: PlaybackEnvelope): Promise<void>;
  stop(): Promise<void>;
}

function previewSession(session: Session, id: string, bothEars: boolean): Session {
  const layer = session.asmr?.layers.find(candidate => candidate.id === id);
  if (!layer || !session.asmr) throw new Error('Choose an ASMR sound to preview.');
  const isolated = { ...structuredClone(layer), muted: false, solo: false };
  if (isolated.spatial?.motion === 'quiet-return') {
    isolated.spatial.quietReturn ??= defaultQuietReturn(isolated.period, isolated.spatial.distance);
  }
  const timing = isolated.spatial?.quietReturn;
  const hold = timing?.syncClicks ? quietClickTailSeconds / isolated.rate : 0;
  const duration = bothEars && timing ? (timing.approach + hold) * 2 + quietClickTurns(timing)[0].gap + .25 : 5;
  if (timing?.syncClicks && !bothEars) {
    timing.approach = Math.min(timing.approach, 4);
    timing.gap = Math.max(5, timing.gap);
    delete timing.sequence;
  }
  return {
    version: 2, name: session.name, layers: structuredClone(session.layers),
    tonesMuted: true, mode: 'asmr', ambient: 'none', ambientLevel: 0, musicLevel: 0,
    master: session.master, ...(session.volumeBoost === undefined ? {} : { volumeBoost: session.volumeBoost }),
    ...(session.dynamics === undefined ? {} : { dynamics: session.dynamics }),
    minutes: 0, timelineDuration: duration,
    asmr: { level: session.asmr.level, layers: [isolated],
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

  private watch(epoch: number, engine: AsmrPreviewEngine, duration: number): void {
    const finish = (error?: string) => { if (this.epoch === epoch) void this.end(error).catch(() => {}); };
    this.poll = setInterval(() => {
      if (engine.failure) finish(engine.failure);
      else if (engine.remaining === 0) finish();
    }, 50);
    this.watchdog = setTimeout(() => finish('The ASMR preview timed out and was stopped.'), (duration + 10) * 1000);
  }

  // Cancelled starts resolve quietly; a current startup failure rejects after cleanup.
  async start(session: Session, layerId: string, bothEars = false): Promise<void> {
    const epoch = ++this.epoch;
    const closing = this.retire();
    if (this.active) this.publish({ id: this.state.id, phase: 'stopping' });
    bothEars &&= session.asmr?.layers.find(layer => layer.id === layerId)?.spatial?.motion === 'quiet-return';
    const previewMode = bothEars ? { bothEars: true } : {};
    this.publish({ id: layerId, phase: 'loading', ...previewMode });
    try {
      const isolated = previewSession(session, layerId, bothEars);
      await closing;
      if (this.epoch !== epoch) return;
      const engine = this.createEngine();
      this.engine = engine;
      this.watch(epoch, engine, isolated.timelineDuration ?? 5);
      const timedClicks = isolated.asmr?.layers[0].spatial?.quietReturn?.syncClicks;
      await engine.start(isolated, timedClicks ? { fadeIn: .05, fadeOut: .12 } : undefined);
      if (this.epoch !== epoch) return;
      if (engine.failure) throw new Error(engine.failure);
      this.publish({ id: layerId, phase: 'playing', ...previewMode });
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
