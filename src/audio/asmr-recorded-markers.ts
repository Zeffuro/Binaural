import type { AsmrMarkerEvent } from './asmr-markers';

const cache = new WeakMap<AudioBuffer, readonly AsmrMarkerEvent[]>();

export function analyzeRecordedActions(channels: readonly Float32Array[], sampleRate: number): AsmrMarkerEvent[] {
  const length = channels[0]?.length ?? 0;
  if (!length || !Number.isFinite(sampleRate) || sampleRate <= 0 || channels.some(channel => channel.length !== length)) return [];
  const stride = Math.max(1, Math.round(sampleRate * .01)), count = Math.ceil(length / stride);
  const envelope = new Float32Array(count);
  let peak = 0;
  for (let window = 0; window < count; window++) {
    const start = window * stride, end = Math.min(length, start + stride);
    let energy = 0;
    for (const channel of channels) for (let frame = start; frame < end; frame++) {
      const sample = channel[frame];
      if (!Number.isFinite(sample)) return [];
      energy += sample * sample;
    }
    envelope[window] = Math.sqrt(energy / ((end - start) * channels.length));
    peak = Math.max(peak, envelope[window]);
  }
  if (peak <= .00001) return [];
  const onset = Math.max(.00001, peak * .1), release = Math.max(.000005, peak * .05);
  const gap = Math.max(1, Math.round(sampleRate * .12 / stride)), events: AsmrMarkerEvent[] = [];
  let start = -1, last = -1;
  const finish = () => {
    if (start < 0) return;
    const first = start * stride, end = Math.min(length, (last + 1) * stride);
    if (end - first >= sampleRate * .04) {
      const values = envelope.slice(start, last + 1);
      for (let index = 0; index < values.length; index++) values[index] = Math.min(.85, values[index] / peak * .85);
      events.push({ start: first, length: end - first, contact: { stride, values } });
    }
    start = last = -1;
  };
  for (let window = 0; window < count; window++) {
    if (start < 0) { if (envelope[window] >= onset) start = last = window; }
    else if (envelope[window] >= release) last = window;
    else if (window - last > gap) finish();
  }
  finish();
  return events;
}

export function recordedMarkerEvents(buffer: AudioBuffer): readonly AsmrMarkerEvent[] {
  let events = cache.get(buffer);
  if (!events) {
    events = analyzeRecordedActions(Array.from({ length: buffer.numberOfChannels }, (_, ear) => buffer.getChannelData(ear)), buffer.sampleRate);
    cache.set(buffer, events);
  }
  return events;
}
