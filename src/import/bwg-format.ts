export interface BwgPoint {
  value: number;
  position: number;
  flags: number;
  weight: number;
  symmetric: number;
}

export interface BwgCurve {
  mode: number;
  tracking: number;
  trackingConfig: number;
  trackingScale: number;
  trackingMin: number;
  trackingMax: number;
  trackingOption: number;
  channelMode: number;
  reserved: number[];
  points: BwgPoint[];
}

export interface BwgSegment {
  id: string;
  seconds: number;
  voices: number;
  repeats: number;
  curves: BwgCurve[];
  // Original 36-byte segment table entry, including unassigned settings.
  settings: number[];
}

export interface BwgPreset {
  name: string;
  description: string;
  creatorVersion: string;
  background: string;
  // Original fixed record bytes at standalone file offsets 398 through 1779.
  settings: number[];
  segments: BwgSegment[];
}

const SIGNATURE = 'BrainWave Generator File, created with version ';
export const MAX_BWG_BYTES = 8 * 1024 * 1024;

export function parseBwg(input: ArrayBuffer | Uint8Array): BwgPreset {
  return splitBwgRecords(input, false)[0].preset;
}

export interface BwgLibraryEntry {
  preset: BwgPreset;
  data: Uint8Array;
}

export function splitBwgRecords(input: ArrayBuffer | Uint8Array, library: boolean): BwgLibraryEntry[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = (detail: string): never => { throw new Error(`Cannot import BWGen file: ${detail}`); };
  if (bytes.length < 141 || bytes.length > MAX_BWG_BYTES) fail('invalid or excessive file size.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const decoder = new TextDecoder('windows-1252');
  const creator = u32(132);
  const minor = (creator >>> 8) & 255;
  if ((creator >>> 16) !== 3 || minor > 1) fail('unsupported creator version.');
  const signature = `${SIGNATURE}3.${minor}\r\n\x1a`;
  if (decoder.decode(bytes.subarray(0, signature.length)) !== signature || u32(128) !== 3) {
    fail('only intact BWGen 3.0/3.1 format revision 3 files are supported.');
  }
  const presets: BwgLibraryEntry[] = [];
  let record = 136;
  while (record < bytes.length) {
    if (record + 5 > bytes.length) fail('truncated record header.');
    const size = u32(record);
    if (size < 5 || record + size > bytes.length) fail('record length does not match the file.');
    if (!library && (record !== 136 || record + size !== bytes.length)) fail('the file does not contain a single preset record.');
    const type = bytes[record + 4];
    if (type === 1 && library) {
      if (size !== 5) fail('invalid separator record.');
    } else if (type === 0) {
      if (size < 1645) fail('truncated preset record.');
      const standalone = new Uint8Array(136 + size);
      standalone.set(bytes.subarray(0, 136));
      standalone.set(bytes.subarray(record, record + size), 136);
      presets.push({ preset: parseBwgPreset(standalone, `3.${minor}.${creator & 255}`), data: standalone });
    } else fail('unsupported record type.');
    record += size;
  }
  if (!presets.length) fail('the file contains no preset records.');
  return presets;
}

function parseBwgPreset(bytes: Uint8Array, creatorVersion: string): BwgPreset {
  const fail = (detail: string): never => { throw new Error(`Cannot import BWGen file: ${detail}`); };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const u16 = (offset: number): number => view.getUint16(offset, true);
  const decoder = new TextDecoder('windows-1252');
  const text = (offset: number, length: number): string => {
    const end = bytes.subarray(offset, offset + length).indexOf(0);
    if (end < 0) fail('unterminated text field.');
    return decoder.decode(bytes.subarray(offset, offset + end));
  };
  const name = text(141, 257).trim();
  if (!name) fail('missing preset name.');
  const count = u32(1312);
  if (count < 1 || count > 25) fail('invalid segment count.');
  const segments: BwgSegment[] = [];
  for (let i = 0; i < count; i++) {
    const duration = u32(420 + i * 36);
    const voices = bytes[416 + i * 36];
    const repeats = u32(424 + i * 36);
    if (duration < 1 || duration > 144000 || voices < 1 || voices > 10 || repeats < 1 || repeats > 10000) {
      fail(`invalid segment ${i + 1}.`);
    }
    segments.push({ id: String.fromCharCode(bytes[417 + i * 36]), seconds: duration * 0.6, voices, repeats, curves: [],
      settings: Array.from(bytes.subarray(416 + i * 36, 452 + i * 36)) });
  }
  const description = text(1780, Math.min(bytes.length - 1780, 65536));
  let offset = 1780 + bytes.subarray(1780).indexOf(0) + 1;
  for (const segment of segments) {
    for (let index = 0; index < 36 + 14 * segment.voices; index++) {
      if (offset + 24 > bytes.length) fail('truncated parameter header.');
      const points = bytes[offset];
      if (points < 2 || offset + 24 + points * 8 > bytes.length) fail('invalid or truncated parameter points.');
      const curve: BwgCurve = { mode: bytes[offset + 1], tracking: u16(offset + 2),
        trackingConfig: view.getInt32(offset + 4, true), trackingScale: view.getInt32(offset + 8, true),
        trackingMin: view.getInt32(offset + 12, true), trackingMax: view.getInt32(offset + 16, true),
        trackingOption: bytes[offset + 20], channelMode: bytes[offset + 21],
        reserved: Array.from(bytes.subarray(offset + 22, offset + 24)), points: [] };
      let previous = -1;
      for (let i = 0; i < points; i++) {
        const p = offset + 24 + i * 8;
        const position = u16(p + 4);
        if (position > 10000 || position < previous) fail('parameter times are not ordered.');
        if (bytes[p + 6] > 20 || bytes[p + 7] > 10) fail('invalid envelope shape data.');
        previous = position;
        curve.points.push({ value: view.getInt32(p, true), position, flags: u16(p + 6),
          weight: bytes[p + 6], symmetric: bytes[p + 7] });
      }
      if (curve.points[0].position !== 0 || previous !== 10000) fail('incomplete parameter timeline.');
      segment.curves.push(curve);
      offset += 24 + points * 8;
    }
  }
  if (offset !== bytes.length) fail('unexpected trailing data or an unsupported structure.');
  return { name, description, creatorVersion, background: text(1320, 260), segments,
    settings: Array.from(bytes.subarray(398, 1780)) };
}

