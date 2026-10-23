export interface AsmrSpaceSettings { amount: number; size: number; warmth: number }

export const defaultAsmrSpace = (): AsmrSpaceSettings => ({ amount: 0, size: 1, warmth: .5 });

export const asmrSpacePresets: { id: string; name: string; settings: AsmrSpaceSettings }[] = [
  { id: 'dry', name: 'Dry', settings: defaultAsmrSpace() },
  { id: 'close', name: 'Close room', settings: { amount: .12, size: .75, warmth: .7 } },
  { id: 'soft', name: 'Soft room', settings: { amount: .24, size: 1.25, warmth: .85 } },
];

export function parseAsmrSpace(value: unknown): AsmrSpaceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ASMR room setting.');
  const input = value as Record<string, unknown>;
  for (const [field, min, max] of [['amount', 0, .35], ['size', .5, 1.5], ['warmth', 0, 1]] as const) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < min || input[field] > max) {
      throw new Error('Invalid ASMR room setting.');
    }
  }
  return { amount: input.amount as number, size: input.size as number, warmth: input.warmth as number };
}
