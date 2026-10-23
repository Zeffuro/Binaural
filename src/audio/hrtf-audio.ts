import type { AsmrSettings } from '../asmr-state';
import type { HrtfProfile } from '../hrtf-profiles';
import { decodeHrtfPack, resampleHrtfPack, type HrtfPack } from './hrtf-pack';
import workletUrl from './hrtf-worklet.ts?worker&url';

const packs = new Map<string, HrtfPack>(), pendingPacks = new Map<string, Promise<HrtfPack>>();
const prepared = new WeakSet<BaseAudioContext>(), pendingModules = new WeakMap<BaseAudioContext, Promise<void>>();
const contextPacks = new WeakMap<BaseAudioContext, Map<HrtfProfile, HrtfPack>>();
const selected = (settings?: AsmrSettings): HrtfProfile[] => [...new Set(settings?.layers.flatMap(layer => layer.spatial?.profile ? [layer.spatial.profile] : []) ?? [])];
const key = (profile: HrtfProfile, rate: number) => `${profile}-${rate}`;

function ensureOpen(context: BaseAudioContext): void {
  if (context.state !== 'closed') return;
  prepared.delete(context); contextPacks.delete(context);
  throw new DOMException('HRTF profile preparation was cancelled.', 'AbortError');
}

async function loadPack(profile: HrtfProfile, rate: number): Promise<HrtfPack> {
  const id = key(profile, rate), cached = packs.get(id);
  if (cached) return cached;
  let task = pendingPacks.get(id);
  if (!task) {
    task = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const base = `${import.meta.env.BASE_URL}audio/hrtf/${id}`;
        const [manifestResponse, binaryResponse] = await Promise.all([
          fetch(`${base}.json`, { signal: controller.signal }), fetch(`${base}.bin`, { signal: controller.signal }),
        ]);
        if (!manifestResponse.ok || !binaryResponse.ok) throw new Error('HRTF profile could not be loaded. Please try again.');
        const [json, binary] = await Promise.all([manifestResponse.text(), binaryResponse.arrayBuffer()]);
        if (json.length > 200_000 || binary.byteLength > 2_200_000) throw new Error('HRTF profile exceeds its size limit.');
        const metadata = JSON.parse(json), pack = decodeHrtfPack(profile, rate, metadata, binary);
        const digest = await crypto.subtle.digest('SHA-256', binary);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== metadata.sha256) throw new Error('HRTF profile integrity check failed.');
        packs.set(id, pack);
        return pack;
      } finally { clearTimeout(timeout); }
    })().finally(() => pendingPacks.delete(id));
    pendingPacks.set(id, task);
  }
  return task;
}

export function hrtfAudioReady(context: BaseAudioContext, settings?: AsmrSettings): boolean {
  const profiles = selected(settings);
  return !profiles.length || context.state !== 'closed' && prepared.has(context) && profiles.every(profile => contextPacks.get(context)?.has(profile));
}

async function ratePack(profile: HrtfProfile, rate: number): Promise<HrtfPack> {
  const id = key(profile, rate), cached = packs.get(id);
  if (cached) return cached;
  if (rate === 44100 || rate === 48000) return loadPack(profile, rate);
  let task = pendingPacks.get(id);
  if (!task) {
    task = loadPack(profile, 48000).then(base => {
      const pack = resampleHrtfPack(base, rate); packs.set(id, pack);
      while (packs.size > 12) {
        const oldest = [...packs.keys()].find(value => !value.endsWith('-44100') && !value.endsWith('-48000'));
        if (!oldest) break;
        packs.delete(oldest);
      }
      return pack;
    }).finally(() => pendingPacks.delete(id));
    pendingPacks.set(id, task);
  }
  return task;
}

export async function prepareHrtfAudio(context: BaseAudioContext, settings?: AsmrSettings): Promise<void> {
  const profiles = selected(settings);
  if (!profiles.length) return;
  ensureOpen(context);
  if (!Number.isInteger(context.sampleRate) || context.sampleRate < 22050 || context.sampleRate > 96000) {
    throw new Error('HRTF profiles support audio sample rates from 22050 to 96000 Hz.');
  }
  let available = contextPacks.get(context);
  if (!available) { available = new Map(); contextPacks.set(context, available); }
  try {
    await Promise.all(profiles.map(async profile => {
      if (available.has(profile)) return;
      const pack = await ratePack(profile, context.sampleRate);
      ensureOpen(context); available.set(profile, pack);
    }));
  } catch (error) { ensureOpen(context); throw error; }
  ensureOpen(context);
  if (prepared.has(context)) return;
  let task = pendingModules.get(context);
  if (!task) {
    task = (async () => {
      try { await context.audioWorklet.addModule(workletUrl); }
      catch (error) { ensureOpen(context); throw error; }
      ensureOpen(context); prepared.add(context);
    })().finally(() => pendingModules.delete(context));
    pendingModules.set(context, task);
  }
  await task;
  ensureOpen(context);
}

export function preparedHrtfPack(context: BaseAudioContext, profile: HrtfProfile): HrtfPack {
  ensureOpen(context);
  const pack = contextPacks.get(context)?.get(profile);
  if (!pack || !prepared.has(context)) throw new Error('HRTF profile is not prepared.');
  return pack;
}
