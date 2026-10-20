export const FLAC_SAMPLE_RATE = 44100;
export const FLAC_HEADER_BYTES = 42;
export const FLAC_MAX_CHUNK_FRAMES = FLAC_SAMPLE_RATE * 30;
export const FLAC_MAX_TOTAL_FRAMES = FLAC_SAMPLE_RATE * 10800;

export type FlacExportRequest = { type: 'init'; totalFrames: number } |
  { type: 'encode'; id: number; left: Float32Array; right: Float32Array } | { type: 'finish'; id: number };
export type FlacExportResponse = { type: 'ready' } | { type: 'error'; message: string } |
  { type: 'encoded'; id: number; data: ArrayBuffer } | { type: 'finished'; id: number; data: ArrayBuffer; header: ArrayBuffer };

export function validateFlacFrames(frames: number): void {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > FLAC_MAX_TOTAL_FRAMES) {
    throw new RangeError('Invalid FLAC export frame count.');
  }
}

export function validateFlacPcm(left: Float32Array, right: Float32Array, remaining: number): void {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length ||
      left.length < 1 || left.length > FLAC_MAX_CHUNK_FRAMES || left.length > remaining) {
    throw new RangeError('Invalid FLAC audio section.');
  }
  if (!left.every(Number.isFinite) || !right.every(Number.isFinite)) throw new Error('The audio renderer produced invalid samples.');
}

export function validateFlacHeader(header: ArrayBuffer, frames: number): void {
  if (!(header instanceof ArrayBuffer) || header.byteLength !== FLAC_HEADER_BYTES) throw new Error('Invalid FLAC stream header.');
  const bytes = new Uint8Array(header), view = new DataView(header);
  const total = (bytes[21] & 15) * 0x100000000 + view.getUint32(22);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'fLaC' || (bytes[4] & 127) !== 0 ||
      bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 34 || total !== frames ||
      (view.getUint32(18) >>> 12) !== FLAC_SAMPLE_RATE || ((bytes[20] >> 1) & 7) !== 1 ||
      (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) !== 15) throw new Error('Invalid FLAC stream header.');
}
