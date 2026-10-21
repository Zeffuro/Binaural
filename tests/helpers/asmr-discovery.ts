import type { Page } from '@playwright/test';

export async function loadAsmrExperience(page: Page, id: string): Promise<void> {
  await page.locator('#asmr-browse').click();
  await page.locator(`[data-load-preset="asmr-${id}"]`).click();
}
