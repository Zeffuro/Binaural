import { makeBwgFixture } from './bwg';

export function makeBwgLibraryFixture(): { bytes: number[]; boundaries: number[] } {
  const first = new Uint8Array(makeBwgFixture([{ voices: 1, length: 1, repeats: 1000 }], {
    36: [{ value: 3000, position: 0, weight: 2 }, { value: 9000, position: 10000 }],
  }));
  const second = new Uint8Array(makeBwgFixture([{ voices: 2, length: 0.5, repeats: 2 },
    { voices: 1, length: 2, repeats: 3 }]));
  first.fill(0, 141, 398);
  second.fill(0, 141, 398);
  first.set(new TextEncoder().encode('Original sequence A'), 141);
  second.set(new TextEncoder().encode('Original sequence B'), 141);
  first[398] = 13;
  first[1779] = 27;
  first[1781 + 36 * 40 + 22] = 71;
  first[1781 + 36 * 40 + 31] = 10;
  const view = new DataView(first.buffer);
  view.setInt32(1781 + 36 * 40 + 4, -1500, true);
  view.setInt32(1781 + 36 * 40 + 8, -500, true);
  const separator = new Uint8Array([5, 0, 0, 0, 1]);
  const bytes = new Uint8Array(first.length + second.length - 136 + separator.length);
  bytes.set(first);
  bytes.set(separator, first.length);
  bytes.set(second.subarray(136), first.length + separator.length);
  return { bytes: Array.from(bytes), boundaries: [first.length, first.length + separator.length] };
}
