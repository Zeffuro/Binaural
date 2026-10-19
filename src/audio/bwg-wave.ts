const SIZE = 8192;
const TAU = Math.PI * 2;

export function bwgWave(phase: number, packed: number): number {
  const y = Math.trunc((packed & 65535) / 10);
  const z = Math.trunc((packed >>> 16) / 10);
  if (y === 50 && z === 50) return Math.sin(phase);
  const angle = y >= 50 ? Math.trunc((y - 50) * 3.6) : -Math.trunc((y - 50) ** 2 / 5);
  const half = Math.trunc(angle / 2);
  const a = 90 - half, b = a + 2 * half, d = 270 + half, c = d - 2 * half;
  const x = phase * 180 / Math.PI;
  if (a < x && x < b) return 1;
  if (c < x && x < d) return -1;
  if (a === 0) return 0;
  const theta = x <= 90 ? x * 90 / a : x <= 270 ? (x - 180) * 90 / a + 180 : (x - 360) * 90 / a + 360;
  const sine = Math.sin(theta * Math.PI / 180);
  const power = z >= 50 ? 2 - 0.02 * z : 3 - 0.04 * z;
  const peak = angle < 0 ? Math.abs(Math.sin(Math.PI / 2 * 90 / a)) ** power : 1;
  return Math.sign(sine) * Math.abs(sine) ** power / peak;
}

function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= SIZE; length *= 2) {
    const angle = (inverse ? 1 : -1) * TAU / length;
    for (let start = 0; start < SIZE; start += length) {
      for (let k = 0; k < length / 2; k++) {
        const cosine = Math.cos(angle * k), sine = Math.sin(angle * k);
        const first = start + k, second = first + length / 2;
        const r = real[second] * cosine - imaginary[second] * sine;
        const im = real[second] * sine + imaginary[second] * cosine;
        real[second] = real[first] - r;
        imaginary[second] = imaginary[first] - im;
        real[first] += r;
        imaginary[first] += im;
      }
    }
  }
  if (inverse) for (let i = 0; i < SIZE; i++) { real[i] /= SIZE; imaginary[i] /= SIZE; }
}

function createTable(packed: number, filter: number): Float32Array {
  const input = Float64Array.from({ length: SIZE }, (_, i) => Math.round(bwgWave(i * TAU / SIZE, packed) * 32767) / 32767);
  if (filter < 2000) {
    const kernel = new Float64Array(SIZE);
    const q = 2 * Math.min(SIZE / 4, filter / 100 + 0.5) / SIZE;
    for (let k = 0; k < 400; k++) {
      const n = k - 400;
      const coefficient = Math.sin(TAU * q * n) / (Math.PI * n) * (0.54 + 0.46 * Math.cos(Math.PI * n / 400));
      kernel[(SIZE - 801 - k) % SIZE] += coefficient;
      kernel[(SIZE - 1600 + k) % SIZE] += coefficient;
    }
    const inputImaginary = new Float64Array(SIZE), kernelImaginary = new Float64Array(SIZE);
    fft(input, inputImaginary);
    fft(kernel, kernelImaginary);
    for (let i = 0; i < SIZE; i++) {
      const r = input[i] * kernel[i] - inputImaginary[i] * kernelImaginary[i];
      inputImaginary[i] = input[i] * kernelImaginary[i] + inputImaginary[i] * kernel[i];
      input[i] = r;
    }
    fft(input, inputImaginary, true);
  }
  let peak = 0;
  for (const value of input) peak = Math.max(peak, Math.abs(value));
  return Float32Array.from(input, value => peak ? Math.round(value / peak * 32767) / 32767 : 0);
}

export class BwgWaveBank {
  private tables = new Map<string, Float32Array>();
  sample(phase: number, packed: number, rawFilter: number): number {
    const filter = Math.floor(Math.max(0, Math.min(2000, rawFilter)) / 20) * 20;
    const y = Math.trunc((packed & 65535) / 10) * 10;
    const z = Math.trunc((packed >>> 16) / 10) * 10;
    const key = `${y}:${z}:${filter}`;
    let table = this.tables.get(key);
    if (!table) {
      table = createTable(y | (z << 16), filter);
      if (this.tables.size >= 256) this.tables.delete(this.tables.keys().next().value!);
      this.tables.set(key, table);
    }
    const position = phase * SIZE / TAU;
    const index = Math.floor(position) % SIZE;
    return table[index] + (table[(index + 1) % SIZE] - table[index]) * (position - Math.floor(position));
  }
}
