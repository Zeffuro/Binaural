import type { HrtfPack } from './hrtf-pack';

export class HrtfRenderer {
  private pack: HrtfPack;
  private history: Float32Array;
  private size: number;
  private head = 0;
  private coefficients: Float64Array;
  private steps: Float64Array;
  private target: Float64Array;
  private face = 0;
  private tick = 0;
  private transition = 0;
  private initialized = false;

  constructor(pack: HrtfPack) {
    this.pack = pack;
    this.size = 1 << Math.ceil(Math.log2(pack.taps));
    this.history = new Float32Array(this.size * 2);
    this.coefficients = new Float64Array(pack.taps * 2);
    this.steps = new Float64Array(pack.taps * 2);
    this.target = new Float64Array(pack.taps * 2);
  }

  changeProfile(pack: HrtfPack): void {
    if (pack.sampleRate !== this.pack.sampleRate || pack.taps !== this.pack.taps) throw new Error('Incompatible HRTF profile.');
    this.pack = pack;
    this.face = 0;
    this.transition = Math.round(pack.sampleRate * .06);
    this.tick = 0;
  }

  private interpolate(x: number, y: number, z: number): void {
    const pack = this.pack, inverses = pack.inverse;
    let a = 0, b = 0, c = 0, found = false;
    for (let attempt = -1; attempt < pack.triangles.length / 3; attempt++) {
      const face = attempt === -1 ? this.face : attempt, start = face * 9;
      a = inverses[start] * x + inverses[start + 1] * y + inverses[start + 2] * z;
      b = inverses[start + 3] * x + inverses[start + 4] * y + inverses[start + 5] * z;
      c = inverses[start + 6] * x + inverses[start + 7] * y + inverses[start + 8] * z;
      if (a >= -1e-7 && b >= -1e-7 && c >= -1e-7 && a + b + c > 1e-10) {
        this.face = face; found = true; break;
      }
    }
    if (!found) throw new Error('HRTF grid does not cover this direction.');
    a = Math.max(0, a); b = Math.max(0, b); c = Math.max(0, c);
    const sum = a + b + c; a /= sum; b /= sum; c /= sum;
    const taps = pack.taps * 2, triangle = this.face * 3;
    const ia = pack.triangles[triangle] * taps, ib = pack.triangles[triangle + 1] * taps, ic = pack.triangles[triangle + 2] * taps;
    for (let tap = 0; tap < taps; tap++) this.target[tap] =
      a * pack.impulses[ia + tap] + b * pack.impulses[ib + tap] + c * pack.impulses[ic + tap];
  }

  render(input: Float32Array | undefined, left: Float32Array, right: Float32Array, parameters: Record<string, Float32Array>): void {
    const taps = this.pack.taps, coefficients = this.coefficients, history = this.history, size = this.size;
    for (let frame = 0; frame < left.length; frame++) {
      const x = parameters.positionX[parameters.positionX.length === 1 ? 0 : frame];
      const y = parameters.positionY[parameters.positionY.length === 1 ? 0 : frame];
      const z = parameters.positionZ[parameters.positionZ.length === 1 ? 0 : frame];
      const radius = Math.hypot(x, y, z);
      if (this.tick === 0) {
        this.interpolate(radius > 1e-8 ? x : 0, radius > 1e-8 ? y : 0, radius > 1e-8 ? z : -1);
        if (!this.initialized) { coefficients.set(this.target); this.initialized = true; }
        const duration = Math.max(32, this.transition);
        for (let tap = 0; tap < taps * 2; tap++) this.steps[tap] = (this.target[tap] - coefficients[tap]) / duration;
        this.tick = 32;
      }
      const sample = input?.[frame] ?? 0;
      history[this.head] = history[this.head + size] = sample;
      let l = 0, r = 0;
      // A duplicated ring keeps the convolution's inner loop contiguous.
      const newest = this.head + size;
      for (let tap = 0; tap < taps; tap++) {
        const value = history[newest - tap];
        l += value * coefficients[tap]; r += value * coefficients[taps + tap];
        coefficients[tap] += this.steps[tap]; coefficients[taps + tap] += this.steps[taps + tap];
      }
      const distance = Math.min(3, Math.max(.15, radius)), gain = .15 / (.15 + .2 * (distance - .15));
      left[frame] = l * gain; right[frame] = r * gain;
      this.head = (this.head + 1) & (size - 1);
      this.tick--; if (this.transition > 0) this.transition--;
    }
  }
}
