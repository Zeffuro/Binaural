export const asmrVariationModes = ['steady', 'natural', 'turns'] as const;
export interface AsmrVariation {
  mode: typeof asmrVariationModes[number];
  seed: number;
  amount: number;
  phraseSeconds: number;
  turnSeconds: number;
}

export const defaultAsmrVariation = (): AsmrVariation => ({ mode: 'steady', seed: 731, amount: .55, phraseSeconds: 12, turnSeconds: 90 });

export function parseAsmrVariation(value: unknown): AsmrVariation {
  if (value === undefined) return defaultAsmrVariation();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ASMR variation.');
  const settings = value as Record<string, unknown>;
  const bounded = (input: unknown, min: number, max: number): input is number =>
    typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max;
  if (!asmrVariationModes.includes(settings.mode as AsmrVariation['mode']) ||
    !bounded(settings.seed, 1, 2147483647) || !Number.isInteger(settings.seed) ||
    !bounded(settings.amount, 0, 1) || !bounded(settings.phraseSeconds, 4, 30) ||
    !bounded(settings.turnSeconds, 15, 600)) throw new Error('Invalid ASMR variation.');
  return { mode: settings.mode as AsmrVariation['mode'], seed: settings.seed, amount: settings.amount,
    phraseSeconds: settings.phraseSeconds, turnSeconds: settings.turnSeconds };
}
