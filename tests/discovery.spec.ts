import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('guided setup loads a complete session silently and remains optional', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Make a little listening space' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
  await page.getByLabel('Start with', { exact: true }).selectOption('background');
  await page.getByLabel('How long?', { exact: true }).selectOption('10');
  await page.getByLabel('A visual atmosphere', { exact: true }).selectOption('nature:forest-slope');
  await page.getByRole('button', { name: 'Load session', exact: true }).click();
  await expect(page.locator('#playing-title')).toHaveText('A little ocean');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#minutes')).toHaveValue('10');
  await expect(page.locator('#master')).toHaveValue('0.15');
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('nature:forest-slope');
  await expect(page.locator('#scene-mute-tones')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save to my presets' }).click();
  await page.reload(); await page.locator('.saved-preset').click();
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('nature:forest-slope');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('all six soundscapes load their complete mix and scene without autoplay', async ({ page }) => {
  await page.goto('/');
  const recipes = [
    ['Forest clearing', 'nature:forest-slope', 'wind', false], ['First light', 'nature:mountain-dawn', 'pink', false],
    ['Meadow air', 'nature:autumn-meadow', 'wind', true], ['Blue current', 'water', 'ocean', false],
    ['Northern quiet', 'aurora', 'brown', false], ['Music room', 'scope', 'none', true],
  ] as const;
  for (const [name, scene, ambient, muted] of recipes) {
    await page.getByRole('button', { name: 'Explore all presets' }).click();
    await page.getByLabel('With visual settings', { exact: true }).check();
    await expect(page.locator('.explore-card')).toHaveCount(59);
    await page.getByRole('button', { name: `Load ${name}`, exact: false }).filter({ hasNotText: 'Load and play' }).click();
    await expect(page.locator('#playing-title')).toHaveText(name);
    await expect(page.getByLabel('Scene', { exact: true })).toHaveValue(scene);
    await expect(page.locator('#ambient')).toHaveValue(ambient);
    await expect(page.locator('#scene-mute-tones')).toHaveAttribute('aria-pressed', String(muted));
    await expect(page.locator('#status')).toHaveText('Ready when you are');
    await expect(page.getByLabel('Enable MilkDrop visuals')).not.toBeChecked();
    await expect(page.getByLabel('Animate without audio')).not.toBeChecked();
  }
});

test('guide starts only on explicit Start and cancelling a pending load never starts audio', async ({ page }) => {
  await page.addInitScript(() => {
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = async function() { await new Promise(resolve => setTimeout(resolve, 600)); await close.call(this); };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
  await page.getByLabel('Start with', { exact: true }).selectOption('focus');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  await expect(page.locator('#playing-title')).toHaveText('Reading room');
  await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
  await page.getByLabel('Start with', { exact: true }).selectOption('explore');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Make a little listening space' })).not.toBeVisible();
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#playing-title')).toHaveText('Octave lanterns');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('frequency favorites persist locally, filter searches and preserve tone selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  const favorite = page.getByRole('button', { name: 'Favorite Love', exact: true });
  await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Show frequencies', { exact: true }).selectOption('favorites');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(1);
  await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  await expect(page.locator('.tone-layer')).toHaveCount(3);
  await expect(page.locator('.tone-layer').last().locator('[data-field=route]')).toHaveValue('mixed');
  await page.reload(); await page.getByLabel('Show frequencies', { exact: true }).selectOption('favorites');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(1);
  await page.getByLabel('Find a frequency, name or tradition').fill('theta');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(0);
  await page.getByLabel('Find a frequency, name or tradition').fill('');
  await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  await page.getByRole('button', { name: 'Favorite Love', exact: true }).click();
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(0);
  await page.reload(); await page.getByLabel('Show frequencies', { exact: true }).selectOption('favorites');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(0);
});

test('invalid and unavailable favorite storage never damages the frequency catalog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('binaural.frequency.favorites', JSON.stringify(['carrier:528', 'beat:6', 'javascript:wrong', null, 9])));
  await page.goto('/'); await page.getByLabel('Show frequencies', { exact: true }).selectOption('favorites');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(2);
  await page.getByRole('button', { name: /^Theta 6 Hz/ }).click();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'binaural.frequency.favorites') throw new Error('Storage unavailable'); set.call(this, key, value); };
  });
  const favorite = page.getByRole('button', { name: 'Favorite Theta', exact: true });
  await favorite.click(); await expect(page.locator('#notice')).toContainText('Storage unavailable');
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(2);
});

test('frequency favorites stay synchronized across local tabs', async ({ page, context }) => {
  await page.goto('/'); await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
  const favorite = page.getByRole('button', { name: 'Favorite Love', exact: true });
  await favorite.click(); await page.getByLabel('Show frequencies', { exact: true }).selectOption('favorites');
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => localStorage.setItem('binaural.frequency.favorites', '[]'));
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(0);
  await other.evaluate(() => localStorage.setItem('binaural.frequency.favorites', '["carrier:528"]'));
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#frequencies [data-frequency]')).toHaveCount(1);
  await other.close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} guide and favorite controls remain accessible on desktop and mobile`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' }); await page.goto('/');
    await page.getByRole('button', { name: /^Love 528 Hz/ }).click();
    await page.getByRole('button', { name: 'Favorite Love', exact: true }).click();
    const check = async () => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
    };
    await check();
    await page.getByRole('button', { name: 'Help me choose', exact: true }).click();
    await check();
    await page.setViewportSize({ width: 320, height: 844 }); await check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/guide-${colorScheme}-${test.info().project.name}.png` });
  });
}
