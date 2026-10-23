import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openTiming(page: Page): Promise<void> {
  await page.goto('/'); await page.locator('#scene-mode').selectOption('triggers');
  await page.locator('#trigger-preset').selectOption('gesture-brush');
  await page.locator('#trigger-controls details > summary').click();
  await expect(page.locator('#trigger-sync-asmr')).toBeChecked();
}

test('headphone timing is a strict local preference and survives preset changes, reload and automatic reset without consent', async ({ page }) => {
  await openTiming(page);
  const input = page.getByRole('slider', { name: 'Light timing adjustment', exact: true });
  await expect(input).toHaveValue('0'); await expect(page.locator('#light-timing-value')).toHaveText('Automatic');
  await input.fill('120'); await expect(page.locator('#light-timing-value')).toHaveText('120 ms later');
  await expect(page.locator('#trigger-preset')).toHaveValue('gesture-brush');
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await page.locator('#trigger-preset').selectOption('gesture-tap'); await expect(input).toHaveValue('120');
  await page.locator('#save-preset').click();
  const stored = await page.evaluate(() => ({ offset: localStorage.getItem('binaural.light-timing.v1'),
    presets: JSON.parse(localStorage.getItem('binaural.presets.v1')!) }));
  expect(stored.offset).toBe('120'); expect(JSON.stringify(stored.presets)).not.toMatch(/lightTiming|timingOffset|light-timing/);
  await page.locator('#share-session').click();
  const link = await page.getByRole('textbox', { name: 'Session link', exact: true }).inputValue();
  const shared = await page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path); return readSharedSession(new URL(link).hash);
  }, link);
  expect(JSON.stringify(shared)).not.toMatch(/lightTiming|timingOffset|light-timing/);
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  await openTiming(page); await expect(input).toHaveValue('120');
  await input.focus(); await page.keyboard.press('ArrowLeft'); await expect(input).toHaveValue('110');
  await input.fill('-250'); await expect(input).toHaveAttribute('aria-valuetext', '250 ms earlier');
  await page.getByRole('button', { name: 'Use automatic timing', exact: true }).click();
  await expect(input).toHaveValue('0'); await expect(page.locator('#light-timing-value')).toHaveText('Automatic');
  await page.locator('#trigger-sync-asmr').uncheck(); await expect(input).toBeHidden();
  await page.locator('#trigger-sync-asmr').check(); await expect(input).toHaveValue('0');
});

test('headphone timing rejects malformed storage and keeps working without browser storage or session undo events', async ({ page }) => {
  await page.goto('/credits.html');
  const result = await page.evaluate(async () => {
    const path = '/src/light-timing.ts', { lightTimingKey, parseLightTiming, setupLightTiming } = await import(path);
    document.body.innerHTML = '<div id="timing"></div>'; const host = document.querySelector<HTMLElement>('#timing')!;
    localStorage.setItem(lightTimingKey, '9999'); let edits = 0, draws = 0;
    host.addEventListener('focusin', () => edits++); host.addEventListener('input', () => edits++);
    const controller = setupLightTiming(host, () => draws++), initial = controller.offset();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
    try {
      const input = host.querySelector('input')!; input.focus(); input.value = '200'; input.dispatchEvent(new Event('input', { bubbles: true }));
      return { initial, applied: controller.offset(), edits, draws,
        notice: !host.querySelector<HTMLElement>('[role=status]')!.hidden,
        invalid: [null, undefined, '100', {}, NaN, Infinity, -260, 510, 5, .1].map(parseLightTiming),
        valid: [-250, -10, 0, 10, 500].map(parseLightTiming) };
    } finally { Storage.prototype.setItem = original; }
  });
  expect(result).toEqual({ initial: 0, applied: 200, edits: 0, draws: 1, notice: true,
    invalid: Array(10).fill(0), valid: [-250, -10, 0, 10, 500] });
});

test('explicit headphone timing changes follow other tabs and remain accessible on a small screen in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await openTiming(page);
  const other = await page.context().newPage();
  try {
    await openTiming(other); await other.locator('#light-timing-offset').fill('180');
    await expect(page.locator('#light-timing-offset')).toHaveValue('180');
    await other.getByRole('button', { name: 'Use automatic timing', exact: true }).click();
    await expect(page.locator('#light-timing-offset')).toHaveValue('0');
  } finally { await other.close(); }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.locator('#light-timing-offset').fill('500');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.light-timing').analyze()).violations).toEqual([]);
  }
});
