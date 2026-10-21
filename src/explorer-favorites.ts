import { ASMR_FAVORITES_KEY } from './asmr-library.ts';

export const EXPLORER_FAVORITES_KEY = 'binaural:explore-favorites:v1';

function ids(raw: string | null): string[] | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : undefined;
  } catch { return undefined; }
}

export function readExplorerFavorites(storage: Pick<Storage, 'getItem'>): Set<string> {
  const current = ids(storage.getItem(EXPLORER_FAVORITES_KEY));
  if (current) return new Set(current);
  return new Set((ids(storage.getItem(ASMR_FAVORITES_KEY)) ?? []).map(id => `asmr-${id}`));
}

export function saveExplorerFavorites(storage: Pick<Storage, 'setItem'>, favorites: ReadonlySet<string>): boolean {
  try { storage.setItem(EXPLORER_FAVORITES_KEY, JSON.stringify([...favorites])); return true; }
  catch { return false; }
}
