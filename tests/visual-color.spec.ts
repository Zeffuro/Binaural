import { expect, test, type Page } from '@playwright/test';

async function lightState(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      hue: Number(root.getPropertyValue('--light-hue')),
      saturation: parseFloat(root.getPropertyValue('--light-saturation')),
      level: parseFloat(root.getPropertyValue('--light-level')),
      preview: getComputedStyle(document.querySelector('#visual-preview')!).backgroundImage,
      field: getComputedStyle(document.querySelector('.light-field')!).backgroundImage,
    };
  });
}

test('color picker preserves full colors, neutral colors, and brightness endpoints', async ({ page }) => {
  await page.goto('/');
  const picker = page.getByLabel('Ambient light color', { exact: true });
  for (const [hex, saturation, level] of [
    ['#cc3399', 60, 50], ['#808080', 0, 128 / 255 * 100], ['#000000', 0, 0], ['#ffffff', 0, 100],
  ] as const) {
    await picker.fill(hex);
    await expect(picker).toHaveValue(hex);
    await expect(page.locator('#color-value')).toHaveText(hex.toUpperCase());
    const state = await lightState(page);
    expect(state.saturation).toBeCloseTo(saturation);
    expect(state.level).toBeCloseTo(level);
    expect(state.preview).not.toBe('none');
    expect(state.field).not.toBe('none');
    expect(state.preview).toMatch(/rgb/);
    if (hex === '#000000') expect(state.preview).toContain('rgb(0, 0, 0)');
    if (hex === '#ffffff') expect(state.preview).toContain('rgb(255, 255, 255)');
    await expect(page.getByRole('switch', { name: 'Ambient light' })).not.toBeChecked();
  }
  await picker.fill('#ff0000');
  await page.getByLabel('Color hue').fill('240');
  await expect(picker).toHaveValue('#0000ff');
  await picker.fill('#808080');
  await expect(page.getByLabel('Color hue')).toHaveValue('240');
  await page.getByLabel('Brightness').fill('0');
  await expect(picker).toHaveValue('#000000');
  await page.getByLabel('Brightness').fill('100');
  await expect(picker).toHaveValue('#ffffff');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Color the whole studio').check();
  const panel = await page.locator('.panel').first().evaluate(element => getComputedStyle(element).backgroundColor);
  const channels = panel.match(/[\d.]+/g)!.map(Number);
  expect(channels[0]).toBe(channels[1]);
  expect(channels[1]).toBe(channels[2]);
});

test('picked base color reaches immersive light and remains stable through a paused journey', async ({ page }) => {
  await page.goto('/');
  const picker = page.getByLabel('Ambient light color', { exact: true });
  await picker.fill('#cc3399');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Color the whole studio').check();
  await expect(page.locator('body')).toHaveClass(/color-studio/);
  await page.getByLabel('Light style').selectOption('cycle');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.waitForTimeout(200);
  expect((await lightState(page)).hue).toBeGreaterThan(320);
  await expect(picker).toHaveValue('#cc3399');
  await page.getByRole('button', { name: 'Pause', exact: false }).click();
  await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  const paused = await lightState(page);
  await page.waitForTimeout(200);
  expect(await lightState(page)).toEqual(paused);
  await page.getByRole('button', { name: 'Open immersive light' }).click();
  await expect(page.getByRole('dialog', { name: 'Immersive ambient light' })).toBeVisible();
  const immersive = await lightState(page);
  expect(immersive.field).toContain('rgb');
  expect(immersive.saturation).toBeCloseTo(60);
  expect(immersive.level).toBeCloseTo(50);
  await expect(picker).toHaveValue('#cc3399');
  await page.getByRole('button', { name: 'Close light' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('switch', { name: 'Ambient light' })).not.toBeChecked();
});

test('reduced motion keeps a chosen journey color still without changing its picker', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Ambient light color', { exact: true }).fill('#12abcd');
  await page.getByRole('switch', { name: 'Ambient light' }).check();
  await page.getByLabel('Light style').selectOption('cycle');
  await page.getByRole('button', { name: 'Start listening' }).click();
  const before = await lightState(page);
  await page.waitForTimeout(200);
  expect(await lightState(page)).toEqual(before);
  await expect(page.getByLabel('Ambient light color', { exact: true })).toHaveValue('#12abcd');
});

test('sidebar and dialog scrollbars use readable palettes with no mobile overflow', async ({ page, browserName }) => {
  await page.goto('/');
  const authoredWidths = await page.evaluate(() => [...document.styleSheets]
    .flatMap(sheet => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .map(rule => rule.style.scrollbarWidth).filter(Boolean));
  expect(authoredWidths).toEqual(['auto']);
  const sidebarWidth = await page.locator('.sidebar').evaluate(element => getComputedStyle(element).scrollbarWidth);
  expect(browserName === 'firefox' ? ['auto', 'none'] : ['auto']).toContain(sidebarWidth);
  await page.getByRole('button', { name: 'Explore all presets' }).click();
  const scrollbars = await page.evaluate(() => ['.sidebar', '.explorer-dialog'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector)!);
    return { color: style.scrollbarColor, width: style.scrollbarWidth, thumb: style.getPropertyValue('--scrollbar-thumb').trim(), track: style.getPropertyValue('--scrollbar-track').trim() };
  }));
  for (const bar of scrollbars) {
    expect(bar.color).not.toBe('auto');
    expect(bar.thumb).not.toBe(bar.track);
  }
  expect(browserName === 'firefox' ? ['auto', 'none'] : ['auto']).toContain(scrollbars[1].width);
  expect(scrollbars[0].color).not.toBe(scrollbars[1].color);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Ambient light color', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Ambient light color', { exact: true })).toBeVisible();
});

test('in-page palette supports pointer shades, keyboard controls and incomplete hex input', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[type=color]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose ambient color' }).click();
  await expect(page.locator('#color-palette')).toBeVisible();
  await page.getByLabel('Color hue').fill('0');
  const plane = page.locator('#color-plane');
  const bounds = (await plane.boundingBox())!;
  await plane.click({ position: { x: bounds.width - 1, y: bounds.height / 2 } });
  const color = await page.locator('#visual-color').inputValue();
  expect(parseInt(color.slice(1, 3), 16)).toBeGreaterThan(120);
  expect(parseInt(color.slice(3, 5), 16)).toBeLessThan(3);
  await page.getByLabel('Saturation').fill('0');
  expect((await lightState(page)).saturation).toBe(0);
  const before = await lightState(page);
  await page.getByLabel('Ambient light color', { exact: true }).fill('#x');
  await expect(page.locator('#visual-color')).toHaveAttribute('aria-invalid', 'true');
  expect(await lightState(page)).toEqual(before);
  await page.getByLabel('Ambient light color', { exact: true }).press('Tab');
  await expect(page.locator('#visual-color')).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: 'Use #338dcc' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#visual-color')).toHaveValue('#338dcc');
  await page.setViewportSize({ width: 390, height: 844 });
  await plane.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/inline-color-${test.info().project.name}.png` });
});
