import { expect, test, type Locator } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

async function assertDarkSurface(locator: Locator): Promise<void> {
  const result = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string): number => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const background = luminance(style.backgroundColor);
    const foreground = luminance(style.color);
    return { background, contrast: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) };
  });
  expect(result.background).toBeLessThan(.12);
  expect(result.contrast).toBeGreaterThanOrEqual(4.5);
}

async function assertChipContrast(chips: Locator): Promise<void> {
  const ratios = await chips.evaluateAll(buttons => {
    const luminance = (color: string): number => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    return buttons.flatMap(button => {
      const background = luminance(getComputedStyle(button).backgroundColor);
      return [...button.querySelectorAll('span, strong, small')].map(label => {
        const foreground = luminance(getComputedStyle(label).color);
        return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
      });
    });
  });
  expect(ratios.length).toBeGreaterThan(0);
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
}

test('frequency chip labels stay legible immediately after switching to dark, hovering and changing studio hue', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  const chips = page.locator('.frequency-chips button');
  await assertChipContrast(chips);
  await chips.first().hover();
  await assertChipContrast(chips);
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Color the whole studio').check();
  await page.getByLabel('Ambient light color', { exact: true }).fill('#cc3399');
  await assertChipContrast(chips);
  await chips.first().hover();
  await assertChipContrast(chips);
});

test('appearance follows the system by default and responds to live changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('dark');
  await assertDarkSurface(page.locator('.tone-panel'));
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('light');
});

test('explicit appearance persists and ignores system changes until System is selected', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await page.reload();
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Appearance', { exact: true }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('system');
});

test('invalid or unavailable preference storage falls back to system and controls still work', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('binaural.appearance', 'unknown'));
  await page.reload();
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'binaural.appearance') throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'binaural.appearance') throw new DOMException('Blocked', 'SecurityError');
      set.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('dark controls and dialogs stay readable while whole studio color keeps a dark surface', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await assertDarkSurface(page.locator('#preset-name'));
  await assertDarkSurface(page.locator('.frequency-inputs input').first());
  await page.screenshot({ path: `test-results/theme-dark-${test.info().project.name}.png`, fullPage: true });
  await page.getByLabel('Color hue').fill('280');
  const preview = await page.locator('#visual-preview').evaluate(el => getComputedStyle(el).backgroundImage);
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Color the whole studio').check();
  await assertDarkSurface(page.locator('body'));
  await assertDarkSurface(page.locator('.tone-panel'));
  await assertDarkSurface(page.locator('.transport'));
  await page.screenshot({ path: `test-results/theme-hue-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Explore all presets' }).click();
  await assertDarkSurface(page.locator('#preset-explorer'));
  await assertDarkSurface(page.locator('.explore-card').first());
  await page.keyboard.press('Escape');
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  expect(await page.locator('#visual-preview').evaluate(el => getComputedStyle(el).backgroundImage)).toBe(preview);
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await page.getByLabel('Ambient light color', { exact: true }).fill('#808080');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await expect(page.locator('body')).toHaveClass(/color-studio/);
  for (const selector of ['body', '.tone-panel', '.transport', '.sidebar']) {
    const color = await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor);
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(1);
  }
  await assertDarkSurface(page.locator('.tone-panel'));
  await page.locator('#import-file').setInputFiles({ name: 'fixture.bwg', mimeType: 'application/octet-stream', buffer: Buffer.from(makeBwgFixture()) });
  await assertDarkSurface(page.getByRole('dialog', { name: 'Review BWGen import' }));
  await page.getByRole('button', { name: 'Load imported session' }).click();
  await expect(page.locator('.frequency-inputs input').first()).toBeDisabled();
  await assertDarkSurface(page.locator('.frequency-inputs input').first());
});

test('appearance remains accessible without horizontal overflow on narrow mobile viewports', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByLabel('Appearance', { exact: true })).toBeVisible();
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await assertDarkSurface(page.locator('#site-theme'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/theme-mobile-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Explore all presets' }).click();
  await assertDarkSurface(page.locator('#preset-explorer'));
  expect(await page.locator('#preset-explorer').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
