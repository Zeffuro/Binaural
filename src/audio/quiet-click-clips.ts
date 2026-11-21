import { analyzeRecordedActions } from './asmr-recorded-markers';

export const quietClickTailSeconds = .30;
const leadLimit = .20;
const cache = new WeakMap<AudioBuffer, QuietClickBank | null>();

export interface QuietClickBank {
  sampleRate: number;
  clips: readonly Float32Array[];
}

export function extractQuietClicks(channels: readonly Float32Array[], sampleRate: number): QuietClickBank {
  const length = channels[0]?.length ?? 0;
  if (!length || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      channels.length > 2 || channels.some(channel => channel.length !== length)) return { sampleRate, clips: [] };
  const mono = channels.length === 1 ? channels[0] : new Float32Array(length);
  if (channels.length === 2) {
    const [left, right] = channels;
    for (let frame = 0; frame < length; frame++) mono[frame] = .5 * (left[frame] + right[frame]);
  }
  const lead = Math.round(.014 * sampleRate), tail = Math.round(.036 * sampleRate);
  const edge = Math.max(1, Math.round(.004 * sampleRate));
  const findSpans = (onsetRatio: number, releaseRatio: number) => {
    const events = analyzeRecordedActions([mono], sampleRate, .001,
      { strideSeconds: .003, gapSeconds: .035, onsetRatio, releaseRatio });
    return events.flatMap((event, index) => {
      const { stride, values } = event.contact!;
      let peak = 0;
      for (let i = 1; i < values.length; i++) if (values[i] > values[peak]) peak = i;
      const attack = event.start + (peak + .5) * stride;
      const previous = events[index - 1], next = events[index + 1];
      const first = Math.max(event.start - lead, previous ? previous.start + previous.length : 0);
      const last = Math.min(event.start + event.length + tail, next?.start ?? length);
      if (attack - first > leadLimit * sampleRate || last - attack > quietClickTailSeconds * sampleRate) return [];
      return [{ first, last }];
    });
  };
  const quietSpans = findSpans(.1, .028);
  const spans = quietSpans.length ? quietSpans : findSpans(.24, .085);
  const count = Math.min(16, spans.length);
  const clips = Array.from({ length: count }, (_, index) => {
    const { first, last } = spans[count === 1 ? 0 : Math.round(index * (spans.length - 1) / (count - 1))];
    const clip = mono.slice(first, last);
    for (let frame = 0; frame < clip.length; frame++) {
      const fade = Math.min(1, frame / edge, (clip.length - 1 - frame) / edge);
      clip[frame] *= fade * fade * (3 - 2 * fade);
    }
    return clip;
  });
  return { sampleRate, clips };
}

export function preparedQuietClicks(buffer: AudioBuffer): QuietClickBank | null | undefined { return cache.get(buffer); }

export function prepareQuietClicks(buffer: AudioBuffer): void {
  if (!cache.has(buffer)) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const bank = extractQuietClicks(channels, buffer.sampleRate);
    cache.set(buffer, bank.clips.length ? bank : null);
  }
}
