export function makeBwgFixture(segments = [{ voices: 1, length: 10, repeats: 1 }],
    envelopes: Record<number, { value: number; position: number; weight?: number }[]> = {}): number[] {
  const size = 1781 + segments.reduce((sum, segment) => sum + Array.from({ length: 36 + 14 * segment.voices },
    (_, curve) => 24 + (envelopes[curve]?.length ?? 2) * 8).reduce((a, b) => a + b, 0), 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string): void => { bytes.set(new TextEncoder().encode(text), offset); };
  write(0, 'BrainWave Generator File, created with version 3.1\r\n\x1a');
  view.setUint32(128, 3, true);
  view.setUint32(132, 0x030109, true);
  view.setUint32(136, size - 136, true);
  write(141, 'Synthetic compatibility fixture');
  view.setUint32(1312, segments.length, true);
  let offset = 1781;
  for (const [index, segment] of segments.entries()) {
    bytes[416 + index * 36] = segment.voices;
    bytes[417 + index * 36] = 65 + index;
    view.setUint32(420 + index * 36, segment.length * 100, true);
    view.setUint32(424 + index * 36, segment.repeats, true);
    for (let curve = 0; curve < 36 + 14 * segment.voices; curve++) {
      const voiceParameter = curve < 36 ? -1 : (curve - 36) % 14;
      const linked = [2, 4, 6, 8, 10, 12].includes(voiceParameter);
      const values = [10000, 40000, 40000, 5000, 5000, 32768500, 32768500, 2000, 2000, 0, 0, 500000, 500000, 0];
      const points = envelopes[curve] ?? [
        { value: values[voiceParameter] ?? 0, position: 0 },
        { value: values[voiceParameter] ?? 0, position: 10000 },
      ];
      bytes[offset] = points.length;
      bytes[offset + 1] = linked ? 1 : 0;
      view.setUint16(offset + 2, linked ? curve - 1 : 0, true);
      view.setUint32(offset + 8, 1000, true);
      view.setInt32(offset + 16, ({ 2: 20000, 4: 100, 6: 100, 8: 20, 10: 100, 12: 10000 } as Record<number, number>)[voiceParameter] ?? 0, true);
      for (const [index, point] of points.entries()) {
        view.setInt32(offset + 24 + index * 8, point.value, true);
        view.setUint16(offset + 28 + index * 8, point.position, true);
        view.setUint16(offset + 30 + index * 8, 0x0100 | (point.weight ?? 10), true);
      }
      offset += 24 + points.length * 8;
    }
  }
  return Array.from(bytes);
}


