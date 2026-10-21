import type { AsmrLayer, AsmrSettings } from '../asmr-state';
import { defaultAsmrVariation } from '../asmr-variation';
import { ASMR_RATE, asmrSample, asmrVariantSample } from './asmr-synthesis';
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
  return { channels: [asmrSample(layer.sound)], sampleRate: ASMR_RATE,
    variants: [[asmrVariantSample(layer.sound, 1)], [asmrVariantSample(layer.sound, 2)]] };
}

export function phraseConfig(settings: AsmrSettings, ordinal: number): AsmrPhraseConfig {
  const solo = settings.layers.some(layer => layer.solo && !layer.muted);
  return { variation: settings.variation ?? defaultAsmrVariation(), ordinal,
    eligible: settings.layers.flatMap((layer, index) => !layer.muted && layer.level > 0 && (!solo || layer.solo) ? [index] : []) };
}

export interface AsmrSource {
  playbackRate: AudioParam;
  connect(node: AudioNode): AudioNode;
  disconnect(): void;
  start(): void;
  stop(time?: number): void;
  configure?(config: AsmrPhraseConfig): void;
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
  return { playbackRate: node.parameters.get('rate')!, connect: destination => node.connect(destination),
    disconnect: () => { node.port.close(); node.disconnect(); }, start: () => {},
    stop: time => node.port.postMessage({ stopFrame: Math.round((time ?? context.currentTime) * context.sampleRate) }),
    configure: next => { const nextSignature = JSON.stringify(next); if (signature !== nextSignature) {
      signature = nextSignature; node.port.postMessage({ config: next });
    } } };
}
