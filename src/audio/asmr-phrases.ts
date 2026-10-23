import type { AsmrVariation } from '../asmr-variation';
import { sourceMarker, sourceMarkerIndex, type AsmrMarkerEvent, type AsmrMarkerSample } from './asmr-markers';

export interface AsmrPhraseConfig {
  variation: AsmrVariation;
  ordinal: number;
  eligible: number[];
  families?: readonly string[];
  sounds?: readonly string[];
}
export interface AsmrPhrase {
  cell: number;
  start: number;
  duration: number;
  fade: number;
  offset: number;
  gain: number;
  rate: number;
  active: boolean;
  variant: number;
}

function random(seed: number, cell: number, ordinal: number, salt: number): number {
  let value = seed ^ Math.imul(cell >>> 0, 0x9e3779b1) ^ Math.imul(Math.floor(cell / 4294967296), 0x85ebca6b);
  value ^= Math.imul(ordinal + 1, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function shuffled(seed: number, cycle: number, eligible: readonly number[]): number[] {
  const bag = [...eligible];
  for (let index = bag.length - 1; index > 0; index--) {
    const other = Math.floor(random(seed, cycle, index, 19) * (index + 1));
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  return bag;
}

export function asmrTurn(seed: number, cell: number, eligible: readonly number[],
    families?: readonly string[], sounds?: readonly string[]): number | undefined {
  if (!eligible.length) return undefined;
  const cycle = Math.floor(cell / eligible.length), position = cell % eligible.length;
  if (eligible.length < 3) return shuffled(seed, 0, eligible)[position];
  // Fixed cycle endpoints make boundary avoidance independent of playback history.
  const endpoint = (index: number) => eligible[Math.floor(random(seed, index, 0, 43) * eligible.length)];
  const last = endpoint(cycle), previous = endpoint(cycle - 1);
  const remaining = shuffled(seed, cycle, eligible).filter(value => value !== last);
  const penalty = (left: number, right: number) =>
    (families?.[left] !== undefined && families[left] === families[right] ? 1 : 0) +
    (sounds?.[left] !== undefined && sounds[left] === sounds[right] ? 2 : 0);
  let best: number[] = [], bestScore = Infinity;
  const visit = (prefix: number[], pool: number[], before: number, score: number): void => {
    if (score >= bestScore) return;
    if (!pool.length) {
      const total = score + penalty(before, last);
      if (total < bestScore) { bestScore = total; best = [...prefix, last]; }
      return;
    }
    for (let index = 0; index < pool.length; index++) {
      const next = pool[index];
      if (!prefix.length && next === previous) continue;
      visit([...prefix, next], pool.filter((_, at) => at !== index), next, score + penalty(before, next));
    }
  };
  // The mixer allows six layers; larger internal bags only need boundary avoidance.
  if (eligible.length <= 6 && (families || sounds)) visit([], remaining, previous, 0);
  if (!best.length) {
    if (remaining[0] === previous) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
    best = [...remaining, last];
  }
  return best[position];
}

export function planAsmrPhrase(config: AsmrPhraseConfig, cell: number, sourceSeconds: number,
    turnIndex = Math.floor(cell * config.variation.phraseSeconds / config.variation.turnSeconds)): AsmrPhrase {
  const { variation: settings, ordinal, eligible } = config, period = settings.phraseSeconds, amount = settings.amount;
  const draw = (salt: number) => random(settings.seed, cell, ordinal, salt);
  const choice = (salt: number, count: number) => asmrTurn(
    settings.seed ^ Math.imul(ordinal + 1, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2d),
    cell, Array.from({ length: count }, (_, index) => index))!;
  const varied = (salt: number, count: number) => (choice(salt, count) + .2 + draw(salt) * .6) / count;
  const leading = period * (.025 + amount * varied(1, 4) * .12);
  const duration = period * (.92 - amount * (.12 + varied(2, 4) * .23)) - leading;
  return { cell, start: cell * period + leading, duration,
    fade: Math.min(duration / 3, .12 + amount * (.16 + draw(3) * .7)),
    offset: varied(4, 8) * sourceSeconds, gain: 1 - amount * draw(5) * .35,
    rate: 1 + amount * (varied(6, 4) * 2 - 1) * .12,
    variant: choice(7, 3),
    active: eligible.includes(ordinal) && (settings.mode !== 'turns' ||
      asmrTurn(settings.seed, turnIndex, eligible, config.families, config.sounds) === ordinal) };
}

export interface AsmrPhrasePcm {
  channels: Float32Array[];
  sampleRate: number;
  variants?: Float32Array[][];
  events?: readonly AsmrMarkerEvent[][];
}

export class AsmrPhraseRenderer {
  private phrase?: AsmrPhrase;
  private config: AsmrPhraseConfig;
  private turnIndex = -1;
  private lastFrame = -Infinity;
  private lastRate = 1;
  private ratePhase = 0;
  private markerFrame = -Infinity;
  private markerIndex = -2;
  private markerCell = 0;
  private markerTurn = 0;
  private markerVariant = 0;
  private markerCycle = 0;
  constructor(private pcm: AsmrPhrasePcm, config: AsmrPhraseConfig) { this.config = config; }
  configure(config: AsmrPhraseConfig): void { this.config = config; this.phrase = undefined; }

  private markerDue(frame: number, sampleRate: number, contiguous: boolean, index: number,
      cell = 0, turn = 0, variant = 0, cycle = 0): boolean {
    if (contiguous && frame - this.markerFrame < sampleRate / 40 && index === this.markerIndex && cell === this.markerCell &&
        turn === this.markerTurn && variant === this.markerVariant && cycle === this.markerCycle) return false;
    this.markerFrame = frame; this.markerIndex = index; this.markerCell = cell;
    this.markerTurn = turn; this.markerVariant = variant; this.markerCycle = cycle;
    return true;
  }

  render(output: Float32Array[], sampleRate: number, firstFrame: number, rates: Float32Array | number,
      observe?: (sample: AsmrMarkerSample) => void): void {
    const { channels, sampleRate: sourceRate } = this.pcm, sourceLength = channels[0].length;
    const { phraseSeconds: period, turnSeconds, mode } = this.config.variation;
    for (let frame = 0; frame < output[0].length; frame++) {
      const absoluteFrame = firstFrame + frame, time = absoluteFrame / sampleRate, cell = Math.floor(time / period);
      const rate = typeof rates === 'number' ? Math.fround(rates) : rates.length === 1 ? rates[0] : rates[frame];
      const contiguous = absoluteFrame === this.lastFrame + 1;
      const turnIndex = mode === 'turns' ? Math.floor(time / turnSeconds) : 0;
      if (this.phrase?.cell !== cell || this.turnIndex !== turnIndex) {
        this.phrase = planAsmrPhrase(this.config, cell, sourceLength / sourceRate, turnIndex); this.turnIndex = turnIndex;
        this.ratePhase = 0;
      }
      const phrase = this.phrase, elapsed = time - phrase.start;
      if (!contiguous || elapsed < 0) this.ratePhase = 0;
      else if (rate !== this.lastRate) this.ratePhase += (elapsed - 1 / sampleRate) * (this.lastRate - rate);
      this.lastFrame = absoluteFrame; this.lastRate = rate;
      if (!phrase.active || elapsed < 0 || elapsed >= phrase.duration) {
        if (observe && this.markerDue(absoluteFrame, sampleRate, contiguous, -1)) observe({ time, pose: null, event: 'quiet' });
        for (const channel of output) channel[frame] = 0;
        continue;
      }
      const turnFade = mode === 'turns' ? Math.min(1, (time - turnIndex * turnSeconds) / .35, ((turnIndex + 1) * turnSeconds - time) / .35) : 1;
      const fade = Math.min(turnFade, elapsed / phrase.fade, (phrase.duration - elapsed) / phrase.fade);
      const envelope = Math.sin(fade * Math.PI / 2) ** 2 * phrase.gain;
      const position = ((phrase.offset + (elapsed * rate + this.ratePhase) * phrase.rate) * sourceRate) % sourceLength;
      const index = Math.floor(position), fraction = position - index, next = (index + 1) % sourceLength;
      if (observe) {
        const events = this.pcm.events?.[phrase.variant];
        const markerIndex = events ? sourceMarkerIndex(events, position, sourceLength) : -1;
        const cycle = Math.floor((phrase.offset + (elapsed * rate + this.ratePhase) * phrase.rate) * sourceRate / sourceLength);
        if (this.markerDue(absoluteFrame, sampleRate, contiguous, markerIndex, cell, turnIndex, phrase.variant, cycle)) {
          const marker = events && markerIndex >= 0 ? sourceMarker(events, position, sourceLength, sourceRate) : undefined;
          observe({ time, pose: marker?.pose ?? null,
            event: marker ? `${cell}:${turnIndex}:${phrase.variant}:${cycle}:${markerIndex}` : 'quiet' });
        }
      }
      for (let ear = 0; ear < output.length; ear++) {
        const selected = this.pcm.variants?.[phrase.variant - 1] ?? channels;
        const input = selected[Math.min(ear, selected.length - 1)];
        output[ear][frame] = (input[index] + (input[next] - input[index]) * fraction) * envelope;
      }
    }
  }
}
