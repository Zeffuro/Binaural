import { type BwgLibraryEntry, type BwgPreset, splitBwgRecords } from './bwg-format';

export function splitBwgLibrary(input: ArrayBuffer | Uint8Array): BwgLibraryEntry[] {
  return splitBwgRecords(input, true);
}

export function parseBwgLibrary(input: ArrayBuffer | Uint8Array): BwgPreset[] {
  return splitBwgLibrary(input).map(entry => entry.preset);
}
