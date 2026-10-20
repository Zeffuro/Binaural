export const WAV_SAMPLE_RATE = 44100;
export const WAV_FRAME_BYTES = 4;
export const WAV_HEADER_BYTES = 44;
export const MAX_EXPORT_SECONDS = 3600;
export const MAX_FILE_EXPORT_SECONDS = 10800;

export function wavFrames(seconds: number, maximum = MAX_EXPORT_SECONDS): number {
  if (!Number.isFinite(seconds) || seconds < .05 || seconds > maximum) {
    throw new Error(`Choose an export duration from 0.05 to ${maximum} seconds.`);
  }
  const frames = Math.round(seconds * WAV_SAMPLE_RATE);
  if (!Number.isSafeInteger(frames) || frames * WAV_FRAME_BYTES > 0xffffffff - 36) throw new Error('This duration exceeds the WAV file size limit.');
  return frames;
}

export function wavBytes(seconds: number): number {
  return WAV_HEADER_BYTES + wavFrames(seconds, MAX_FILE_EXPORT_SECONDS) * WAV_FRAME_BYTES;
}

export function wavHeader(frames: number): ArrayBuffer {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames * WAV_FRAME_BYTES > 0xffffffff - 36) throw new Error('Invalid WAV frame count.');
  const bytes = new ArrayBuffer(WAV_HEADER_BYTES), view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * WAV_FRAME_BYTES, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true); view.setUint32(28, WAV_SAMPLE_RATE * WAV_FRAME_BYTES, true);
  view.setUint16(32, WAV_FRAME_BYTES, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, frames * WAV_FRAME_BYTES, true);
  return bytes;
}

export function wavPcm(left: Float32Array, right: Float32Array, first = 0, frames = left.length - first): ArrayBuffer {
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(frames) || first < 0 || frames < 0 ||
      first + frames > left.length || first + frames > right.length) throw new Error('Invalid WAV audio section.');
  const bytes = new ArrayBuffer(frames * WAV_FRAME_BYTES), view = new DataView(bytes);
  for (let frame = 0; frame < frames; frame++) for (let ear = 0; ear < 2; ear++) {
    const sample = (ear ? right : left)[first + frame];
    if (!Number.isFinite(sample)) throw new Error('The audio renderer produced invalid samples.');
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(frame * WAV_FRAME_BYTES + ear * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
