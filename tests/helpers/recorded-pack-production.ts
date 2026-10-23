import { expect, type Page } from '@playwright/test';

export async function checkRecordedPack(page: Page, origin: string, prefix: string, offline = false): Promise<void> {
  if (await page.locator('[data-asmr]').count()) {
    const mixer = page.locator('#asmr-mixer');
    if (await mixer.getAttribute('open') === null) await mixer.locator(':scope > summary').click();
    await page.locator('#asmr-clear').click();
  }
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-only').click();
  for (const [id, file] of [
    ['recorded-blanket', 'blanket-movement.flac'], ['recorded-zipper', 'zipper-slide.flac'],
    ['recorded-sketchbook', 'sketchbook-pages.flac'], ['recorded-sketching', 'pencil-sketching.flac'],
    ['recorded-mist', 'bottle-mist.flac'], ['recorded-running-water', 'running-water.flac'],
  ] as const) {
    await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption(id);
    const loaded = page.waitForResponse(`${origin}${prefix}audio/asmr/${file}`);
    await page.locator('#play').click();
    const response = await loaded;
    expect(response.ok()).toBe(true); expect(response.headers()['content-type']).toBe('audio/flac');
    if (offline) expect(response.fromServiceWorker()).toBe(true);
    await expect(page.locator('#status')).toHaveText('● Listening');
    await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
    await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await page.locator('#asmr-browse').click();
  await page.locator('[data-load-preset="asmr-pencil-lines-after-dark"]').click();
  const consent = page.getByRole('dialog', { name: 'Moving visual trigger', exact: true });
  if (await consent.isVisible()) await consent.getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.locator('#asmr-flow')).toHaveValue('natural');
  await expect(page.locator('#trigger-sync-asmr')).toBeChecked();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  const drawing = page.locator('.scene-drawing'); await drawing.scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await drawing.getAttribute('data-cues')), { timeout: 15000 }).toBeGreaterThan(0);
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const frozen = await drawing.getAttribute('data-cue-time');
  await page.waitForTimeout(150); await expect(drawing).toHaveAttribute('data-cue-time', frozen!);
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(drawing).toHaveAttribute('data-cues', '0');
}
