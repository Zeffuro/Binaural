export function bwgGain(raw: number): number {
  const volume = Math.min(10000, Math.max(0, raw));
  return Math.round(1024 * Math.log(1 - volume / 10100) / Math.log(1 / 101)) / 1024;
}

export function modulatedVolume(volume: number, depth: number, phase: number): number {
  const amount = Math.trunc(Math.trunc(Math.min(10000, Math.max(0, depth)) / 100) * volume / 100);
  return volume - amount + Math.trunc((129 + Math.round(127 * Math.sin(phase))) * amount / 256);
}
