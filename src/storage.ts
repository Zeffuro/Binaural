import { parseSession, type Session } from './model';

export const presetStorageKey = 'binaural.presets.v1';
export interface PresetRevision { name: string; raw: unknown; index: number }
export interface PresetEntry extends PresetRevision { session: Session }
export interface PresetChange { before?: PresetRevision; after?: PresetRevision }
export class PresetConflict extends Error {
  constructor() { super('This preset changed in another tab. Review the library and try again.'); }
}

function inspectPresets(raw: unknown[]) {
  const entries = raw.flatMap((item, index): PresetEntry[] => {
    try {
      const session = parseSession(item);
      return [{ session, name: session.name, raw: item, index }];
    }
    catch { return []; }
  });
  return { raw, entries, damaged: raw.length - entries.length };
}

export function loadPresets() {
  const stored = localStorage.getItem(presetStorageKey);
  let raw: unknown;
  try { raw = stored === null ? [] : JSON.parse(stored); } catch { raw = undefined; }
  if (!Array.isArray(raw) || raw.length > 100) {
    throw new Error('Saved presets could not be read. The original library has been kept.');
  }
  return inspectPresets(raw);
}

export function withPresetLock<T>(task: () => T): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('This browser cannot safely save presets. You can export your session as JSON.'));
  return navigator.locks.request(presetStorageKey, task);
}

export function applyPresetChange({ before, after }: PresetChange) {
  const library = loadPresets();
  const name = (before ?? after)?.name;
  if (name === undefined) throw new Error('No preset was selected.');
  const matching = library.entries.filter(entry => entry.name === name);
  if (before) {
    const expected = JSON.stringify(before.raw);
    const match = matching.find(entry => JSON.stringify(entry.raw) === expected);
    if (!match || (after && matching.length !== 1)) throw new PresetConflict();
    library.raw.splice(match.index, 1, ...(after ? [after.raw] : []));
  }
  else if (matching.length) throw new PresetConflict();
  else if (after) library.raw.splice(Math.min(after.index, library.raw.length), 0, after.raw);
  if (library.raw.length > 100) throw new Error('Your library holds up to 100 presets. Delete one first.');
  const next = inspectPresets(library.raw);
  localStorage.setItem(presetStorageKey, JSON.stringify(library.raw));
  return next;
}

export function downloadPreset(session: Session): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${session.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'binaural'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
