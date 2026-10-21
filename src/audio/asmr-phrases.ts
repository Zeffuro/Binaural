import type { AsmrVariation } from '../asmr-variation';

export interface AsmrPhraseConfig {
  variation: AsmrVariation;
  ordinal: number;
  eligible: number[];
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

export function asmrTurn(seed: number, cell: number, eligible: readonly number[]): number | undefined {
  if (!eligible.length) return undefined;
  const bag = [...eligible], cycle = Math.floor(cell / bag.length);
  for (let index = bag.length - 1; index > 0; index--) {
    const other = Math.floor(random(seed, cycle, index, 19) * (index + 1));
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  return bag[cell % bag.length];
}

export function planAsmrPhrase(config: AsmrPhraseConfig, cell: number, sourceSeconds: number,
    turnIndex = Math.floor(cell * config.variation.phraseSeconds / config.variation.turnSeconds)): AsmrPhrase {
  const { variation: settings, ordinal, eligible } = config, period = settings.phraseSeconds, amount = settings.amount;
  const draw = (salt: number) => random(settings.seed, cell, ordinal, salt);
  const leading = period * (.025 + amount * draw(1) * .12);
  const duration = period * (.92 - amount * (.12 + draw(2) * .23)) - leading;
  return { cell, start: cell * period + leading, duration,
    fade: Math.min(duration / 3, .12 + amount * (.16 + draw(3) * .7)),
    offset: draw(4) * sourceSeconds, gain: 1 - amount * draw(5) * .35,
    rate: 1 + amount * (draw(6) * 2 - 1) * .12,
    variant: Math.floor(draw(7) * 3),
    active: eligible.includes(ordinal) && (settings.mode !== 'turns' || asmrTurn(settings.seed, turnIndex, eligible) === ordinal) };
}

export interface AsmrPhrasePcm { channels: Float32Array[]; sampleRate: number; variants?: Float32Array[][] }

export class AsmrPhraseRenderer {
  private phrase?: AsmrPhrase;
  private config: AsmrPhraseConfig;
  private turnIndex = -1;
  private lastFrame = -Infinity;
  private lastRate = 1;
  private ratePhase = 0;
  constructor(private pcm: AsmrPhrasePcm, config: AsmrPhraseConfig) { this.config = config; }
  configure(config: AsmrPhraseConfig): void { this.config = config; this.phrase = undefined; }

  render(output: Float32Array[], sampleRate: number, firstFrame: number, rates: Float32Array | number): void {
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
        for (const channel of output) channel[frame] = 0;
        continue;
      }
      const turnFade = mode === 'turns' ? Math.min(1, (time - turnIndex * turnSeconds) / .35, ((turnIndex + 1) * turnSeconds - time) / .35) : 1;
      const fade = Math.min(turnFade, elapsed / phrase.fade, (phrase.duration - elapsed) / phrase.fade);
      const envelope = Math.sin(fade * Math.PI / 2) ** 2 * phrase.gain;
      const position = ((phrase.offset + (elapsed * rate + this.ratePhase) * phrase.rate) * sourceRate) % sourceLength;
      const index = Math.floor(position), fraction = position - index, next = (index + 1) % sourceLength;
      for (let ear = 0; ear < output.length; ear++) {
        const selected = this.pcm.variants?.[phrase.variant - 1] ?? channels;
        const input = selected[Math.min(ear, selected.length - 1)];
        output[ear][frame] = (input[index] + (input[next] - input[index]) * fraction) * envelope;
      }
    }
  }
}
