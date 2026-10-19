import { backgroundReference, packEntries, type BackgroundSource } from './import/bwg-background';
import type { BwgPreset } from './import/bwg-format';
import { readPeResources } from './import/pe-resources';
import { readPcmWave, type AudioSample } from './import/wave';
import { makeGeneratedBackground } from './audio/generated-backgrounds';

interface BackgroundAsset { key: string; name: string; source: string; data: ArrayBuffer }
export interface BoundBackground { sample: AudioSample; interval: boolean; name: string; kind?: 'recording' | 'generated' }

export class BackgroundAssets {
  private records = new Map<string, BackgroundAsset>();
  private decoded = new Map<string, AudioSample>();
  private database?: IDBDatabase;
  readonly ready: Promise<void>;
  get persistent(): boolean { return !!this.database; }
  get count(): number { return this.records.size; }

  constructor() { this.ready = this.open(); }

  private async open(): Promise<void> {
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('binaural.backgrounds.v1', 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('clips', { keyPath: 'key' }); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Background storage is blocked.'));
      });
      const entries = await new Promise<BackgroundAsset[]>((resolve, reject) => {
        const request = this.database!.transaction('clips').objectStore('clips').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const asset of entries) {
        if (typeof asset.key === 'string' && typeof asset.name === 'string' && asset.data instanceof ArrayBuffer &&
            asset.data.byteLength <= 64 * 1024 * 1024) this.records.set(asset.key, asset);
      }
    } catch { this.database?.close(); this.database = undefined; }
  }

  async bindWave(preset: BwgPreset, file: File): Promise<void> {
    const reference = backgroundReference(preset);
    if (!reference) throw new Error('This preset has no recorded background to bind.');
    const data = await this.readFile(file);
    readPcmWave(data);
    await this.save([{ key: reference.key, name: file.name, source: file.name, data }]);
  }

  async importPack(file: File): Promise<number> {
    const entries = packEntries(file.name);
    const resources = readPeResources(await this.readFile(file));
    const assets = entries.map(entry => {
      const matches = resources.filter(resource => resource.type === 10 && resource.id === entry.id);
      if (matches.length !== 1) throw new Error(`Missing or ambiguous recording ${entry.id} in this sound pack.`);
      const data = matches[0].data.slice().buffer;
      readPcmWave(data);
      return { key: entry.key, name: entry.name, source: file.name, data };
    });
    await this.save(assets);
    return assets.length;
  }

  async resolve(preset: BwgPreset, source: BackgroundSource = 'auto'): Promise<BoundBackground | undefined> {
    await this.ready;
    const reference = backgroundReference(preset);
    const asset = reference && this.records.get(reference.key);
    if (!reference) return undefined;
    if (source === 'generated' || !asset) {
      if (source === 'recording' || !reference.approximation) return undefined;
      return { sample: makeGeneratedBackground(reference.approximation), interval: reference.interval,
        name: reference.name, kind: 'generated' };
    }
    let sample = this.decoded.get(asset.key);
    if (!sample) { sample = readPcmWave(asset.data); this.decoded.set(asset.key, sample); }
    return { sample, interval: reference.interval, name: asset.name, kind: 'recording' };
  }

  async clear(): Promise<void> {
    await this.ready;
    if (this.database) await this.transaction(store => { store.clear(); });
    this.records.clear();
    this.decoded.clear();
  }

  private async readFile(file: File): Promise<ArrayBuffer> {
    if (file.size > 64 * 1024 * 1024) throw new Error('Background files must be smaller than 64 MB.');
    return file.arrayBuffer();
  }

  private async save(assets: BackgroundAsset[]): Promise<void> {
    await this.ready;
    if (this.database) await this.transaction(store => { for (const asset of assets) store.put(asset); });
    for (const asset of assets) { this.records.set(asset.key, asset); this.decoded.delete(asset.key); }
  }

  private transaction(write: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.database!.transaction('clips', 'readwrite');
      write(transaction.objectStore('clips'));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Background storage could not be updated.'));
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const backgroundAssets = new BackgroundAssets();
