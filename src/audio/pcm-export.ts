import { parseSession, type Session } from '../model';
import { bwgContinues, decodeBwg } from '../import/bwg-program';
import { backgroundAssets } from '../background-assets';
import { listeningMode, modeGains } from '../listening-mode';
import { prepareAsmrRecordings } from './asmr-assets';
import { BwgExportSource } from './bwg-export-source';
import { exportGraph } from './export-graph';
import { decodeMusicForExport } from './music-export';
import { WAV_SAMPLE_RATE, wavFrames } from './wav-encoding';
import type { PcmOutput, WavOptions, WavProgress } from './export-types';
import { asmrBackgroundGain } from '../asmr-focus';
import { prepareHrtfAudio } from './hrtf-audio';

export const WAV_SECTION_SECONDS = 30;
export const WAV_PREROLL_SECONDS = 3;
const BLEND_FRAMES = Math.round(.02 * WAV_SAMPLE_RATE);
// At 44.1 kHz, this preserves native 128-frame windows and whole 24 kHz source samples.
const SECTION_ALIGNMENT = 128 * 147;

export async function renderPcm(input: Session, seconds: number, maximum: number, output: PcmOutput, options: WavOptions): Promise<number> {
  const total = wavFrames(seconds, maximum), session = parseSession(input), signal = options.signal;
  signal?.throwIfAborted();
  const progress = (completedFrames: number, stage: WavProgress['stage']) => options.onProgress?.({ completedFrames, totalFrames: total, fraction: completedFrames / total, stage });
  progress(0, 'preparing');
  const gains = modeGains(listeningMode(session)), preset = session.bwg ? decodeBwg(session.bwg).preset : undefined;
  const duration = session.timelineDuration ?? session.minutes * 60;
  const end = duration > 0 && !(preset && bwgContinues(preset)) ? duration : undefined;
  const music = options.music ? await decodeMusicForExport(options.music, signal) : undefined;
  if (gains.asmr && session.master) await prepareAsmrRecordings(session.asmr);
  signal?.throwIfAborted();
  if (typeof OfflineAudioContext === 'undefined') throw new Error('Offline audio rendering is unavailable in this browser.');
  let native: BwgExportSource | undefined;
  try {
    if (preset && gains.tones && !session.bwgMuted && session.master) {
      const background = await backgroundAssets.resolve(preset, session.bwgBackgroundSource);
      signal?.throwIfAborted();
      native = new BwgExportSource(preset, WAV_SAMPLE_RATE, session.layers.map(layer => session.tonesMuted ? 0 : layer.level), background, signal, asmrBackgroundGain(session));
      await native.ready;
    }
    signal?.throwIfAborted(); await output.start(total);
    let completed = 0, tail: [Float32Array, Float32Array] | undefined;
    const emit = async (left: Float32Array, right: Float32Array, first = 0, frames = left.length - first) => {
      signal?.throwIfAborted();
      if (frames) { await output.write(left, right, first, frames); completed += frames; }
      signal?.throwIfAborted(); progress(completed, 'rendering');
    };
    const sectionFrames = WAV_SECTION_SECONDS * WAV_SAMPLE_RATE, preroll = WAV_PREROLL_SECONDS * WAV_SAMPLE_RATE;
    for (let cursor = 0; cursor < total; cursor += sectionFrames) {
      signal?.throwIfAborted();
      const count = Math.min(sectionFrames, total - cursor);
      // Preserve the native compressor's control-window phase across independently rendered sections.
      const start = Math.floor(Math.max(0, cursor - preroll) / SECTION_ALIGNMENT) * SECTION_ALIGNMENT, prefix = cursor - start;
      const length = prefix + count, offset = start / WAV_SAMPLE_RATE;
      let channels: [Float32Array, Float32Array];
      if (session.master === 0 || (end !== undefined && offset >= end)) channels = [new Float32Array(length), new Float32Array(length)];
      else {
        const pcm = native ? await native.read(start, length) : undefined;
        signal?.throwIfAborted();
        const context = new OfflineAudioContext(2, length, WAV_SAMPLE_RATE);
        if (gains.asmr) await prepareHrtfAudio(context, session.asmr);
        signal?.throwIfAborted();
        let graphFailure: Error | undefined;
        const cleanup = exportGraph(context, session, offset, end, pcm, music, error => { graphFailure = error; });
        try {
          const buffer = await context.startRendering();
          // Processor errors are queued on the control thread before a section is encoded.
          if (session.asmr?.layers.some(layer => layer.spatial?.profile)) await new Promise(resolve => setTimeout(resolve, 0));
          if (graphFailure) throw graphFailure;
          signal?.throwIfAborted(); channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
        } finally { cleanup(); }
      }
      if (tail) {
        // Blend matching absolute samples after warm-up; filters and the compressor retain no public state.
        const blend = tail.map((channel, ear) => channel.map((value, frame) => {
          const weight = (frame + 1) / tail![0].length;
          return value * (1 - weight) + channels[ear][prefix - channel.length + frame] * weight;
        })) as [Float32Array, Float32Array];
        await emit(blend[0], blend[1]);
      }
      const keep = cursor + count < total ? Math.min(BLEND_FRAMES, count) : 0;
      await emit(channels[0], channels[1], prefix, count - keep);
      tail = keep ? [channels[0].slice(prefix + count - keep), channels[1].slice(prefix + count - keep)] : undefined;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (completed !== total) throw new Error('The audio export ended before all audio was written.');
    return total;
  } finally { native?.dispose(); }
}
