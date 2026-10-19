import { expect, test } from '@playwright/test';
import { makePeFixture } from './helpers/pe';

for (const pe64 of [false, true]) {
  test(`PE${pe64 ? '32+' : '32'} imports named and numeric resources without aliasing`, async ({ page }) => {
    await page.goto('/');
    const fixture = makePeFixture(pe64);
    const result = await page.evaluate(async ({ bytes: data, offsets }) => {
      const path = '/src/import/pe-resources.ts';
      const { readPeResources } = await import(path);
      const bytes = new Uint8Array(data), padded = new Uint8Array(bytes.length + 12);
      padded.set(bytes, 5);
      const resources = readPeResources(padded.subarray(5, 5 + bytes.length));
      const expected = bytes.slice(offsets.payload, offsets.payload + 48);
      const arrayBuffer = readPeResources(bytes.buffer);
      padded.fill(0); bytes.fill(0);
      const exact = resources[0].data.every((value: number, index: number) => value === expected[index]);
      resources[0].data.fill(0);
      return { exact, independent: arrayBuffer[0].data[0] === 82,
        resources: resources.map(({ type, id, language, data }: { type: number | string; id: number | string;
          language: number | string; data: Uint8Array }) => ({ type, id, language, length: data.length })),
        tail: Array.from(resources[1].data) };
    }, fixture);
    expect(result).toEqual({ exact: true, independent: true, tail: [1, 2, 3, 4], resources: [
      { type: 'WAVE', id: 1, language: 1033, length: 48 },
      { type: 10, id: 'Info', language: 'neutral', length: 4 },
    ] });
  });
}

for (const pe64 of [false, true]) {
test(`PE${pe64 ? '32+' : '32'} rejects truncated headers, malformed resource trees and invalid RVA ranges`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ bytes: data, offsets: o, pe64 }) => {
    const path = '/src/import/pe-resources.ts';
    const { readPeResources } = await import(path);
    const bytes = new Uint8Array(data), unexpected: string[] = [];
    const rejects = (label: string, input: Uint8Array): void => {
      try { readPeResources(input); unexpected.push(label); } catch { /* Expected malformed input. */ }
    };
    for (let end = 0; end < bytes.length; end++) rejects(`prefix ${end}`, bytes.subarray(0, end));
    const mutations: [string, number, number, boolean?][] = [
      ['DOS', 0, 0], ['PE', 0x80, 0], ['PE offset', 60, 0xffffffff],
      ['magic', o.optional, 0x999, true], ['optional size', 0x94, 8, true],
      ['section count', 0x86, 97, true], ['directory count', o.optional + (pe64 ? 108 : 92), 17],
      ['header size', o.optional + 60, 1], ['raw range', o.section + 20, 0xfffffff0],
      ['section RVA overflow', o.section + 12, 0xffffff00],
      ['section header overlap', o.section + 12, 0x100],
      ['resource RVA', o.directory, 0x5000], ['resource size', o.directory + 4, 0xffffffff],
      ['virtual tail', o.section + 16, 0x100], ['cycle', o.root + 20, 0x80000000],
      ['early leaf', o.root + 20, 0x80], ['fourth level', o.root + 0x4c, 0x80000000],
      ['directory target range', o.root + 20, 0x800001ff],
      ['leaf target range', o.root + 0x4c, 0x1ff],
      ['name range', o.root + 16, 0x800001ff], ['name length', o.root + 0xc0, 0xffff, true],
      ['named count', o.root + 12, 0, true], ['entry budget', o.root + 14, 4096, true],
      ['payload RVA', o.leaf, 0x5000], ['payload overflow', o.leaf, 0xfffffff0],
      ['payload length', o.leaf + 4, 0xffffffff], ['payload raw boundary', o.leaf + 4, 0x101],
    ];
    for (const [label, offset, value, short] of mutations) {
      const altered = bytes.slice(), view = new DataView(altered.buffer);
      if (short) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
      rejects(label, altered);
    }
    rejects('input limit', new Uint8Array(64 * 1024 * 1024 + 1));
    const absent = bytes.slice(), view = new DataView(absent.buffer);
    view.setUint32(o.directory, 0, true); view.setUint32(o.directory + 4, 0, true);
    const noDirectory = readPeResources(absent).length;
    view.setUint32(o.optional + (pe64 ? 108 : 92), 2, true);
    return { unexpected, noDirectory, fewerDirectories: readPeResources(absent).length };
  }, { ...makePeFixture(pe64), pe64 });
  expect(result).toEqual({ unexpected: [], noDirectory: 0, fewerDirectories: 0 });
});
}

test('PE resources can contain data in another section and reject ambiguous mappings', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ bytes: data, offsets: o }) => {
    const path = '/src/import/pe-resources.ts';
    const { readPeResources } = await import(path);
    const bytes = new Uint8Array(data.length + 4); bytes.set(data); bytes.set([9, 8, 7, 6], data.length);
    const view = new DataView(bytes.buffer), section = o.section + 40;
    view.setUint16(0x86, 2, true);
    view.setUint32(section + 8, 4, true); view.setUint32(section + 12, 0x2000, true);
    view.setUint32(section + 16, 4, true); view.setUint32(section + 20, data.length, true);
    view.setUint32(o.leaf, 0x2000, true); view.setUint32(o.leaf + 4, 4, true);
    const external = Array.from(readPeResources(bytes)[0].data);
    view.setUint32(section + 12, 0x1100, true);
    let overlap = false;
    try { readPeResources(bytes); } catch { overlap = true; }
    return { external, overlap };
  }, makePeFixture());
  expect(result).toEqual({ external: [9, 8, 7, 6], overlap: true });
});
