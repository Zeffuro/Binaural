import type { BoundBackground } from '../background-assets';
import type { BwgPreset } from '../import/bwg-format';

export const BWG_EXPORT_HISTORY_SECONDS = 3;
export const BWG_EXPORT_MAX_READ_SECONDS = 40;

export type BwgExportRequest =
  | { type: 'init'; preset: BwgPreset; rate: number; levels: number[]; background?: BoundBackground; backgroundGain?: number }
  | { type: 'read'; id: number; startFrame: number; frames: number };
export type BwgExportResponse =
  | { type: 'ready' }
  | { type: 'pcm'; id: number; left: Float32Array; right: Float32Array }
  | { type: 'error'; message: string };

export function validateBwgExportRange(start: number, frames: number, cursor: number, rate: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(frames) || start < 0 || frames < 1 ||
      !Number.isSafeInteger(start + frames) || frames > rate * BWG_EXPORT_MAX_READ_SECONDS ||
      start > cursor || start < Math.max(0, cursor - rate * BWG_EXPORT_HISTORY_SECONDS) || start + frames < cursor) {
    throw new RangeError('BWGen export reads must advance sequentially with at most three seconds of overlap and forty seconds per read.');
  }
}
