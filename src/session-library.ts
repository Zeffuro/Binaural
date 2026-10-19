import type { Session } from './model';

interface LibraryPreferences { favorites: string[]; recent: string[] }
const key = 'binaural.library.preferences';
export function libraryPreferences(): LibraryPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    const list = (input: unknown) => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && item.length <= 80).slice(0, 100) : [];
    return { favorites: list(value.favorites), recent: list(value.recent) };
  } catch { return { favorites: [], recent: [] }; }
}
export function favoritePreset(name: string): void {
  const data = libraryPreferences();
  data.favorites = data.favorites.includes(name) ? data.favorites.filter(item => item !== name) : [...data.favorites, name].slice(-100);
  localStorage.setItem(key, JSON.stringify(data));
}
export function rememberPreset(name: string): void {
  const data = libraryPreferences(); data.recent = [name, ...data.recent.filter(item => item !== name)].slice(0, 10);
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Playback remains available without storage. */ }
}
export function copyName(name: string, saved: Session[]): string {
  for (let index = 1; index <= 101; index++) {
    const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
    const candidate = name.slice(0, 80 - suffix.length) + suffix;
    if (!saved.some(item => item.name === candidate)) return candidate;
  }
  throw new Error('No unused copy name is available.');
}
export function chooseSaveAction(name: string): Promise<'replace' | 'copy' | undefined> {
  const dialog = document.createElement('dialog'); dialog.className = 'explorer-dialog save-dialog';
  dialog.setAttribute('aria-label', 'Save preset');
  const title = document.createElement('h2'); title.textContent = `“${name}” already exists`;
  dialog.append(title);
  const text = document.createElement('p'); text.textContent = 'Replace it or save a separate copy.'; dialog.append(text);
  return new Promise(resolve => {
    for (const [label, action] of [['Save copy', 'copy'], ['Replace preset', 'replace'], ['Cancel', undefined]] as const) {
      const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = label;
      button.addEventListener('click', () => { resolve(action); dialog.close(); }); dialog.append(button);
    }
    dialog.addEventListener('close', () => { dialog.remove(); resolve(undefined); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
