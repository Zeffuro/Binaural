export interface AsmrMarkerEvent {
  start: number; length: number;
  contact?: { stride: number; values: Float32Array };
}
export interface AsmrMarkerPose { progress: number; contact: number }
export interface AsmrMarkerSample {
  time: number;
  pose: AsmrMarkerPose | null | undefined;
  event: string;
}

export function sourceMarker(events: readonly AsmrMarkerEvent[], position: number, sourceLength: number,
    sourceRate: number): { pose: AsmrMarkerPose; index: number } | undefined {
  const index = sourceMarkerIndex(events, position, sourceLength);
  if (index < 0) return;
  const event = events[index], age = (position - event.start + sourceLength) % sourceLength;
  let contact = .85 * Math.exp(-age / sourceRate / .065);
  if (event.contact) {
    const { values, stride } = event.contact, envelopePosition = Math.max(0, Math.min(values.length - 1, age / stride - .5));
    const first = Math.floor(envelopePosition), fraction = envelopePosition - first;
    contact = Math.min(.85, values[first] + (values[Math.min(first + 1, values.length - 1)] - values[first]) * fraction);
  }
  return { index, pose: { progress: age / event.length, contact } };
}

export function sourceMarkerIndex(events: readonly AsmrMarkerEvent[], position: number, sourceLength: number): number {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].start <= position) low = middle + 1; else high = middle;
  }
  const index = low - 1, event = events[index];
  if (event && position - event.start < event.length) return index;
  const last = events.length - 1, tail = events[last];
  return tail && (position - tail.start + sourceLength) % sourceLength < tail.length ? last : -1;
}

export class AsmrMarkerHistory {
  private samples: AsmrMarkerSample[] = [];
  clear(): void { this.samples.length = 0; }
  push(sample: AsmrMarkerSample): void {
    if (!Number.isFinite(sample.time)) return;
    const previous = this.samples.at(-1);
    if (previous && sample.time < previous.time) this.clear();
    if (previous?.time === sample.time) this.samples[this.samples.length - 1] = sample;
    else this.samples.push(sample);
    while (this.samples.length > 512 || (this.samples.length > 1 && sample.time - this.samples[0].time > 3)) this.samples.shift();
  }
  read(time: number): AsmrMarkerPose | null | undefined {
    if (!Number.isFinite(time)) return;
    for (let index = this.samples.length - 1; index >= 0; index--) {
      const before = this.samples[index];
      if (before.time > time) continue;
      const after = this.samples[index + 1];
      if (time - before.time > .075) return;
      if (before.pose == null) return before.pose;
      if (!after || after.time - before.time > .075 || after.event !== before.event || !after.pose) return { ...before.pose };
      const fraction = (time - before.time) / (after.time - before.time);
      return { progress: before.pose.progress + (after.pose.progress - before.pose.progress) * fraction,
        contact: before.pose.contact + (after.pose.contact - before.pose.contact) * fraction };
    }
  }
}
