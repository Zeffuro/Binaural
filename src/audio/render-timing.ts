export function phaseCycles(frequency: number, offsetSeconds: number): number {
  // AudioParam frequencies are float32; accumulate their phase in double precision.
  return ((Math.fround(frequency) * offsetSeconds) % 1 + 1) % 1;
}

export function setSinePhase(context: BaseAudioContext, oscillator: OscillatorNode, cycles: number): void {
  const radians = (((cycles % 1) + 1) % 1) * 2 * Math.PI;
  oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, Math.sin(radians)]),
    new Float32Array([0, Math.cos(radians)]), { disableNormalization: true }));
}
