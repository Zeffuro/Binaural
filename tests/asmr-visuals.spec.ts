import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { setupVisuals } from '../src/visuals';

declare global {
  interface Window {
    asmrVisualTest: { visual: ReturnType<typeof setupVisuals>; results: boolean[] };
  }
}

async function mount(page: Page) {
  await page.goto('/credits.html');
  await page.evaluate(async () => {
    for (const name of ['style', 'experience', 'scrollbar', 'theme', 'studio-controls', 'accessibility']) {
      const css = `/src/${name}.css`; await import(css);
    }
    document.body.innerHTML = '<div id="app"><main><h1>Visual controls</h1><div class="transport"></div><div id="visual-controls"></div></main></div><style>.scene-viewport{width:100%;height:200px}[hidden]{display:none!important}</style>';
    const path = '/src/visuals.ts';
    const { setupVisuals } = await import(path) as typeof import('../src/visuals');
    window.asmrVisualTest = { visual: setupVisuals(() => undefined), results: [] };
  });
}
async function pair(page: Page, id = 'very-bright-torch') {
  await page.evaluate(id => { void window.asmrVisualTest.visual.applyAsmrTrigger(id).then(result => window.asmrVisualTest.results.push(result)); }, id);
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Moving visual trigger', exact: true });
const state = (page: Page) => page.evaluate(() => window.asmrVisualTest.visual.getState());

test('paired ASMR acceptance enables an immediate soft static preview without playback or fullscreen', async ({ page }) => {
  await mount(page); await pair(page);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Remember this choice on this browser')).not.toBeChecked();
  await expect(dialog(page)).toContainText('reduced-motion');
  await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.locator('#trigger-enable')).toBeChecked(); await expect(page.locator('.scene-drawing')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([true]);
  const current = (await state(page)).triggers;
  expect(current.brightness).toBeLessThanOrEqual(.65); expect(current.speed).toBeLessThanOrEqual(.015); expect(current.lightSpeed).toBeLessThanOrEqual(.05);
  await expect(page.locator('#scene-independent')).not.toBeChecked();
  await expect(page.locator('.scene-stage')).not.toBeVisible();
  const phase = await page.locator('.scene-drawing').getAttribute('data-light');
  await page.waitForTimeout(120); await expect(page.locator('.scene-drawing')).toHaveAttribute('data-light', phase!);
  await pair(page, 'rose-glass'); await expect(dialog(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([true, true]);
});

test('decline and Escape leave the previous visual and local consent untouched', async ({ page }) => {
  await mount(page); await page.locator('#scene-mode').selectOption('aurora'); const previous = await state(page);
  await pair(page); await dialog(page).getByRole('button', { name: 'Not now', exact: true }).click();
  expect(await state(page)).toEqual(previous); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await pair(page); await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([false, false]);
  expect(await state(page)).toEqual(previous);
});

test('remembered bounded approval requires an explicit pair action and manual off revokes it', async ({ page }) => {
  await mount(page); await pair(page);
  await dialog(page).getByLabel('Remember this choice on this browser').check();
  await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  const saved = await state(page);
  await mount(page);
  await page.evaluate(saved => window.asmrVisualTest.visual.restore(saved), saved);
  await expect(page.locator('#trigger-enable')).not.toBeChecked(); await expect(page.locator('.scene-drawing')).not.toBeVisible();
  await expect(page.locator('#milkdrop-enable')).not.toBeChecked();
  await pair(page); await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([true]);
  await expect(dialog(page)).not.toBeVisible();
  await page.locator('#trigger-enable').uncheck(); await pair(page); await expect(dialog(page)).toBeVisible();
});

test('older visual approval does not bypass the sound-reactive pulse notice', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => localStorage.setItem('binaural:asmr-soft-visual-approval:v1', 'soft-slow'));
  await mount(page); await pair(page);
  await expect(dialog(page)).toBeVisible(); await expect(dialog(page)).toContainText('rapid pulses');
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await dialog(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
});

test('restore, emergency stop, another scene and repeated pair actions cancel stale consent', async ({ page }) => {
  await mount(page);
  for (const action of ['restore', 'stop', 'scene', 'repeat']) {
    await pair(page); await expect(dialog(page)).toBeVisible();
    await page.evaluate(action => {
      const test = window.asmrVisualTest;
      if (action === 'restore') test.visual.restore(test.visual.getState());
      if (action === 'stop') test.visual.stop();
      if (action === 'scene') test.visual.toggle();
      if (action === 'repeat') void test.visual.applyAsmrTrigger('red-scan').then(result => test.results.push(result));
    }, action);
    if (action === 'repeat') {
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole('button', { name: 'Not now', exact: true }).click();
    }
    await expect(dialog(page)).not.toBeVisible(); await expect(page.locator('#trigger-enable')).not.toBeChecked();
  }
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([false, false, false, false, false]);
});

test('an accepted dialog cannot apply or remember after a same-task restore', async ({ page }) => {
  await mount(page); await pair(page);
  await dialog(page).getByLabel('Remember this choice on this browser').check();
  await page.evaluate(() => {
    const visual = window.asmrVisualTest.visual, saved = visual.getState();
    document.querySelector<HTMLButtonElement>('.asmr-visual-consent [data-accept]')!.click();
    visual.restore(saved);
  });
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([false]);
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
  await pair(page); await expect(dialog(page)).toBeVisible();
});

test('blocked browser storage preserves explicit tab approval', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
    Storage.prototype.removeItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
  });
  await pair(page); await dialog(page).getByLabel('Remember this choice on this browser').check();
  await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  await pair(page, 'red-scan'); await expect(dialog(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.asmrVisualTest.results)).toEqual([true, true]);
  await page.locator('#trigger-enable').uncheck(); await pair(page); await expect(dialog(page)).toBeVisible();
});

test('ASMR simple controls round trip existing fields and preserve advanced 400% and generic controls', async ({ page }) => {
  await mount(page); await pair(page); await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  await expect(page.getByLabel('ASMR intensity', { exact: true })).toBeVisible();
  await expect(page.locator('#trigger-preset')).not.toBeVisible(); await expect(page.locator('#trigger-brightness')).not.toBeVisible();
  await page.getByLabel('ASMR intensity', { exact: true }).selectOption('focused');
  await page.getByLabel('ASMR pace', { exact: true }).selectOption('still');
  await page.getByLabel('ASMR position', { exact: true }).selectOption('left');
  const saved = await state(page);
  expect(saved.triggers).toMatchObject({ brightness: .65, speed: 0, drift: 0, lightSpeed: 0, path: 'manual', offsetX: -.65 });
  await page.getByText('Advanced visual settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Very bright', exact: true }).click();
  await expect(page.locator('#trigger-brightness')).toHaveValue('4');
  await page.evaluate(saved => window.asmrVisualTest.visual.restore(saved), saved);
  expect((await state(page)).triggers).toEqual(saved.triggers);
  await expect(page.getByLabel('ASMR intensity', { exact: true })).not.toBeVisible();
  await expect(page.locator('#trigger-brightness')).toBeVisible();
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
});

test('reduced motion keeps accepted paired lights still, including explicit animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mount(page); await pair(page);
  await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  await page.locator('#scene-independent').check(); const canvas = page.locator('.scene-drawing');
  const first = await canvas.getAttribute('data-light'); await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-light', first!); await expect(canvas).toHaveAttribute('data-glass', '0.0000');
});

test('consent and ASMR controls fit 320px with accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await mount(page); await pair(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dialog(page).getByRole('button', { name: 'Start visual', exact: true })).toBeFocused();
  const consentResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(consentResult.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Start visual', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});
