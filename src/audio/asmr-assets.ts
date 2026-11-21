import { recordedAsmrSounds, type AsmrSettings } from '../asmr-state';
import { createAsmrAssetStore, finishRecordedBuffer } from './asmr-asset-store';
import { preparedQuietClicks, prepareQuietClicks } from './quiet-click-clips';
import { quietClickRecordings } from '../asmr-spatial';

const recordings = createAsmrAssetStore(async id => {
  const sound = recordedAsmrSounds.find(sound => sound.id === id);
  if (!sound) throw new Error('Unknown ASMR recording.');
  const maxBytes = 'maxBytes' in sound ? sound.maxBytes : 2 * 1024 * 1024;
  const timeout = 'maxBytes' in sound ? 25000 : 12000;
  const response = await fetch(`${import.meta.env.BASE_URL}audio/asmr/${sound.file}`, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Could not load ${sound.name}. Try again when the app is fully available offline or online.`);
  if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('ASMR recording is too large.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error('ASMR recording is too large.');
  const context = new OfflineAudioContext(2, 1, 44100);
  return finishRecordedBuffer(await context.decodeAudioData(bytes));
});
const ids = (settings?: AsmrSettings) => settings?.layers.filter(layer => recordedAsmrSounds.some(sound => sound.id === layer.sound)).map(layer => layer.sound) ?? [];
const clickIds = (settings?: AsmrSettings) => settings?.layers.flatMap(layer => quietClickRecordings(layer.sound, layer.spatial?.quietReturn)) ?? [];
export const asmrRecordingsReady = (settings?: AsmrSettings) =>
  ids(settings).every(id => recordings.has(id)) && clickIds(settings).every(id => {
    const buffer = recordings.get(id);
    return !!(buffer && preparedQuietClicks(buffer));
  });

export async function prepareAsmrRecordings(settings?: AsmrSettings): Promise<void> {
  const clicks = [...new Set(clickIds(settings))];
  await recordings.prepare([...ids(settings), ...clicks]);
  for (const id of clicks) {
    const buffer = recordings.get(id);
    if (!buffer) throw new Error('The ASMR recording is still loading.');
    prepareQuietClicks(buffer);
    if (!preparedQuietClicks(buffer)) {
      const name = recordedAsmrSounds.find(sound => sound.id === id)?.name ?? 'this recording';
      throw new Error(`No isolated clicks were found in ${name}. Try a different recording or turn off closest-point timing.`);
    }
  }
}

export function recordedQuietClickBanks(sources: string[]) {
  return sources.map(id => {
    const buffer = recordings.get(id), bank = buffer && preparedQuietClicks(buffer);
    if (!bank) throw new Error('The isolated clicks are still loading.');
    return bank;
  });
}
export const recordedAsmrBuffer = (id: string) => recordings.get(id);
