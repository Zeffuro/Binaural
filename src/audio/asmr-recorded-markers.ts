import type { AsmrMarkerEvent } from './asmr-markers';

const cache = new WeakMap<AudioBuffer, readonly AsmrMarkerEvent[]>();

interface RecordedActionDetection {
  strideSeconds: number;
  gapSeconds: number;
  onsetRatio: number;
  releaseRatio: number;
}

const defaultDetection: RecordedActionDetection = { strideSeconds: .01, gapSeconds: .12, onsetRatio: .1, releaseRatio: .05 };

export function analyzeRecordedActions(channels: readonly Float32Array[], sampleRate: number, minimumSeconds = .04,
    detection = defaultDetection): AsmrMarkerEvent[] {
  const length = channels[0]?.length ?? 0;
  if (!length || !Number.isFinite(sampleRate) || sampleRate <= 0 || channels.some(channel => channel.length !== length)) return [];
  const stride = Math.max(1, Math.round(sampleRate * detection.strideSeconds)), count = Math.ceil(length / stride);
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
  const onset = Math.max(.00001, peak * detection.onsetRatio), release = Math.max(.000005, peak * detection.releaseRatio);
  const gap = Math.max(1, Math.round(sampleRate * detection.gapSeconds / stride)), events: AsmrMarkerEvent[] = [];
  let start = -1, last = -1;
  const finish = () => {
    if (start < 0) return;
    const first = start * stride, end = Math.min(length, (last + 1) * stride);
    if (end - first >= sampleRate * minimumSeconds) {
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
    // A short isolated sound can be a single impact with no 40 ms tail.
    const minimumSeconds = buffer.duration < 2 ? .01 : .04;
    events = analyzeRecordedActions(Array.from({ length: buffer.numberOfChannels }, (_, ear) => buffer.getChannelData(ear)),
      buffer.sampleRate, minimumSeconds);
    cache.set(buffer, events);
  }
  return events;
}
