export interface AsmrLibraryEntry {
  id: string;
  name: string;
  description: string;
  group: string;
  sounds: string[];
  search: string;
}

export const ASMR_FAVORITES_KEY = 'binaural:asmr-favorites:v1';

export function createAsmrLibrary(
  presets: readonly { id: string; name: string; description: string; group?: string; make: () => { layers: readonly { sound: string }[] } }[],
  sounds: readonly { id: string; name: string; description: string }[],
): AsmrLibraryEntry[] {
  return presets.map(preset => {
    const sources = [...new Set(preset.make().layers.map(layer => layer.sound))]
      .map(id => sounds.find(sound => sound.id === id)).filter(sound => sound !== undefined);
    const group = preset.group ?? 'Layered mixes';
    return { id: preset.id, name: preset.name, description: preset.description, group,
      sounds: sources.map(sound => sound.name),
      search: [preset.name, preset.description, group, ...sources.flatMap(sound => [sound.name, sound.description])].join(' ').toLocaleLowerCase(),
    };
  });
}

export function filterAsmrLibrary(entries: readonly AsmrLibraryEntry[], query: string, group: string, favorites: ReadonlySet<string>): AsmrLibraryEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (group === 'all' || (group === 'favorites' ? favorites.has(entry.id) : entry.group === group))
    && terms.every(term => entry.search.includes(term)));
}

export function parseAsmrFavorites(raw: string | null, entries: readonly Pick<AsmrLibraryEntry, 'id'>[]): Set<string> {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return new Set();
    const known = new Set(entries.map(entry => entry.id));
    return new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)));
  } catch { return new Set(); }
}

export function saveAsmrFavorites(storage: Pick<Storage, 'setItem'>, favorites: ReadonlySet<string>): boolean {
  try { storage.setItem(ASMR_FAVORITES_KEY, JSON.stringify([...favorites])); return true; }
  catch { return false; }
}
