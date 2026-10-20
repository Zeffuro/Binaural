import { type AutomationPoint } from '../model';

export function frequencyPhase(points: AutomationPoint[], time: number): number {
  let previous = points[0], elapsed = 0, cycles = 0;
  for (const point of points.slice(1)) {
    const end = Math.min(time, point.time), duration = Math.max(0, end - elapsed);
    const frequency = Math.fround(previous.value);
    const slope = point.curve === 'linear' && point.time > previous.time
      ? (Math.fround(point.value) - frequency) / (point.time - previous.time) : 0;
    cycles = (cycles + duration * (frequency + slope * duration / 2)) % 1;
    if (point.time > time) return (cycles + 1) % 1;
    previous = point; elapsed = point.time;
  }
  return ((cycles + Math.max(0, time - elapsed) * Math.fround(previous.value)) % 1 + 1) % 1;
}

export function valueAt(points: AutomationPoint[], time: number): number {
  let previous = points[0];
  for (const point of points.slice(1)) {
    if (point.time > time) {
      if (point.curve === 'step' || point.time === previous.time) return previous.value;
      const weight = (time - previous.time) / (point.time - previous.time);
      return previous.value + weight * (point.value - previous.value);
    }
    previous = point;
  }
  return previous.value;
}

export function schedule(param: AudioParam, points: AutomationPoint[], origin: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(valueAt(points, Math.max(0, now - origin)), now);
  for (const point of points) {
    if (origin + point.time <= now) continue;
    if (point.curve === 'linear') param.linearRampToValueAtTime(point.value, origin + point.time);
    else param.setValueAtTime(point.value, origin + point.time);
  }
}
