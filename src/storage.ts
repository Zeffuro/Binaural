import { parseSession, type Session } from './model';

const KEY = 'binaural.presets.v1';
export function loadPresets(): Session[] {
  const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Saved preset library is invalid.');
  return raw.map(parseSession);
}
export function storePresets(presets: Session[]): void {
  if (presets.length > 100) throw new Error('Your library holds up to 100 presets. Delete one first.');
  localStorage.setItem(KEY, JSON.stringify(presets));
}
export function downloadPreset(session: Session): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${session.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'binaural'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
