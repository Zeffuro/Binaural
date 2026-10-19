import { frequencies, type Frequency } from './catalog';

const storageKey = 'binaural.frequency.favorites';
export const frequencyKey = (frequency: Frequency): string => `${frequency.kind}:${frequency.hz}`;

export function favoriteFrequencies(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const known = new Set(frequencies.map(frequencyKey));
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && known.has(item)) : []);
  } catch { return new Set(); }
}

export function toggleFrequencyFavorite(index: number): boolean {
  const frequency = frequencies[index];
  if (!frequency) throw new Error('This frequency is no longer available.');
  const favorites = favoriteFrequencies(), key = frequencyKey(frequency);
  const selected = !favorites.has(key);
  if (selected) favorites.add(key); else favorites.delete(key);
  localStorage.setItem(storageKey, JSON.stringify([...favorites]));
  return selected;
}

export function isFrequencyFavoriteStorage(key: string | null): boolean { return key === storageKey || key === null; }
