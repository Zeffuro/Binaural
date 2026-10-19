import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function assertAccessible(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  if (violations.length) {
    await test.info().attach(`accessibility-${state}`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  }
  expect(violations, `${state}: ${violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`).join('; ')}`).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} studio and preset dialog pass accessibility smoke`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('complementary')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await page.getByRole('button', { name: 'Choose ambient color' }).click();
    await assertAccessible(page, `${colorScheme}-studio`);
    await page.getByRole('button', { name: 'Explore all presets' }).click();
    await expect(page.getByRole('dialog', { name: 'Explore presets' })).toBeVisible();
    await assertAccessible(page, `${colorScheme}-explorer`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Explore all presets' })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertAccessible(page, `${colorScheme}-mobile`);
  });
}

test('skip links expose and focus each major control group with the keyboard', async ({ page }) => {
  await page.goto('/');
  const targets = ['transport', 'tone-controls', 'atmosphere', 'visual-controls'];
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-links a').first()).toBeFocused();
  const first = await page.locator('.skip-links a').first().boundingBox();
  expect(first?.y).toBeGreaterThanOrEqual(0);
  for (const id of targets) {
    const link = page.locator(`.skip-links a[href="#${id}"]`);
    await expect(link).toHaveCount(1);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`#${id}`)).toBeFocused();
  }
  await page.locator('#master').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#master')).toHaveValue('0');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#master')).toHaveValue('0.01');
});

test('pointer targets and small control text remain readable at desktop and narrow widths', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.getByLabel('Preset name', { exact: true }).fill('Accessible targets');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.getByRole('button', { name: 'Choose ambient color' }).click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const minimum = width <= 720 ? 44 : 24;
    const undersized = await page.locator('button:visible, select:visible, input[type=range]:visible').evaluateAll((elements, size) => elements.flatMap(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width < size || bounds.height < size
        ? [{ control: element.id || element.getAttribute('aria-label') || element.textContent?.trim(), width: bounds.width, height: bounds.height }] : [];
    }), minimum);
    expect(undersized, `${width}px pointer targets`).toEqual([]);
    const clipped = await page.locator('#saved-filter:visible, #explore-presets:visible').evaluateAll(elements => elements.filter(element => {
      const style = getComputedStyle(element);
      const contentHeight = element.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
      return contentHeight < parseFloat(style.fontSize);
    }).map(element => element.id || element.className));
    expect(clipped, `${width}px readable sidebar controls`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px horizontal fit`).toBe(true);
  }
  const smallText = await page.locator('.inspector-column label:visible, .fine-print:visible').evaluateAll(elements =>
    elements.filter(element => parseFloat(getComputedStyle(element).fontSize) < 13).map(element => element.textContent?.trim()));
  expect(smallText).toEqual([]);
});

test('forced colors retains visible keyboard focus and selected controls', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add layer' }).focus();
  const focus = await page.getByRole('button', { name: 'Add layer' }).evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.color).not.toBe('rgba(0, 0, 0, 0)');
  const selection = await page.locator('.preset-card.selected').evaluate(element => getComputedStyle(element).outlineStyle);
  expect(selection).toBe('solid');
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeEnabled();
});
