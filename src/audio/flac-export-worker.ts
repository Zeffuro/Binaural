import { FLAC_SAMPLE_RATE, validateFlacFrames, validateFlacPcm, validateFlacHeader,
  type FlacExportRequest, type FlacExportResponse } from './flac-export-protocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<FlacExportRequest>) => void;
  postMessage: (message: FlacExportResponse, transfer?: Transferable[]) => void;
  close: () => void;
};
type Encoder = Awaited<ReturnType<typeof import('@audio/encode-flac')['default']>>;
let encoder: Encoder | undefined;
let totalFrames = 0, encodedFrames = 0;
let busy = false, initialized = false, closed = false;

function release(): void {
  closed = true;
  try { encoder?.free(); } finally { encoder = undefined; }
}

function bytes(data: Uint8Array): ArrayBuffer { return data.slice().buffer; }

async function receive(message: FlacExportRequest): Promise<void> {
  if (closed || busy) throw new Error('Invalid concurrent FLAC worker request.');
  busy = true;
  try {
    if (message.type === 'init') {
      if (initialized) throw new Error('The FLAC export worker is already initialized.');
      initialized = true;
      validateFlacFrames(message.totalFrames);
      totalFrames = message.totalFrames;
      const { default: flac } = await import('@audio/encode-flac');
      encoder = await flac({ sampleRate: FLAC_SAMPLE_RATE, channels: 2, bitDepth: 16, compression: 5, frames: totalFrames });
      if (closed) { release(); return; }
      scope.postMessage({ type: 'ready' });
      return;
    }
    if (!encoder || !Number.isSafeInteger(message.id) || message.id < 1) throw new Error('Invalid FLAC export worker request.');
    if (message.type === 'encode') {
      validateFlacPcm(message.left, message.right, totalFrames - encodedFrames);
      // Preserve the WAV PCM16 codes before the encoder applies its symmetric scale.
      for (const channel of [message.left, message.right]) for (let i = 0; i < channel.length; i++) {
        const value = Math.max(-1, Math.min(1, channel[i]));
        channel[i] = Math.round(value * (value < 0 ? 32768 : 32767)) / 32768;
      }
      const data = bytes(encoder.encode([message.left, message.right]));
      encodedFrames += message.left.length;
      scope.postMessage({ type: 'encoded', id: message.id, data }, [data]);
      return;
    }
    if (message.type !== 'finish' || encodedFrames !== totalFrames) throw new Error('The FLAC export frame count is incomplete.');
    const data = bytes(encoder.flush()), head = encoder.head?.();
    if (!head) throw new Error('The FLAC encoder did not finalize its stream header.');
    const header = bytes(head);
    validateFlacHeader(header, totalFrames);
    release();
    scope.postMessage({ type: 'finished', id: message.id, data, header }, [data, header]);
    scope.close();
  } finally { busy = false; }
}

scope.onmessage = event => {
  void receive(event.data).catch(error => {
    try { release(); } catch { /* Report the original encoder failure. */ }
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    scope.close();
  });
};
