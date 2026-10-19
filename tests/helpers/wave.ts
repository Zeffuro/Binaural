import { makePeFixture } from './pe';

export function makeWaveFixture(options: { bits?: number; float?: boolean; channels?: number;
    rate?: number; odd?: boolean; auxiliary?: boolean } = {}): { bytes: number[]; expected: number[][];
    offsets: { fmt: number; data: number; dataSize: number } } {
  const bits = options.bits ?? 16, channels = options.channels ?? 1, rate = options.rate ?? 20000;
  const frames = options.odd ? 3 : 5, width = bits / 8, align = channels * width;
  const fmt = 20 + (options.auxiliary ? 12 : 0), data = fmt + 24;
  const dataSize = frames * align;
  const bytes = new Uint8Array(data + dataSize), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => bytes.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  if (options.auxiliary) { text(12, 'JUNK'); view.setUint32(16, 3, true); bytes.set([1, 2, 3], 20); }
  text(fmt - 8, 'fmt '); view.setUint32(fmt - 4, 16, true);
  view.setUint16(fmt, options.float ? 3 : 1, true); view.setUint16(fmt + 2, channels, true);
  view.setUint32(fmt + 4, rate, true); view.setUint32(fmt + 8, rate * align, true);
  view.setUint16(fmt + 12, align, true); view.setUint16(fmt + 14, bits, true);
  text(data - 8, 'data'); view.setUint32(data - 4, dataSize, true);
  const expected = Array.from({ length: channels }, () => [] as number[]);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = [-1, -0.5, 0, 0.5, 1 - 2 ** (1 - bits)][(frame + channel * 2) % 5];
      const at = data + frame * align + channel * width;
      if (options.float) view.setFloat32(at, value, true);
      else if (bits === 8) view.setUint8(at, value * 128 + 128);
      else if (bits === 16) view.setInt16(at, value * 32768, true);
      else if (bits === 24) {
        const encoded = value * 8388608;
        bytes.set([encoded & 255, encoded >> 8 & 255, encoded >> 16 & 255], at);
      } else view.setInt32(at, value * 2147483648, true);
      expected[channel].push(Math.fround(value));
    }
  }
  return { bytes: Array.from(bytes), expected, offsets: { fmt, data, dataSize } };
}

export function makeWavePack(waves = Array.from({ length: 6 }, () => makeWaveFixture().bytes),
    ids = waves.map((_, index) => index + 1)): number[] {
  const base = makePeFixture(), root = base.offsets.root;
  const payload = 0x200, length = root + payload + waves.reduce((sum, wave) => sum + wave.length + (4 - wave.length % 4) % 4, 0);
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  bytes.set(base.bytes.slice(0, root));
  const u16 = (offset: number, value: number): void => view.setUint16(root + offset, value, true);
  const u32 = (offset: number, value: number): void => view.setUint32(root + offset, value, true);
  view.setUint32(base.offsets.directory + 4, length - root, true);
  view.setUint32(base.offsets.section + 8, length - root, true);
  view.setUint32(base.offsets.section + 16, length - root, true);
  u16(14, 1); u32(16, 10); u32(20, 0x80000018);
  u16(0x18 + 14, waves.length);
  let offset = payload;
  waves.forEach((wave, index) => {
    const language = 0x70 + index * 24, leaf = 0x140 + index * 16;
    u32(0x28 + index * 8, ids[index]); u32(0x2c + index * 8, 0x80000000 + language);
    u16(language + 14, 1); u32(language + 16, 1033); u32(language + 20, leaf);
    u32(leaf, 0x1000 + offset); u32(leaf + 4, wave.length);
    bytes.set(wave, root + offset); offset += wave.length + (4 - wave.length % 4) % 4;
  });
  return Array.from(bytes);
}
