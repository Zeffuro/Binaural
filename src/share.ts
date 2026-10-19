import { parseSession, type Session } from './model';

const LIMIT = 16000;
export function sessionLink(session: Session): string {
  const value = parseSession(session);
  if (value.bwg) throw new Error('BWGen sequences use a JSON export because they are too large for a reliable share link.');
  const json = JSON.stringify({ ...value, version: 2, layers: value.layers.map(({ id: _id, ...layer }) => layer) });
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > 12000) throw new Error('This session is too large for a share link. Export JSON instead.');
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (encoded.length > LIMIT) throw new Error('This session is too large for a share link. Export JSON instead.');
  const url = new URL(location.href); url.hash = `session=${encoded}`; return url.href;
}

export function readSharedSession(hash = location.hash): Session | undefined {
  if (!hash.startsWith('#session=')) return;
  const value = hash.slice(9);
  if (!value || value.length > LIMIT || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('The shared session link is invalid or too large.');
  try {
    const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const session = parseSession(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(decoded, character => character.charCodeAt(0)))));
    if (session.bwg) throw new Error('Native program links are not supported.');
    return session;
  } catch { throw new Error('The shared session link is invalid.'); }
}
