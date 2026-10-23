import type { AsmrLayer, AsmrSettings } from '../asmr-state';
import { defaultAsmrVariation } from '../asmr-variation';
import { asmrCueKind } from './asmr-cues';
import { ASMR_RATE, asmrGeneratedSample } from './asmr-synthesis';
import { AsmrMarkerHistory, type AsmrMarkerPose } from './asmr-markers';
import { asmrRecordingsReady, prepareAsmrRecordings, recordedAsmrBuffer } from './asmr-assets';
import { AsmrPhraseRenderer, type AsmrPhraseConfig, type AsmrPhrasePcm } from './asmr-phrases';
import workletUrl from './asmr-phrase-worklet.ts?worker&url';

const prepared = new WeakSet<BaseAudioContext>(), pending = new WeakMap<BaseAudioContext, Promise<void>>();
const usesPhrases = (settings?: AsmrSettings) => !!settings?.variation && settings.variation.mode !== 'steady' && settings.layers.length > 0;
export const asmrAudioReady = (context: BaseAudioContext, settings?: AsmrSettings): boolean =>
  asmrRecordingsReady(settings) && (!usesPhrases(settings) || prepared.has(context));

export async function prepareAsmrAudio(context: BaseAudioContext, settings?: AsmrSettings): Promise<void> {
  const tasks: Promise<unknown>[] = [prepareAsmrRecordings(settings)];
  if (usesPhrases(settings) && !prepared.has(context)) {
    let task = pending.get(context);
    if (!task) {
      task = context.audioWorklet.addModule(workletUrl).then(() => { prepared.add(context); }).finally(() => pending.delete(context));
      pending.set(context, task);
    }
    tasks.push(task);
  }
  await Promise.all(tasks);
}

function phrasePcm(layer: AsmrLayer): AsmrPhrasePcm {
  const recorded = recordedAsmrBuffer(layer.sound);
  if (recorded) return { sampleRate: recorded.sampleRate,
    channels: Array.from({ length: recorded.numberOfChannels }, (_, ear) => recorded.getChannelData(ear)) };
  const samples = [asmrGeneratedSample(layer.sound), asmrGeneratedSample(layer.sound, 1), asmrGeneratedSample(layer.sound, 2)];
  return { channels: [samples[0].samples], sampleRate: ASMR_RATE,
    variants: samples.slice(1).map(sample => [sample.samples]),
    events: samples[0].events ? samples.map(sample => sample.events!) : undefined };
}

export function phraseConfig(settings: AsmrSettings, ordinal: number): AsmrPhraseConfig {
  const solo = settings.layers.some(layer => layer.solo && !layer.muted);
  return { variation: settings.variation ?? defaultAsmrVariation(), ordinal,
    families: settings.layers.map(layer => asmrCueKind(layer.sound)), sounds: settings.layers.map(layer => layer.sound),
    eligible: settings.layers.flatMap((layer, index) => !layer.muted && layer.level > 0 && (!solo || layer.solo) ? [index] : []) };
}

export interface AsmrSource {
  playbackRate: AudioParam;
  connect(node: AudioNode): AudioNode;
  disconnect(): void;
  start(): void;
  stop(time?: number): void;
  configure?(config: AsmrPhraseConfig): void;
  readMarker?(time: number): AsmrMarkerPose | null | undefined;
  clearMarkers?(): void;
}

export function createAsmrPhraseSource(context: BaseAudioContext, layer: AsmrLayer, config: AsmrPhraseConfig,
    offsetSeconds: number, endAt?: number, onFailure?: () => void, originSeconds = context.currentTime - offsetSeconds): AsmrSource {
  const pcm = phrasePcm(layer), offline = context as OfflineAudioContext;
  if (typeof offline.length === 'number') {
    const channels = pcm.channels.map(() => new Float32Array(offline.length));
    new AsmrPhraseRenderer(pcm, config).render(channels, context.sampleRate, Math.round(offsetSeconds * context.sampleRate), layer.rate);
    const buffer = context.createBuffer(channels.length, offline.length, context.sampleRate);
    channels.forEach((channel, ear) => buffer.getChannelData(ear).set(channel));
    const source = context.createBufferSource(); source.buffer = buffer;
    const rateControl = context.createGain(); rateControl.gain.value = layer.rate;
    return { playbackRate: rateControl.gain, connect: node => source.connect(node), disconnect: () => { source.disconnect(); rateControl.disconnect(); },
      start: () => source.start(), stop: time => source.stop(time) };
  }
  if (!prepared.has(context)) throw new Error('The ASMR phrase processor is still loading.');
  const node = new AudioWorkletNode(context, 'asmr-phrases', { numberOfInputs: 0, numberOfOutputs: 1,
    outputChannelCount: [pcm.channels.length], parameterData: { rate: layer.rate },
    processorOptions: { pcm, config, originFrame: Math.round(originSeconds * context.sampleRate),
      stopFrame: endAt === undefined ? undefined : Math.round(endAt * context.sampleRate) } });
  node.addEventListener('processorerror', () => onFailure?.());
  let signature = JSON.stringify(config);
  const history = new AsmrMarkerHistory();
  let markersEnabled = false, markerEpoch = 0, disposed = false;
  const clearMarkers = () => {
    history.clear();
    if (!markersEnabled) return;
    markersEnabled = false; node.port.postMessage({ markers: false, markerEpoch: ++markerEpoch });
  };
  node.port.onmessage = event => {
    if (disposed || !markersEnabled || event.data.markerEpoch !== markerEpoch || !Array.isArray(event.data.markers)) return;
    for (const sample of event.data.markers.slice(-512)) history.push(sample);
  };
  return { playbackRate: node.parameters.get('rate')!, connect: destination => node.connect(destination),
    disconnect: () => { if (disposed) return; clearMarkers(); disposed = true; node.port.onmessage = null; node.port.close(); node.disconnect(); }, start: () => {},
    stop: time => node.port.postMessage({ stopFrame: Math.round((time ?? context.currentTime) * context.sampleRate) }),
    configure: next => { const nextSignature = JSON.stringify(next); if (signature !== nextSignature) {
      signature = nextSignature; history.clear();
      node.port.postMessage({ config: next, ...(markersEnabled ? { markers: true, markerEpoch: ++markerEpoch } : {}) });
    } },
    ...(pcm.events ? { readMarker: (time: number) => {
      if (disposed || !Number.isFinite(time)) return;
      if (!markersEnabled) {
        markersEnabled = true; node.port.postMessage({ markers: true, markerEpoch: ++markerEpoch });
      }
      return history.read(time);
    }, clearMarkers } : {}) };
}
