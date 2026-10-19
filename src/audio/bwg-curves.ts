import type { BwgCurve, BwgPoint, BwgPreset, BwgSegment } from '../import/bwg-format';
import { backgroundReference } from '../import/bwg-background';

const SWEEPS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 7, 10, 15, 35, 100],
  [0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 10, 13, 18, 28, 45, 100],
  [0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 9, 12, 16, 20, 25, 35, 55, 100],
  [0, 0, 0, 0, 1, 2, 3, 3, 4, 5, 7, 9, 11, 14, 18, 23, 28, 35, 44, 63, 100],
  [0, 0, 0, 1, 2, 3, 4, 5, 7, 9, 11, 14, 17, 21, 25, 30, 36, 43, 53, 70, 100],
  [0, 0, 1, 2, 3, 4, 5, 7, 10, 13, 16, 19, 23, 28, 33, 38, 45, 54, 64, 79, 100],
  [0, 0, 1, 2, 4, 6, 9, 12, 15, 18, 22, 26, 30, 35, 40, 46, 53, 59, 68, 81, 100],
  [0, 1, 2, 4, 6, 9, 12, 16, 19, 23, 28, 33, 38, 43, 48, 54, 60, 66, 74, 85, 100],
  [0, 2, 4, 7, 10, 13, 17, 22, 26, 31, 36, 40, 45, 50, 55, 61, 67, 73, 80, 88, 100],
  [0, 2, 6, 10, 15, 19, 23, 27, 33, 38, 43, 48, 53, 58, 63, 68, 74, 79, 85, 92, 100],
  [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  [0, 8, 15, 21, 26, 32, 37, 42, 47, 52, 57, 62, 67, 73, 77, 81, 85, 90, 94, 98, 100],
  [0, 12, 20, 27, 33, 39, 45, 50, 55, 60, 64, 69, 74, 78, 83, 87, 90, 93, 96, 98, 100],
  [0, 15, 26, 33, 40, 46, 52, 57, 62, 67, 72, 77, 81, 84, 88, 91, 94, 96, 98, 99, 100],
  [0, 19, 32, 41, 47, 54, 60, 65, 70, 74, 78, 82, 85, 88, 91, 94, 96, 98, 99, 100, 100],
  [0, 21, 36, 46, 55, 62, 67, 72, 77, 81, 84, 87, 90, 93, 95, 96, 97, 98, 99, 100, 100],
  [0, 30, 47, 57, 64, 70, 75, 79, 83, 86, 89, 91, 93, 95, 96, 97, 98, 99, 100, 100, 100],
  [0, 37, 56, 65, 72, 77, 82, 86, 89, 91, 93, 95, 96, 97, 97, 98, 99, 100, 100, 100, 100],
  [0, 45, 65, 75, 80, 84, 88, 91, 93, 94, 95, 96, 97, 98, 98, 99, 99, 100, 100, 100, 100],
  [0, 55, 72, 82, 87, 90, 92, 94, 95, 96, 97, 97, 98, 98, 99, 99, 100, 100, 100, 100, 100],
  [0, 65, 85, 90, 93, 95, 96, 97, 97, 98, 98, 99, 99, 100, 100, 100, 100, 100, 100, 100, 100],
];

interface Parameter { decimals: number; minimum: number; maximum: number; waveform?: boolean }
const intervalLimits = new WeakMap<BwgSegment, number>();
const parameter = (index: number, segment?: BwgSegment): Parameter => {
  if (!Number.isInteger(index) || index < 0 || index >= 176) throw new Error('Invalid BWGen parameter index.');
  if (index >= 36) {
    const local = (index - 36) % 14;
    return { decimals: local === 0 || local === 11 || local === 12 ? 3 : local === 5 || local === 6 ? 1 : 2,
      minimum: local === 0 ? -1000 : local === 13 ? -360 : 0,
      maximum: local === 0 ? 1000 : local === 1 || local === 2 ? 20000 : local === 7 || local === 8 ? 20 :
        local === 11 || local === 12 ? 50000 : local === 13 ? 360 : 100,
      waveform: local === 5 || local === 6 };
  }
  const period = [11, 12, 22, 23, 27, 28, 32, 33].includes(index);
  const phase = [13, 24, 29, 34, 35].includes(index);
  return { decimals: period || index === 14 || index === 15 ? 3 : 2,
    minimum: index === 4 ? -1000 : phase ? -360 : 0,
    maximum: period ? 50000 : index === 2 || index === 3 ? (segment && intervalLimits.get(segment)) ?? 600 : index === 4 ? 1000 : phase ? 360 : 100 };
};

export function parameterScale(index: number): number { return 10 ** parameter(index).decimals; }

function mulDiv(value: number, multiplier: number, divisor: number): number {
  // The native helper rounds positive half remainders upward and truncates negatives.
  const product = value * multiplier;
  if (Number.isSafeInteger(product)) {
    const quotient = Math.trunc(product / divisor);
    return quotient + (product % divisor >= divisor / 2 ? 1 : 0);
  }
  const numerator = BigInt(value) * BigInt(multiplier), denominator = BigInt(divisor);
  return Number(numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n));
}

function curvePoints(segment: BwgSegment, index: number, visiting: Set<number>): BwgPoint[] {
  const curve = segment.curves[index];
  if (!curve || visiting.has(index)) throw new Error('Invalid or cyclic BWGen parameter tracking.');
  if (curve.mode === 0) return curve.points;
  if (curve.mode !== 1) throw new Error('Unsupported BWGen parameter mode.');
  visiting.add(index);
  const source = curvePoints(segment, curve.tracking, visiting);
  visiting.delete(index);
  const from = parameter(curve.tracking, segment), to = parameter(index, segment);
  const sourceScale = 10 ** from.decimals, targetScale = 10 ** to.decimals;
  const identityWaveform = from.waveform && to.waveform && curve.trackingConfig === 0 && curve.trackingScale === 1000;
  // Tracking changes source nodes before their inherited sweep is interpolated.
  return source.map(point => {
    if (identityWaveform) return { ...point };
    const value = from.waveform ? point.value & 65535 : point.value;
    const scaled = mulDiv(value, curve.trackingScale * targetScale, sourceScale * 1000) +
      mulDiv(curve.trackingConfig, targetScale, 1000);
    const tracked = Math.max(curve.trackingMin * targetScale, Math.min(curve.trackingMax * targetScale, scaled));
    const clipped = Math.max(to.minimum * targetScale, Math.min(to.maximum * targetScale, tracked));
    return { ...point, value: to.waveform ? (500 << 16) | clipped : clipped };
  });
}

interface CompiledCurve {
  points: BwgPoint[];
  intervals: ({ times: Int32Array; values: Int32Array; high?: Int32Array } | undefined)[];
}

// Parsed presets stay immutable during playback; validation rebuilds this cache.
const compiledSegments = new WeakMap<BwgSegment, (CompiledCurve | undefined)[]>();

function compiledCurve(segment: BwgSegment, index: number): CompiledCurve {
  let segmentCache = compiledSegments.get(segment);
  if (!segmentCache) { segmentCache = []; compiledSegments.set(segment, segmentCache); }
  const existing = segmentCache[index];
  if (existing) return existing;
  const points = curvePoints(segment, index, new Set()).map(point => ({ ...point }));
  const waveform = parameter(index, segment).waveform;
  const intervals = points.slice(0, -1).map((first, offset) => {
    const last = points[offset + 1], span = last.position - first.position, row = SWEEPS[first.weight];
    if (!row || span < 0) throw new Error('Invalid BWGen envelope interval.');
    if (!span) return undefined;
    const times = new Int32Array(21), values = new Int32Array(21);
    const high = waveform ? new Int32Array(21) : undefined;
    const start = waveform ? first.value & 65535 : first.value;
    const end = waveform ? last.value & 65535 : last.value;
    for (let step = 0; step <= 20; step++) {
      times[step] = first.position + Math.trunc(span * step / 20);
      values[step] = start + mulDiv(end - start, row[step], 100);
      if (high) high[step] = (first.value >>> 16) + mulDiv((last.value >>> 16) - (first.value >>> 16), row[step], 100);
    }
    return { times, values, high };
  });
  const compiled = { points, intervals };
  segmentCache[index] = compiled;
  return compiled;
}

export function evaluateCurve(segment: BwgSegment, index: number, position: number): number {
  if (!Number.isFinite(position)) throw new Error('Invalid BWGen playback position.');
  const { points, intervals } = compiledCurve(segment, index);
  const at = Math.max(0, Math.min(10000, Math.trunc(position)));
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].position <= at) low = middle + 1; else high = middle;
  }
  const current = Math.max(0, low - 1);
  if (current === points.length - 1) return points[current].value;
  const interval = intervals[current];
  if (!interval) return points[current].value;
  low = 1; high = 20;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (interval.times[middle] < at) low = middle + 1; else high = middle;
  }
  const first = low - 1, span = interval.times[low] - interval.times[first];
  const offset = at - interval.times[first];
  const value = interval.values[first] + (span ? Math.trunc((interval.values[low] - interval.values[first]) * offset / span) : 0);
  return interval.high ? ((interval.high[first] + (span ? Math.trunc((interval.high[low] - interval.high[first]) * offset / span) : 0)) << 16) | value : value;
}

export function durationOf(preset: BwgPreset): number {
  return preset.segments.reduce((sum, segment) => sum + Math.round(segment.seconds * 1000) * segment.repeats, 0) / 1000;
}

export function segmentAt(preset: BwgPreset, elapsedSeconds: number): {
  segment: BwgSegment; index: number; position: number; ended: boolean;
} {
  if (!preset.segments.length || !Number.isFinite(elapsedSeconds)) throw new Error('Invalid BWGen playback time.');
  let remaining = Math.max(0, elapsedSeconds * 1000);
  for (const [index, segment] of preset.segments.entries()) {
    const milliseconds = Math.round(segment.seconds * 1000), total = milliseconds * segment.repeats;
    if (remaining < total) return { segment, index, position: remaining % milliseconds / milliseconds * 10000, ended: false };
    remaining -= total;
  }
  return { segment: preset.segments.at(-1)!, index: preset.segments.length - 1, position: 10000, ended: true };
}

export function validateCurves(preset: BwgPreset): void {
  const fail = (): never => { throw new Error('Unsupported or invalid BWGen synthesis parameters.'); };
  for (const segment of preset.segments) {
    intervalLimits.set(segment, backgroundReference(preset)?.file === 'bgextra.dll' ? 100 : 600);
    if (!Number.isFinite(segment.seconds) || segment.seconds <= 0 || !Number.isInteger(segment.repeats) || segment.repeats < 1 ||
        segment.curves.length !== 36 + segment.voices * 14) fail();
    segment.curves.forEach((curve: BwgCurve, index: number) => {
      const spec = parameter(index, segment), scale = 10 ** spec.decimals;
      if (![0, 1].includes(curve.mode) || !Number.isInteger(curve.channelMode) || curve.channelMode < 0 || curve.channelMode > 2 ||
          !Number.isInteger(curve.trackingOption) || curve.trackingOption < 0 || curve.trackingOption > 1 ||
          ![curve.trackingConfig, curve.trackingScale, curve.trackingMin, curve.trackingMax].every(Number.isSafeInteger) ||
          curve.trackingMin > curve.trackingMax || curve.points.length < 2 || curve.points.length > 255) fail();
      let previous = -1;
      for (const point of curve.points) {
        if (!Number.isInteger(point.position) || point.position < previous || point.position > 10000 ||
            !Number.isInteger(point.weight) || point.weight < 0 || point.weight > 20 || !Number.isSafeInteger(point.value) ||
            point.value < -2147483648 || point.value > 2147483647 ||
            !Number.isInteger(point.symmetric) || point.symmetric < 0 || point.symmetric > 10) fail();
        if (curve.mode === 0 && (spec.waveform ? (point.value >>> 16) > 1000 || (point.value & 65535) > 1000 :
          point.value < spec.minimum * scale || point.value > spec.maximum * scale)) fail();
        previous = point.position;
      }
      if (curve.points[0].position !== 0 || previous !== 10000 ||
          (curve.mode === 1 && (!Number.isInteger(curve.tracking) || curve.tracking < 0 || curve.tracking >= segment.curves.length))) fail();
      if (!curvePoints(segment, index, new Set()).every(point => Number.isFinite(point.value))) fail();
    });
    compiledSegments.delete(segment);
    segment.curves.forEach((_curve, index) => { compiledCurve(segment, index); });
  }
}
