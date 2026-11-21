import type { AsmrSpatialSettings, QuietReturnSettings } from '../asmr-spatial';

type Path = QuietReturnSettings & { far: number; azimuth: number; cosElevation: number; sinElevation: number };
const rearAngle = 3 * Math.PI / 4;
const ease = (value: number) => value * value * (3 - 2 * value);

function pathFor(settings: AsmrSpatialSettings): Path {
  const elevation = settings.elevation * Math.PI / 180;
  return { ...settings.quietReturn!, far: Math.max(.60, settings.distance), azimuth: settings.azimuth * Math.PI / 180,
    cosElevation: Math.cos(elevation), sinElevation: Math.sin(elevation) };
}

function sample(path: Path, phase: number, target: Float64Array): void {
  const leg = path.approach + path.gap;
  const right = phase >= leg;
  const position = right ? phase - leg : phase;
  const side = right ? 1 : -1;
  const approaching = position < path.approach;
  const progress = approaching ? position / path.approach : (position - path.approach) / path.gap;
  const distance = approaching ? 1 - ease(progress) : ease(progress);
  const angle = path.azimuth + (approaching ? side : -side) * rearAngle * distance;
  const radius = path.closest + (path.far - path.closest) * distance;
  const horizontal = radius * path.cosElevation;
  target[0] = horizontal * Math.sin(angle);
  target[1] = radius * path.sinElevation;
  target[2] = -horizontal * Math.cos(angle);
  const fade = Math.min(.22, path.approach * .18);
  target[3] = approaching ? ease(Math.min(1, position / fade, (path.approach - position) / fade)) : 0;
}

function wrap(seconds: number, path: Path): number {
  const cycle = 2 * (path.approach + path.gap);
  return ((seconds % cycle) + cycle) % cycle;
}

export class QuietApproachRenderer {
  private path: Path;
  private phase?: number;
  private pending?: Path;
  private pose = new Float64Array(4);
  private next = new Float64Array(4);
  private correction = new Float64Array(4);
  private transition = 0;

  constructor(settings: AsmrSpatialSettings, private originFrame: number, private offset: number) {
    this.path = pathFor(settings);
  }

  configure(settings: AsmrSpatialSettings): void { this.pending = pathFor(settings); }

  private applyEdit(phase: number): number {
    const next = this.pending!;
    const old = this.path, leg = old.approach + old.gap;
    const right = phase >= leg;
    const within = right ? phase - leg : phase;
    const newWithin = within < old.approach ? within / old.approach * next.approach
      : next.approach + (within - old.approach) / old.gap * next.gap;
    const newPhase = newWithin + (right ? next.approach + next.gap : 0);
    sample(old, phase, this.pose);
    sample(next, newPhase, this.next);
    for (let channel = 0; channel < 4; channel++) {
      this.correction[channel] = this.pose[channel] + this.correction[channel] * this.transition - this.next[channel];
    }
    this.transition = 1;
    this.path = next;
    this.pending = undefined;
    return newPhase;
  }

  render(output: Float32Array[], frame: number, rate: number): void {
    const step = 1 / rate;
    let phase = this.phase ?? wrap(this.offset + Math.max(0, frame - this.originFrame) * step, this.path);
    const start = Math.max(0, this.originFrame - frame);
    if (start >= output[0].length) return;
    if (this.pending) phase = this.applyEdit(phase);
    const cycle = 2 * (this.path.approach + this.path.gap);
    for (let index = start; index < output[0].length; index++) {
      sample(this.path, phase, this.pose);
      for (let channel = 0; channel < 4; channel++) {
        const value = this.pose[channel] + this.correction[channel] * this.transition;
        output[channel][index] = channel === 3 ? Math.max(0, Math.min(1, value)) : value;
      }
      this.transition = Math.max(0, this.transition - step / .06);
      phase += step;
      if (phase >= cycle) phase -= cycle;
    }
    this.phase = phase;
  }
}
