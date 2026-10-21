import type { Page } from '@playwright/test';

export async function setSources(page: Page, mode: 'binaural' | 'asmr' | 'mixed' | 'ambient'): Promise<void> {
  const targets = { binaural: [true, false], asmr: [false, true], mixed: [true, true], ambient: [false, false] }[mode];
  for (const [index, name] of ['Tones', 'ASMR'].entries()) {
    const button = page.getByRole('button', { name: new RegExp(`^${name} (?:On|Off)$`) });
    if (await button.getAttribute('aria-pressed') !== String(targets[index])) await button.click();
  }
}
