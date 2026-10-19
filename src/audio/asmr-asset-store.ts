export function createAsmrAssetStore(load: (id: string) => Promise<AudioBuffer>) {
  const buffers = new Map<string, AudioBuffer>(), pending = new Map<string, Promise<void>>();
  return {
    has: (id: string) => buffers.has(id),
    get: (id: string) => buffers.get(id),
    async prepare(ids: string[]) {
      await Promise.all([...new Set(ids)].map(id => {
        if (buffers.has(id)) return;
        const existing = pending.get(id); if (existing) return existing;
        const task = Promise.resolve().then(() => load(id)).then(buffer => { buffers.set(id, buffer); }).finally(() => pending.delete(id));
        pending.set(id, task); return task;
      }));
    },
  };
}

export function finishRecordedBuffer(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || buffer.duration > 60 || buffer.duration < .1) throw new Error('Invalid ASMR recording.');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  let combinedPeak = 0;
  for (let i = 0; i < buffer.length; i++) {
    let combined = 0; for (const channel of channels) { if (!Number.isFinite(channel[i])) throw new Error('Invalid ASMR samples.'); combined += Math.abs(channel[i]); }
    combinedPeak = Math.max(combinedPeak, combined);
  }
  const gain = combinedPeak ? Math.min(1, .7 / combinedPeak) : 1, edge = Math.round(buffer.sampleRate * .04);
  for (const channel of channels) for (let i = 0; i < channel.length; i++) {
    const fade = Math.min(1, i / edge, (channel.length - i - 1) / edge);
    channel[i] *= gain * Math.sin(fade * Math.PI / 2) ** 2;
  }
  return buffer;
}
