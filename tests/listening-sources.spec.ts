import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setSources } from './helpers/listening-sources';

async function range(input: Locator, value: string) {
  await input.focus();
  await input.evaluate((element: HTMLInputElement, next) => {
    element.value = next; element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function share(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share session', exact: true })).toHaveCount(0);
  return link;
}

test('all four source combinations survive JSON, shared links and saved presets without changing the mix', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=fabric]').click();
  await range(page.locator('#master'), '0.33');
  await range(page.locator('#asmr-level'), '0.38');
  for (const mode of ['binaural', 'asmr', 'mixed', 'ambient'] as const) {
    await setSources(page, mode);
    const downloadReady = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadReady;
    const session = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(session).toMatchObject({ mode, master: .33, ambientLevel: .2, musicLevel: .4, asmr: { level: .38 } });
    expect(session.asmr.layers).toHaveLength(1); expect(session.asmr.layers[0].sound).toBe('fabric');
    expect(session.layers).toHaveLength(1); expect(session.layers[0].level).toBe(.6);
    const link = await share(page);
    await page.goto('about:blank'); await page.goto(link);
    await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', String(mode === 'binaural' || mode === 'mixed'));
    await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', String(mode === 'asmr' || mode === 'mixed'));
    await expect(page.locator('#master')).toHaveValue('0.33');
    await expect(page.locator('#status')).toHaveText('Ready when you are');
  }
  await page.getByLabel('Preset name', { exact: true }).fill('Just atmosphere');
  await page.locator('#save-preset').click();
  await expect(page.locator('#notice')).toContainText('saved');
  await page.reload(); await page.locator('.saved-preset').filter({ hasText: 'Just atmosphere' }).click();
  await expect(page.locator('#preset-name')).toHaveValue('Just atmosphere');
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#master')).toHaveValue('0.33');
  await expect(page.locator('#asmr-level')).toHaveValue('0.38');
  await expect(page.locator('#asmr-sound-0')).toHaveValue('fabric');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('inactive settings stay editable and adding a frequency turns tones on alongside ASMR', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-asmr-sound=brush]').click();
  await setSources(page, 'ambient');
  await page.locator('#asmr-mixer > summary').click();
  await range(page.getByLabel('Sound 1 volume', { exact: true }), '0.31');
  await expect(page.locator('#asmr-mixer')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await setSources(page, 'asmr');
  await expect(page.getByLabel('Sound 1 volume', { exact: true })).toHaveValue('0.31');
  await page.locator('#frequency-browser > summary').click();
  await page.locator('[data-frequency]').first().click();
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tone-layer')).toHaveCount(2);
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('#undo-edit').click();
  await expect(page.locator('.tone-layer')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Tones (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^ASMR (?:On|Off)$/ })).toHaveAttribute('aria-pressed', 'true');
});
