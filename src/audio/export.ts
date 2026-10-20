import type { Session } from '../model';
import { renderPcm } from './pcm-export';
import { FlacExportSource } from './flac-export-source';
import { MAX_EXPORT_SECONDS, MAX_FILE_EXPORT_SECONDS, wavHeader, wavPcm } from './wav-encoding';
import type { AudioExportOptions, WavOptions, WavWriter } from './export-types';
export { MAX_EXPORT_SECONDS, MAX_FILE_EXPORT_SECONDS, WAV_SAMPLE_RATE, wavBytes } from './wav-encoding';
export { WAV_SECTION_SECONDS, WAV_PREROLL_SECONDS } from './pcm-export';
export type { AudioExportFormat, AudioExportOptions, WavOptions, WavProgress, WavWriter } from './export-types';

async function encode(input: Session, seconds: number, maximum: number, write: (bytes: ArrayBuffer) => Promise<void>,
    patch: (header: ArrayBuffer) => Promise<void>, options: AudioExportOptions): Promise<void> {
  const format = options.format ?? 'wav', signal = options.signal;
  if (format !== 'wav' && format !== 'flac') throw new Error('Choose WAV or FLAC for audio export.');
  let flac: FlacExportSource | undefined;
  const emit = async (bytes: ArrayBuffer) => { signal?.throwIfAborted(); if (bytes.byteLength) await write(bytes); signal?.throwIfAborted(); };
  try {
    const total = await renderPcm(input, seconds, maximum, {
      async start(frames) {
        if (format === 'wav') await emit(wavHeader(frames));
        else { flac = new FlacExportSource(frames, signal); await flac.ready; }
      },
      async write(left, right, first, frames) {
        await emit(flac ? await flac.encode(left.subarray(first, first + frames), right.subarray(first, first + frames))
          : wavPcm(left, right, first, frames));
      },
    }, options);
    signal?.throwIfAborted();
    options.onProgress?.({ completedFrames: total, totalFrames: total, fraction: 1, stage: 'finishing' });
    if (flac) {
      const final = await flac.finish();
      await emit(final.data); signal?.throwIfAborted(); await patch(final.header); signal?.throwIfAborted();
    }
  } finally { flac?.dispose(); }
}

export async function renderAudio(input: Session, seconds: number, options: AudioExportOptions = {}): Promise<Blob> {
  const parts: ArrayBuffer[] = []; let header: ArrayBuffer | undefined;
  try {
    await encode(input, seconds, MAX_EXPORT_SECONDS, async bytes => { parts.push(bytes); }, async bytes => { header = bytes; }, options);
    options.signal?.throwIfAborted();
    const type = options.format === 'flac' ? 'audio/flac' : 'audio/wav', blob = new Blob(parts, { type });
    return header ? new Blob([header, blob.slice(header.byteLength)], { type }) : blob;
  } finally { parts.length = 0; }
}

export async function writeAudio(input: Session, seconds: number, writer: WavWriter, options: AudioExportOptions = {}): Promise<void> {
  try {
    if (options.format === 'flac' && !writer.seek) throw new Error('Direct FLAC saving requires a seekable output file.');
    await encode(input, seconds, MAX_FILE_EXPORT_SECONDS, bytes => writer.write(bytes), async header => {
      await writer.seek!(0); options.signal?.throwIfAborted(); await writer.write(header);
    }, options);
    options.signal?.throwIfAborted();
    const total = Math.round(seconds * 44100);
    options.onProgress?.({ completedFrames: total, totalFrames: total, fraction: 1, stage: 'saving' });
    options.signal?.throwIfAborted(); await writer.close();
  } catch (error) {
    try { await writer.abort(error); } catch { /* Preserve the rendering error. */ }
    throw error;
  }
}

export const renderWav = (input: Session, seconds: number, signal?: AbortSignal, onProgress?: WavOptions['onProgress'], music?: File): Promise<Blob> =>
  renderAudio(input, seconds, { signal, onProgress, music, format: 'wav' });
export const writeWav = (input: Session, seconds: number, writer: WavWriter, options: WavOptions = {}): Promise<void> =>
  writeAudio(input, seconds, writer, { ...options, format: 'wav' });
export const renderFlac = (input: Session, seconds: number, options: WavOptions = {}): Promise<Blob> =>
  renderAudio(input, seconds, { ...options, format: 'flac' });
export const writeFlac = (input: Session, seconds: number, writer: WavWriter, options: WavOptions = {}): Promise<void> =>
  writeAudio(input, seconds, writer, { ...options, format: 'flac' });
