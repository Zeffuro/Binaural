export function makePeFixture(pe64 = false): {
  bytes: number[];
  offsets: { optional: number; section: number; directory: number; root: number; leaf: number; payload: number };
} {
  const optional = 0x98, optionalSize = pe64 ? 240 : 224;
  const section = optional + optionalSize, root = 0x200;
  const bytes = new Uint8Array(0x400), view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number): void => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number): void => view.setUint32(offset, value, true);
  u16(0, 0x5a4d); u32(60, 0x80); u32(0x80, 0x4550);
  u16(0x84, pe64 ? 0x8664 : 0x14c); u16(0x86, 1); u16(0x94, optionalSize);
  u16(optional, pe64 ? 0x20b : 0x10b); u32(optional + 60, 0x200);
  const directories = optional + (pe64 ? 112 : 96), directory = directories + 16;
  u32(directories - 4, 16); u32(directory, 0x1000); u32(directory + 4, 0x200);
  bytes.set([46, 114, 115, 114, 99], section);
  u32(section + 8, 0x200); u32(section + 12, 0x1000);
  u32(section + 16, 0x200); u32(section + 20, root);
  const name = (offset: number, text: string): number => {
    u16(root + offset, text.length);
    for (let index = 0; index < text.length; index++) u16(root + offset + 2 + index * 2, text.charCodeAt(index));
    return 0x80000000 + offset;
  };
  const table = (offset: number, named: number, entries: [number, number][]): void => {
    u16(root + offset + 12, named); u16(root + offset + 14, entries.length - named);
    entries.forEach(([id, target], index) => {
      u32(root + offset + 16 + index * 8, id); u32(root + offset + 20 + index * 8, target);
    });
  };
  table(0, 1, [[name(0xc0, 'WAVE'), 0x80000020], [10, 0x80000050]]);
  table(0x20, 0, [[1, 0x80000038]]);
  table(0x38, 0, [[1033, 0x80]]);
  table(0x50, 1, [[name(0xd0, 'Info'), 0x80000068]]);
  table(0x68, 1, [[name(0xe0, 'neutral'), 0x90]]);
  u32(root + 0x80, 0x1100); u32(root + 0x84, 48);
  u32(root + 0x90, 0x11fc); u32(root + 0x94, 4);
  const payload = root + 0x100;
  bytes.set([82, 73, 70, 70, 40, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32], payload);
  u32(payload + 16, 16); u16(payload + 20, 1); u16(payload + 22, 1);
  u32(payload + 24, 8000); u32(payload + 28, 16000); u16(payload + 32, 2); u16(payload + 34, 16);
  bytes.set([100, 97, 116, 97, 4, 0, 0, 0, 0, 0, 255, 127], payload + 36);
  bytes.set([1, 2, 3, 4], 0x3fc);
  return { bytes: Array.from(bytes), offsets: { optional, section, directory, root, leaf: root + 0x80, payload } };
}
