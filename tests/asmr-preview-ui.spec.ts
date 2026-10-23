import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function sharedSettings(page: Page) {
  await page.locator('#share-session').click();
  const link = await page.getByLabel('Session link', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close share', exact: true }).click();
  return page.evaluate(async link => {
    const path = '/src/share.ts', { readSharedSession } = await import(path);
    const value = readSharedSession(new URL(link).hash);
    const withoutIds = (layers: { id: string }[]) => layers.map(({ id: _id, ...layer }) => layer);
    return { ...value, layers: withoutIds(value.layers), asmr: { ...value.asmr, layers: withoutIds(value.asmr.layers) } };
  }, link);
}

async function observeContexts(page: Page) {
  await page.addInitScript(() => {
    const Original = window.AudioContext, contexts: AudioContext[] = [];
    Object.assign(window, { previewContexts: contexts });
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
    };
  });
}

test('hair and writing quick choices add existing recordings silently without duplicates', async ({ page }) => {
  await page.goto('/');
  for (const [sound, name] of [['recorded-hair', 'Hair'], ['recorded-writing', 'Writing']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator(`[data-asmr-sound="${sound}"]`).click();
  }
  await expect(page.locator('.asmr-layer')).toHaveCount(2);
  await expect(page.getByLabel('Sound 1 trigger', { exact: true })).toHaveValue('recorded-hair');
  await expect(page.getByLabel('Sound 2 trigger', { exact: true })).toHaveValue('recorded-writing');
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeEnabled();
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#asmr-preview-status')).toContainText('five seconds at your current volume');
});

test('preview controls preserve focus, avoid edit history and expose loading, cancellation, busy and errors', async ({ page }) => {
  await page.goto('/credits.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<section id="asmr-controls"></section>';
    const controlsPath = '/src/asmr-controls.ts', statePath = '/src/asmr-state.ts';
    const { setupAsmr } = await import(controlsPath), { defaultAsmr, makeAsmrLayer } = await import(statePath);
    const settings = { ...defaultAsmr(), layers: [makeAsmrLayer('brush'), makeAsmrLayer('recorded-hair')] };
    let state: { phase: 'idle' | 'loading' | 'playing' | 'stopping'; id?: string; error?: string } = { phase: 'idle' };
    let blocked = false, busy = false, edits = 0, checkpoints = 0, starts = 0, stops = 0;
    const controls = setupAsmr({ get: () => settings, update: () => edits++, beforeEdit: () => checkpoints++,
      busy: () => busy, isolate: () => {}, importedMute: () => undefined, muteImported: () => {},
      preview: { state: () => state, blocked: () => blocked,
        start: (id: string) => { starts++; state = { phase: 'loading', id }; controls.refreshPreview(); },
        stop: () => { stops++; state = { phase: 'stopping', id: state.id }; controls.refreshPreview(); } } });
    const button = () => document.querySelector<HTMLButtonElement>('[data-preview]')!;
    button().focus(); button().click();
    const loading = button().textContent === 'Stop preview' && !button().disabled && document.querySelector('#asmr-preview-status')!.textContent === 'Loading preview…';
    controls.refresh(); const focused = document.activeElement === button();
    button().click(); const stopping = button().disabled;
    state = { phase: 'idle' }; controls.refreshPreview();
    blocked = true; controls.transport(); const mainBlocked = button().disabled;
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    blocked = false; busy = true; controls.transport(); const busyBlocked = button().disabled;
    busy = false; state = { phase: 'idle', error: 'Recording unavailable. Try again.' }; controls.transport();
    return { loading, focused, stopping, mainBlocked, busyBlocked, starts, stops, edits, checkpoints,
      error: document.querySelector('#asmr-preview-status')!.textContent, retry: !button().disabled };
  });
  expect(result).toEqual({ loading: true, focused: true, stopping: true, mainBlocked: true, busyBlocked: true,
    starts: 1, stops: 1, edits: 0, checkpoints: 0, error: 'Recording unavailable. Try again.', retry: true });
});

test('preview buttons and extra quick sounds fit small screens and both accessible themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Hair', exact: true }).click();
  await page.getByRole('button', { name: 'Writing', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('#asmr-controls').analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Preview sound 1', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeFocused();
  }
});

test('@live preview ends automatically without changing the session, storage, transport or visual consent', async ({ page }) => {
  test.setTimeout(45000); await observeContexts(page); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  await page.locator('#asmr-listening-space').selectOption('soft');
  const before = await sharedSettings(page), storage = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByRole('button', { name: 'Preview sound 1', exact: true }).click();
  await expect(page.locator('#asmr-preview-status')).toContainText('Previewing one sound');
  await expect(page.getByRole('button', { name: 'Stop preview of sound 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#play')).toContainText('Start listening');
  await expect(page.locator('#trigger-enable')).not.toBeChecked();
  expect(await sharedSettings(page)).toEqual(before);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeEnabled({ timeout: 12000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { previewContexts: AudioContext[] }).previewContexts.map(context => context.state))).toEqual(['closed']);
});

test('@live normal playback closes previews first and paused sessions keep previews disabled', async ({ page }) => {
  test.setTimeout(45000); await observeContexts(page); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  await page.getByRole('button', { name: 'Preview sound 1', exact: true }).click();
  await expect(page.locator('#asmr-preview-status')).toContainText('Previewing one sound');
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('● Listening');
  expect(await page.evaluate(() => (window as unknown as { previewContexts: AudioContext[] }).previewContexts.map(context => context.state))).toEqual(['closed', 'running']);
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeDisabled();
  await page.locator('#pause').click(); await expect(page.locator('#status')).toHaveText('Ⅱ Paused');
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeDisabled();
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.getByRole('button', { name: 'Preview sound 1', exact: true })).toBeEnabled();
});

test('@live a held Start click survives a transport refresh and starts actual playback', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const button = document.querySelector('#play')!, children = [...button.childNodes];
    Object.assign(window, { transportPolls: 0, startChildren: children });
    new MutationObserver(() => { (window as unknown as { transportPolls: number }).transportPolls++; })
      .observe(document.querySelector('#status')!, { childList: true });
  });
  const label = page.locator('#play span').last(); await label.scrollIntoViewIfNeeded();
  const bounds = await label.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  try {
    await page.waitForFunction(() => (window as unknown as { transportPolls: number }).transportPolls > 0);
    expect(await page.evaluate(() => [...document.querySelector('#play')!.childNodes]
      .every((node, index) => node === (window as unknown as { startChildren: Node[] }).startChildren[index]))).toBe(true);
  } finally { await page.mouse.up(); }
  await expect(page.locator('#status')).toHaveText('● Listening');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Ready when you are');
});

test('@live manual and emergency stop, undo, presets and page lifecycle close the preview context', async ({ page }) => {
  test.setTimeout(60000); await observeContexts(page); await page.goto('/');
  await page.locator('[data-asmr-sound=brush]').click();
  for (const action of ['manual', 'keyboard', 'emergency', 'undo', 'preset', 'pagehide', 'hidden']) {
    await page.getByRole('button', { name: 'Preview sound 1', exact: true }).click();
    await expect(page.locator('#asmr-preview-status')).toContainText('Previewing one sound');
    if (action === 'manual') await page.getByRole('button', { name: 'Stop preview of sound 1', exact: true }).click();
    else if (action === 'keyboard') { await page.locator('h1').click(); await page.keyboard.press('s'); }
    else if (action === 'emergency') { await page.locator('h1').click(); await page.keyboard.press('Shift+Escape'); }
    else if (action === 'undo') { await page.locator('#undo-edit').click(); await expect(page.locator('.asmr-layer')).toHaveCount(0); }
    else if (action === 'preset') { await page.locator('#builtins [data-preset]').first().click(); await expect(page.locator('.asmr-layer')).toHaveCount(0); }
    else if (action === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    else await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => page.evaluate(() => (window as unknown as { previewContexts: AudioContext[] }).previewContexts.every(context => context.state === 'closed'))).toBe(true);
    if (action === 'preset' || action === 'undo') await page.locator('[data-asmr-sound=brush]').click();
  }
});
