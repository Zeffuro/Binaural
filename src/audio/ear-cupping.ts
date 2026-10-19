export function cuppingParameters(level: number, tone: number, amount: number) {
  const frequency = 500 * 24 ** tone;
  return { frequency: frequency * (1 - amount * .42), frequencyDepth: frequency * amount * .4,
    gain: level * .16 * (1 - amount * .22), gainDepth: level * .16 * amount * .18 };
}
export function cuppingWave(phase: number) {
  const radians = phase * Math.PI / 180;
  return { real: new Float32Array([0, Math.sin(radians)]), imaginary: new Float32Array([0, Math.cos(radians)]) };
}
