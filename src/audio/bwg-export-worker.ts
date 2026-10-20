import type { BoundBackground } from '../background-assets';
import { BwgRenderer } from './bwg-renderer';
import { BWG_EXPORT_HISTORY_SECONDS, validateBwgExportRange,
  type BwgExportRequest, type BwgExportResponse } from './bwg-export-protocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<BwgExportRequest>) => void;
  postMessage: (message: BwgExportResponse, transfer?: Transferable[]) => void;
  close: () => void;
};
let renderer: BwgRenderer | undefined;
let rate = 0, cursor = 0, historyStart = 0;
let history: [Float32Array, Float32Array] = [new Float32Array(), new Float32Array()];
let ended = false;

function validateBackground(background?: BoundBackground): void {
  if (!background) return;
  const sample = background.sample;
  if (!sample || !Number.isInteger(sample.rate) || sample.rate < 4000 || sample.rate > 192000 ||
      typeof background.interval !== 'boolean' || !Array.isArray(sample.channels) ||
      sample.channels.length < 1 || sample.channels.length > 2 || !sample.channels[0]?.length ||
      sample.channels[0].length * sample.channels.length > 16 * 1024 * 1024 ||
      sample.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== sample.channels[0].length ||
        !channel.every(value => Number.isFinite(value) && Math.abs(value) <= 1))) {
    throw new Error('Invalid BWGen export background audio.');
  }
}

scope.onmessage = event => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      if (renderer) throw new Error('The BWGen export worker is already initialized.');
      if (!Number.isInteger(message.rate) || message.rate < 4000 || message.rate > 192000 ||
          !Array.isArray(message.preset?.segments) || message.preset.segments.length < 1 || message.preset.segments.length > 25 ||
          message.preset.segments.some(segment => !Number.isInteger(segment.voices) || segment.voices < 1 || segment.voices > 10) ||
          !Array.isArray(message.levels) || message.levels.length > 10 ||
          message.levels.some(level => !Number.isFinite(level) || level < 0 || level > 1)) {
        throw new Error('Invalid BWGen export renderer settings.');
      }
      validateBackground(message.background);
      rate = message.rate;
      renderer = new BwgRenderer(message.preset, rate, message.background);
      renderer.levels = message.levels;
      scope.postMessage({ type: 'ready' });
      return;
    }
    if (message.type !== 'read' || !renderer || !Number.isSafeInteger(message.id)) {
      throw new Error('Invalid BWGen export worker request.');
    }
    validateBwgExportRange(message.startFrame, message.frames, cursor, rate);
    const channels: [Float32Array, Float32Array] = [new Float32Array(message.frames), new Float32Array(message.frames)];
    const overlap = cursor - message.startFrame;
    for (let ear = 0; ear < 2; ear++) {
      channels[ear].set(history[ear].subarray(message.startFrame - historyStart, cursor - historyStart));
    }
    for (let offset = overlap; offset < message.frames && !ended; offset += 4096) {
      const end = Math.min(message.frames, offset + 4096);
      ended = !renderer.render(channels[0].subarray(offset, end), channels[1].subarray(offset, end));
    }
    if (channels.some(channel => !channel.every(Number.isFinite))) throw new Error('BWGen export produced non-finite audio.');
    const end = message.startFrame + message.frames;
    const nextStart = Math.max(0, end - rate * BWG_EXPORT_HISTORY_SECONDS);
    const next: [Float32Array, Float32Array] = [new Float32Array(end - nextStart), new Float32Array(end - nextStart)];
    for (let ear = 0; ear < 2; ear++) {
      const retained = Math.max(0, message.startFrame - nextStart);
      if (retained) next[ear].set(history[ear].subarray(nextStart - historyStart, message.startFrame - historyStart));
      next[ear].set(channels[ear].subarray(Math.max(0, nextStart - message.startFrame)), retained);
    }
    history = next;
    historyStart = nextStart;
    cursor = end;
    scope.postMessage({ type: 'pcm', id: message.id, left: channels[0], right: channels[1] },
      [channels[0].buffer, channels[1].buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    scope.close();
  }
};
