import { recordedAsmrSounds, type AsmrSettings } from '../asmr-state';
import { createAsmrAssetStore, finishRecordedBuffer } from './asmr-asset-store';

const recordings = createAsmrAssetStore(async id => {
  const sound = recordedAsmrSounds.find(sound => sound.id === id);
  if (!sound) throw new Error('Unknown ASMR recording.');
  const response = await fetch(`${import.meta.env.BASE_URL}audio/asmr/${sound.file}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Could not load ${sound.name}. Try again when the app is fully available offline or online.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('ASMR recording is too large.');
  const context = new OfflineAudioContext(2, 1, 44100);
  return finishRecordedBuffer(await context.decodeAudioData(bytes));
});
const ids = (settings?: AsmrSettings) => settings?.layers.filter(layer => recordedAsmrSounds.some(sound => sound.id === layer.sound)).map(layer => layer.sound) ?? [];
export const asmrRecordingsReady = (settings?: AsmrSettings) => ids(settings).every(id => recordings.has(id));
export const prepareAsmrRecordings = (settings?: AsmrSettings) => recordings.prepare(ids(settings));
export const recordedAsmrBuffer = (id: string) => recordings.get(id);
