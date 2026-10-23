import type { HrtfProfile } from '../hrtf-profiles';

export interface HrtfPack {
  profile: HrtfProfile;
  sampleRate: number;
  taps: number;
  directions: Float32Array;
  impulses: Float32Array;
  triangles: Uint32Array;
  inverse: Float64Array;
}

export function decodeHrtfPack(profile: HrtfProfile, rate: number, metadata: unknown, buffer: ArrayBuffer): HrtfPack {
  const fail = (): never => { throw new Error('Invalid HRTF profile data.'); };
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fail();
  const manifest = metadata as Record<string, unknown>, view = new DataView(buffer);
  const count = manifest.directions, taps = manifest.taps;
  if (![44100, 48000].includes(rate) || manifest.format !== 'BHRF' || manifest.version !== 1 || manifest.profile !== profile || manifest.sampleRate !== rate ||
      taps !== 256 || !Number.isInteger(count) || (count as number) < 6 || (count as number) > 1024 ||
      manifest.bytes !== buffer.byteLength || buffer.byteLength !== 24 + (count as number) * (3 + 2 * taps) * 4 ||
      buffer.byteLength < 24 || view.getUint32(0, true) !== 0x46524842 || view.getUint32(4, true) !== 1 ||
      view.getUint32(8, true) !== count || view.getUint32(12, true) !== rate || view.getUint32(16, true) !== taps ||
      view.getUint32(20, true) !== 0 || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return fail();
  const directions = new Float32Array((count as number) * 3), impulses = new Float32Array((count as number) * taps * 2);
  let offset = 24;
  for (let direction = 0; direction < (count as number); direction++) {
    for (let axis = 0; axis < 3; axis++, offset += 4) directions[direction * 3 + axis] = view.getFloat32(offset, true);
    const [x, y, z] = directions.subarray(direction * 3, direction * 3 + 3);
    if (!Number.isFinite(x + y + z) || Math.abs(Math.hypot(x, y, z) - 1) > .0001) return fail();
    for (let tap = 0; tap < 2 * taps; tap++, offset += 4) {
      const value = view.getFloat32(offset, true);
      if (!Number.isFinite(value) || Math.abs(value) > 16) return fail();
      impulses[direction * 2 * taps + tap] = value;
    }
  }
  const faces = manifest.triangleIndices;
  if (!Array.isArray(faces) || faces.length !== 3 * (2 * (count as number) - 4) ||
      faces.some(index => !Number.isInteger(index) || index < 0 || index >= (count as number))) return fail();
  const triangles = new Uint32Array(faces), inverse = new Float64Array(faces.length * 3), edges = new Map<string, number>();
  for (let face = 0; face < faces.length / 3; face++) {
    const indices = faces.slice(face * 3, face * 3 + 3) as number[];
    if (new Set(indices).size !== 3) return fail();
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[edge], b = indices[(edge + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const [a, b, c] = indices.map(index => directions.subarray(index * 3, index * 3 + 3));
    const cross = (u: Float32Array, v: Float32Array) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b), determinant = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
    if (Math.abs(determinant) < 1e-8) return fail();
    const normal = [bc[0] + ca[0] + ab[0], bc[1] + ca[1] + ab[1], bc[2] + ca[2] + ab[2]];
    const sign = Math.sign(determinant), plane = Math.abs(determinant);
    for (let vertex = 0; vertex < (count as number); vertex++) {
      if (sign * (normal[0] * directions[vertex * 3] + normal[1] * directions[vertex * 3 + 1] +
          normal[2] * directions[vertex * 3 + 2]) > plane + 1e-5) return fail();
    }
    inverse.set([...bc, ...ca, ...ab].map(value => value / determinant), face * 9);
  }
  if ([...edges.values()].some(count => count !== 2) || new Set(faces).size !== count) return fail();
  return { profile, sampleRate: rate, taps, directions, impulses, triangles, inverse };
}

export function resampleHrtfPack(pack: HrtfPack, rate: number): HrtfPack {
  if (!Number.isInteger(rate) || rate < 22050 || rate > 96000) throw new Error('HRTF profiles support audio sample rates from 22050 to 96000 Hz.');
  if (pack.sampleRate === rate) return pack;
  const ratio = rate / pack.sampleRate, radius = 16, taps = Math.ceil((pack.taps + radius) * ratio);
  const impulses = new Float32Array(pack.directions.length / 3 * 2 * taps), cutoff = Math.min(1, ratio);
  for (let channel = 0; channel < pack.directions.length / 3 * 2; channel++) {
    for (let tap = 0; tap < taps; tap++) {
      const source = tap / ratio; let sum = 0;
      for (let index = Math.max(0, Math.ceil(source - radius)); index <= Math.min(pack.taps - 1, Math.floor(source + radius)); index++) {
        const distance = source - index, argument = Math.PI * cutoff * distance;
        const sinc = argument === 0 ? 1 : Math.sin(argument) / argument;
        const window = .42 + .5 * Math.cos(Math.PI * distance / radius) + .08 * Math.cos(2 * Math.PI * distance / radius);
        sum += pack.impulses[channel * pack.taps + index] * cutoff * sinc * window / ratio;
      }
      impulses[channel * taps + tap] = sum;
    }
  }
  return { ...pack, sampleRate: rate, taps, impulses };
}
