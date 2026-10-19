export interface PeResource {
  type: number | string;
  id: number | string;
  language: number | string;
  data: Uint8Array;
}

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 4096;

export function readPeResources(input: ArrayBuffer | Uint8Array): PeResource[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = (detail: string): never => { throw new Error(`Invalid PE resources: ${detail}.`); };
  const range = (offset: number, length: number, limit = bytes.length): void => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
        offset > limit || length > limit - offset) fail('out-of-range data');
  };
  if (bytes.length > MAX_BYTES) fail('file exceeds 64 MiB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number): number => { range(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset: number): number => { range(offset, 4); return view.getUint32(offset, true); };
  range(0, 64);
  if (u16(0) !== 0x5a4d) fail('missing DOS signature');
  const pe = u32(60);
  range(pe, 24);
  if (u32(pe) !== 0x4550) fail('missing PE signature');
  const sectionCount = u16(pe + 6);
  if (sectionCount < 1 || sectionCount > 96) fail('unsupported section count');
  const optional = pe + 24, optionalSize = u16(pe + 20);
  range(optional, optionalSize);
  const magic = u16(optional);
  if (magic !== 0x10b && magic !== 0x20b) fail('unsupported optional header');
  const directoryOffset = magic === 0x10b ? 96 : 112;
  if (optionalSize < directoryOffset) fail('short optional header');
  const directoryCount = u32(optional + directoryOffset - 4);
  if (directoryCount > Math.floor((optionalSize - directoryOffset) / 8)) fail('invalid directory count');
  const sectionTable = optional + optionalSize;
  range(sectionTable, sectionCount * 40);
  const headerSize = u32(optional + 60);
  if (headerSize < sectionTable + sectionCount * 40 || headerSize > bytes.length) fail('invalid header size');
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const offset = sectionTable + index * 40;
    const virtualSize = u32(offset + 8), rva = u32(offset + 12);
    const size = u32(offset + 16), raw = u32(offset + 20);
    range(raw, size);
    if (rva + Math.max(size, virtualSize) > 0x100000000) fail('section RVA overflow');
    return { rva, size, raw, extent: Math.max(size, virtualSize) };
  });
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (section.extent && section.rva < headerSize) fail('section overlaps headers');
    if (sections.slice(0, index).some(other => section.extent && other.extent &&
        section.rva < other.rva + other.extent && other.rva < section.rva + section.extent)) {
      fail('overlapping section RVAs');
    }
  }
  const fileOffset = (rva: number, size: number): number => {
    if (rva + size > 0x100000000) fail('resource RVA overflow');
    const matches = sections.filter(section => rva >= section.rva &&
      rva - section.rva < section.size && size <= section.size - (rva - section.rva));
    const inHeaders = rva < headerSize && size <= headerSize - rva;
    if (matches.length + Number(inHeaders) !== 1) fail('unmapped or ambiguous resource RVA');
    return inHeaders ? rva : matches[0].raw + rva - matches[0].rva;
  };
  if (directoryCount < 3) return [];
  const resourceEntry = optional + directoryOffset + 16;
  const resourceRva = u32(resourceEntry), resourceSize = u32(resourceEntry + 4);
  if (!resourceRva && !resourceSize) return [];
  if (!resourceRva || resourceSize < 16 || resourceRva + resourceSize > 0x100000000) fail('invalid resource directory');
  fileOffset(resourceRva, resourceSize);
  const relative = (offset: number, size: number): number => {
    range(offset, size, resourceSize);
    return fileOffset(resourceRva + offset, size);
  };
  let entriesRead = 0, copiedBytes = 0, nameBytes = 0;
  const identifier = (value: number): number | string => {
    if (!(value & 0x80000000)) return value;
    const offset = value & 0x7fffffff;
    const length = u16(relative(offset, 2));
    const start = relative(offset + 2, length * 2);
    nameBytes += length * 2;
    if (nameBytes > MAX_BYTES) fail('excessive resource names');
    let result = '';
    for (let index = 0; index < length; index++) result += String.fromCharCode(u16(start + index * 2));
    return result;
  };
  const result: PeResource[] = [];
  const ancestors = new Set<number>();
  const visit = (offset: number, path: (number | string)[]): void => {
    if (ancestors.has(offset)) fail('cyclic resource directory');
    ancestors.add(offset);
    const table = relative(offset, 16);
    const named = u16(table + 12), count = named + u16(table + 14);
    entriesRead += count;
    if (entriesRead > MAX_ENTRIES) fail('more than 4096 resource entries');
    const entries = relative(offset + 16, count * 8);
    for (let index = 0; index < count; index++) {
      const name = u32(entries + index * 8), target = u32(entries + index * 8 + 4);
      if (Boolean(name & 0x80000000) !== (index < named)) fail('invalid named resource count');
      const next = [...path, identifier(name)];
      if (path.length < 2) {
        if (!(target & 0x80000000)) fail('resource leaf before language level');
        visit(target & 0x7fffffff, next);
      } else {
        if (target & 0x80000000) fail('resource tree exceeds three levels');
        const dataEntry = relative(target, 16);
        const rva = u32(dataEntry), size = u32(dataEntry + 4);
        copiedBytes += size;
        if (copiedBytes > MAX_BYTES) fail('resource output exceeds 64 MiB');
        const start = fileOffset(rva, size);
        result.push({ type: next[0], id: next[1], language: next[2], data: bytes.slice(start, start + size) });
      }
    }
    ancestors.delete(offset);
  };
  visit(0, []);
  return result;
}
