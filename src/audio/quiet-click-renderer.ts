import type { AsmrSpatialSettings } from '../asmr-spatial';
import { quietClickTailSeconds, type QuietClickBank } from './quiet-click-clips';
import { quietClickTurns } from './quiet-click-sequence';

const nearAngle = 78 * Math.PI / 180;
const rearAngle = 135 * Math.PI / 180;
const oppositeRear = 2 * Math.PI - rearAngle;
const ease = (value: number) => value * value * (3 - 2 * value);

interface ClickTurn {
  recording: number;
  visit: number;
  gap: number;
  start: number;
}

interface ClickPath {
  approach: number;
  hold: number;
  turns: ClickTurn[];
  cycleFrames: number;
  visits: number[];
  closest: number;
  reach: number;
  azimuth: number;
  cosElevation: number;
  sinElevation: number;
  speed: number;
}

export class QuietClickRenderer {
  private path: ClickPath;
  private pending?: { settings: AsmrSpatialSettings; speed: number };
  private pass = 0;
  private phase?: number;
  private clip!: Float32Array;
  private turn!: ClickTurn;
  private clipStart = 0;
  private step = 1;
  private skip = false;

  constructor(private banks: readonly QuietClickBank[], settings: AsmrSpatialSettings, speed: number, private rate: number,
      private originFrame: number, private offset: number, private skipPartial: boolean) {
    this.path = this.makePath(settings, speed);
  }

  private makePath(settings: AsmrSpatialSettings, speed: number): ClickPath {
    const timing = settings.quietReturn!, { rate } = this;
    const approach = Math.round(timing.approach * rate);
    const hold = Math.ceil(quietClickTailSeconds / speed * rate) + 1;
    const elevation = settings.elevation * Math.PI / 180, visits = this.banks.map(() => 0);
    let cycleFrames = 0;
    const turns = quietClickTurns(timing).map(({ recording, gap }) => {
      const turn = { recording, gap: Math.round(gap * rate), visit: visits[recording]++, start: cycleFrames };
      cycleFrames += approach + hold + turn.gap;
      return turn;
    });
    return { approach, hold, turns, cycleFrames, visits, closest: timing.closest, reach: Math.max(.60, settings.distance),
      azimuth: settings.azimuth * Math.PI / 180, cosElevation: Math.cos(elevation), sinElevation: Math.sin(elevation),
      speed };
  }

  configure(settings: AsmrSpatialSettings, speed: number): void { this.pending = { settings, speed }; }

  private selectClip(): void {
    const { turns, visits, approach, hold, speed } = this.path;
    const cycle = Math.floor(this.pass / turns.length);
    this.turn = turns[this.pass % turns.length];
    const { recording, visit } = this.turn, bank = this.banks[recording];
    this.clip = bank.clips[(cycle * visits[recording] + visit) % bank.clips.length];
    this.step = bank.sampleRate / this.rate * speed;
    // End the padded recording at the release so its attack lands within the closest hold.
    this.clipStart = approach + hold - Math.ceil(this.clip.length / this.step);
  }

  render(output: Float32Array[], frame: number, stopFrame = Infinity): void {
    const first = Math.max(0, this.originFrame - frame), end = Math.min(output[0].length, stopFrame - frame);
    if (first >= end) return;
    if (this.phase === undefined) {
      const start = Math.round(this.offset * this.rate) + Math.max(0, frame - this.originFrame);
      const { turns, cycleFrames } = this.path;
      const within = start % cycleFrames;
      let turn = turns.length - 1;
      while (turns[turn].start > within) turn--;
      this.pass = Math.floor(start / cycleFrames) * turns.length + turn;
      this.phase = within - turns[turn].start;
      this.selectClip();
      this.skip = this.skipPartial && this.phase > this.clipStart && this.phase < this.path.approach + this.path.hold;
    }
    let phase = this.phase;
    for (let index = first; index < end; index++) {
      const { approach, hold, closest, reach, azimuth, cosElevation, sinElevation } = this.path;
      const { gap } = this.turn;
      const release = approach + hold, side = this.pass % 2 ? 1 : -1;
      const approaching = phase < approach, returning = phase >= release;
      const travel = approaching ? 1 - ease(phase / approach) : returning ? ease((phase - release) / gap) : 0;
      const angle = azimuth + side * (nearAngle + ((returning ? oppositeRear : rearAngle) - nearAngle) * travel);
      const radius = closest + (reach - closest) * travel, horizontal = radius * cosElevation;
      output[0][index] = horizontal * Math.sin(angle);
      output[1][index] = radius * sinElevation;
      output[2][index] = -horizontal * Math.cos(angle);
      if (!this.skip && phase >= this.clipStart && !returning && frame + index + release - phase <= stopFrame) {
        const source = (phase - this.clipStart) * this.step, left = Math.floor(source);
        const firstSample = this.clip[left] ?? 0, secondSample = this.clip[left + 1] ?? 0;
        output[3][index] = firstSample + (secondSample - firstSample) * (source - left);
      }
      if (++phase === release + gap) {
        phase = 0; this.pass++; this.skip = false;
        if (this.pending) {
          this.path = this.makePath(this.pending.settings, this.pending.speed);
          this.pending = undefined;
        }
        this.selectClip();
      }
    }
    this.phase = phase;
  }
}
