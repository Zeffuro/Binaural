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
    ['recorded-sketching-long', 'pencil-sketching-long.wav'], ['recorded-plastic-lid', 'plastic-lid-clicks.mp3'],
    ['recorded-plastic-snap', 'plastic-calculator-snap.mp3'], ['recorded-plastic-toy', 'plastic-toy-clicks.mp3'],
    ['recorded-plastic-zip-tie', 'plastic-zip-tie-clicks.mp3'],
  ] as const) {
    await page.getByLabel('Sound 1 trigger', { exact: true }).selectOption(id);
    const loaded = page.waitForResponse(`${origin}${prefix}audio/asmr/${file}`);
    await page.locator('#play').click();
    const response = await loaded;
    const type = file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/flac';
    expect(response.ok()).toBe(true); expect(response.headers()['content-type']).toBe(type);
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
  await expect(page.locator('#trigger-enable')).toBeChecked();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('● Listening');
  const drawing = page.locator('.scene-drawing'); await drawing.scrollIntoViewIfNeeded();
  await expect(drawing).toBeInViewport();
  await page.waitForFunction(() => Number(document.querySelector<HTMLCanvasElement>('.scene-drawing')?.dataset.cues) > 0,
    undefined, { timeout: 35000 });
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const frozen = await drawing.getAttribute('data-cue-time');
  await page.waitForTimeout(150); await expect(drawing).toHaveAttribute('data-cue-time', frozen!);
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(drawing).toHaveAttribute('data-cues', '0');

  for (const id of ['plastic-quiet-approach', 'hinge-clicks-by-ear', 'plastic-clicks-after-dark']) {
    await page.locator('#asmr-browse').click();
    await page.locator(`[data-load-preset="asmr-${id}"]`).click();
    if (await consent.isVisible()) await consent.getByRole('button', { name: 'Not now', exact: true }).click();
    const both = page.getByRole('button', { name: 'Preview both ears for sound 1', exact: true });
    await both.click();
    await expect(page.locator('#asmr-preview-status')).toHaveText('Previewing both approaches.');
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await page.getByRole('button', { name: 'Stop preview of sound 1', exact: true }).click();
    await expect(both).toBeEnabled();
  }
}
