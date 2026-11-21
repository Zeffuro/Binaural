import { quietReturnRanges, type QuietReturnSettings } from '../asmr-spatial';

const passesPerSequence = 480;
interface ClickTurn { recording: number; gap: number }

export function quietClickTurns(timing: QuietReturnSettings): ClickTurn[] {
  const sequence = timing.sequence;
  if (!sequence) return [{ recording: 0, gap: timing.gap }];
  const size = sequence.recordings.length + 1;
  let state = sequence.seed;
  const draw = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const order: number[] = [];
  for (let start = 0; start < passesPerSequence; start += size) {
    const bag = Array.from({ length: size }, (_, index) => index);
    for (let index = size - 1; index > 0; index--) {
      const other = Math.floor(draw() * (index + 1));
      [bag[index], bag[other]] = [bag[other], bag[index]];
    }
    if (!start) {
      const primary = bag.indexOf(0);
      [bag[0], bag[primary]] = [bag[primary], bag[0]];
    } else if (bag[0] === order[start - 1] && size > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    order.push(...bag);
  }
  if (size > 2 && order.at(-1) === order[0]) {
    [order[order.length - 2], order[order.length - 1]] = [order[order.length - 1], order[order.length - 2]];
  }
  const [min, max] = quietReturnRanges.gap, spread = sequence.gapSpread;
  const from = Math.max(min, timing.gap - spread), to = Math.min(max, timing.gap + spread);
  return order.map(recording => ({ recording, gap: from + (to - from) * draw() }));
}
