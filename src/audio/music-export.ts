export const MAX_MUSIC_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_MUSIC_PCM_SAMPLES = 64_000_000;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

export async function decodeMusicForExport(file: File, signal?: AbortSignal): Promise<AudioBuffer> {
  checkAbort(signal);
  if (!file.size) throw new Error('The selected music file is empty.');
  if (file.size > MAX_MUSIC_FILE_BYTES) throw new Error('Music export supports local files up to 64 MiB. Choose a shorter music file.');
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); }
  catch {
    checkAbort(signal);
    throw new Error('The selected music file could not be read. Choose the file again.');
  }
  checkAbort(signal);
  let buffer: AudioBuffer;
  try {
    // This context only decodes; it never renders or opens a playback device.
    const decoder = new OfflineAudioContext(2, 1, 44100);
    buffer = await decoder.decodeAudioData(bytes);
  } catch {
    checkAbort(signal);
    throw new Error('The selected music could not be decoded for export. Its format may be unsupported or the file damaged.');
  }
  checkAbort(signal);
  if (!buffer.length || !buffer.numberOfChannels || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
    throw new Error('The selected music contains no usable audio.');
  }
  if (buffer.length * buffer.numberOfChannels > MAX_MUSIC_PCM_SAMPLES) {
    throw new Error('The decoded music is too large for export (64 million channel samples maximum). Choose a shorter music file.');
  }
  return buffer;
}
