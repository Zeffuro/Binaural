import { type AutomationPoint } from '../model';

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
