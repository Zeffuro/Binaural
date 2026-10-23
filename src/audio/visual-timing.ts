import type { AsmrCue } from './asmr-cues';

export type VisualTimeline = 'analysis' | 'output' | 'capture';
type OutputClock = Pick<AudioContext, 'currentTime' | 'sampleRate' | 'baseLatency' | 'outputLatency' | 'getOutputTimestamp'>;
const MAX_DELAY = 2;

export function outputTime(context: OutputClock, now = performance.now()): number {
  const current = context.currentTime;
  try {
    const stamp = context.getOutputTimestamp?.();
    if (stamp && typeof stamp.contextTime === 'number' && Number.isFinite(stamp.contextTime) && stamp.contextTime > 0 &&
        typeof stamp.performanceTime === 'number' && Number.isFinite(stamp.performanceTime) && stamp.performanceTime > 0 &&
        now >= stamp.performanceTime && now - stamp.performanceTime < 250) {
      const mapped = stamp.contextTime + (now - stamp.performanceTime) / 1000;
      if (mapped <= current + 128 / context.sampleRate && mapped >= current - MAX_DELAY)
        return Math.max(0, Math.min(current, mapped));
    }
  } catch { /* Some devices cannot provide an output timestamp. */ }
  const latency = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
  return Math.max(0, current - Math.min(MAX_DELAY, latency(context.baseLatency) + latency(context.outputLatency)));
}

export class AsmrCueTimeline {
  private frames: { time: number; cues: AsmrCue[] }[] = [];
  clear(): void { this.frames.length = 0; }

  push(time: number, cues: readonly AsmrCue[]): void {
    if (!Number.isFinite(time)) return;
    const last = this.frames.at(-1);
    if (last && (time < last.time || time - last.time > .75)) this.clear();
    const frame = { time, cues: cues.map(cue => ({ ...cue })) };
    if (last?.time === time) this.frames[this.frames.length - 1] = frame;
    else this.frames.push(frame);
    while (this.frames.length > 240 || (this.frames.length > 1 && time - this.frames[0].time > MAX_DELAY)) this.frames.shift();
  }

  read(output: number, sampleRate: number): AsmrCue[] {
    // RMS windows describe their midpoint; ASMR taps precede the compressor's 6 ms look-ahead.
    const measurement = output + 512 / sampleRate - .006;
    for (let index = this.frames.length - 1; index >= 0; index--) {
      const frame = this.frames[index];
      if (frame.time <= measurement) return measurement - frame.time < .25 ? frame.cues.map(cue => ({ ...cue })) : [];
    }
    return [];
  }
}
