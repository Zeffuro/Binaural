import { expect, type Page } from '@playwright/test';

export async function checkHrtfProfiles(page: Page, origin: string, prefix: string, offline = false): Promise<void> {
  if (await page.locator('[data-asmr]').count()) {
    const mixer = page.locator('#asmr-mixer');
    if (await mixer.getAttribute('open') === null) await mixer.locator(':scope > summary').click();
    await page.locator('#asmr-clear').click();
  }
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-only').click();
  const details = page.locator('.asmr-advanced').first();
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await page.getByLabel('Sound 1 sound space', { exact: true }).selectOption('hrtf');
  for (const profile of ['sadie-d1', 'sadie-h10']) {
    await page.getByLabel('Sound 1 headphone profile', { exact: true }).selectOption(profile);
    const response = page.waitForResponse(response => response.url().startsWith(`${origin}${prefix}audio/hrtf/${profile}-`) && response.url().endsWith('.bin'));
    await page.locator('#play').click();
    const binary = await response; expect(binary.ok()).toBe(true);
    if (offline) expect(binary.fromServiceWorker()).toBe(true);
    await expect(page.locator('#status')).toHaveText('● Listening');
    await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
    await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
}
