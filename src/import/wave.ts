export interface AudioSample {
  rate: number;
  channels: Float32Array[];
}

export function readPcmWave(input: ArrayBuffer | Uint8Array): AudioSample {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = (): never => { throw new Error('Unsupported or damaged WAV. Use uncompressed PCM (8/16/24/32-bit) or 32-bit float, mono or stereo.'); };
  if (bytes.length < 44 || bytes.length > 64 * 1024 * 1024) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, count: number): string => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) fail();
  let format: { code: number; channels: number; rate: number; bits: number; align: number } | undefined;
  let data: Uint8Array | undefined;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail();
    const size = view.getUint32(offset + 4, true), end = offset + 8 + size;
    if (end > bytes.length) fail();
    if (text(offset, 4) === 'fmt ') {
      if (format || size < 16) fail();
      format = { code: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true),
        rate: view.getUint32(offset + 12, true), align: view.getUint16(offset + 20, true), bits: view.getUint16(offset + 22, true) };
    }
    if (text(offset, 4) === 'data') {
      if (data) fail();
      data = bytes.subarray(offset + 8, end);
    }
    offset = end === bytes.length ? end : end + (size & 1);
    if (offset > bytes.length) fail();
  }
  if (!format || !data) fail();
  const { code, channels, rate, bits, align } = format!;
  if (![1, 2].includes(channels) || rate < 4000 || rate > 192000 || ![1, 3].includes(code) ||
      ![8, 16, 24, 32].includes(bits) || (code === 3 && bits !== 32) || align !== channels * bits / 8 ||
      !data!.length || data!.length % align) fail();
  const frames = data!.length / align;
  if (frames * channels > 16 * 1024 * 1024) throw new Error('WAV is too long for an imported background.');
  const pcm = new DataView(data!.buffer, data!.byteOffset, data!.length);
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const at = i * align + channel * bits / 8;
      let value: number;
      if (code === 3) value = pcm.getFloat32(at, true);
      else if (bits === 8) value = (pcm.getUint8(at) - 128) / 128;
      else if (bits === 16) value = pcm.getInt16(at, true) / 32768;
      else if (bits === 24) value = ((pcm.getUint8(at) | pcm.getUint8(at + 1) << 8 | pcm.getUint8(at + 2) << 16) << 8 >> 8) / 8388608;
      else value = pcm.getInt32(at, true) / 2147483648;
      if (!Number.isFinite(value) || Math.abs(value) > 1) fail();
      output[channel][i] = value;
    }
  }
  return { rate, channels: output };
}
