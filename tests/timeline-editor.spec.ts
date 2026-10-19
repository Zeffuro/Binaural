import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { makeBwgFixture } from './helpers/bwg';

async function harness(page: Page, mode = 'static', native?: number[]): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ mode, native }) => {
    const { setupTimelineEditor } = await import('/src/timeline-editor.ts');
    const { initialSession, makeLayer } = await import('/src/model.ts');
    let session = initialSession(); session.ambient = 'none'; session.minutes = 0; session.master = .5; session.layers[0].level = 1;
    if (mode === 'existing' || mode === 'large') {
      session.timelineDuration = 4;
      session.layers.push(makeLayer(300, 310, 'Untouched constant layer'));
      session.layers[0].automation = {
        left: [{ time: 0, value: 200, curve: 'step' }, { time: .125, value: 200.123456789, curve: 'linear' }, { time: .125, value: 240, curve: 'step' }, { time: 3.875, value: 400, curve: 'linear' }],
        right: [{ time: 0, value: 210, curve: 'linear' }, { time: .75, value: 251, curve: 'step' }],
        leftLevel: [{ time: 0, value: .975, curve: 'step' }, { time: 3, value: .125, curve: 'linear' }],
        rightLevel: [{ time: 0, value: .25, curve: 'linear' }],
      };
      if (mode === 'large') session.layers[0].automation.left = Array.from({ length: 129 }, (_, index) => ({ time: index / 40, value: 200 + index, curve: 'linear' }));
    }
    if (native) {
      const { importBwg } = await import('/src/import/bwg.ts'); session = importBwg(new Uint8Array(native)).session;
    }
    document.querySelector('#edit-timeline')?.remove(); document.querySelector('.timeline-editor')?.remove();
    const state = { current: session, original: structuredClone(session), applied: null, busy: false, fail: false, calls: 0, editor: null };
    (window as any).timelineHarness = state;
    state.editor = setupTimelineEditor({ session: () => state.current, isBusy: () => state.busy,
      apply: async next => { state.calls++; if (state.fail) throw Error('Test apply failure'); state.applied = next; state.current = next; } });
  }, { mode, native });
}

test('authored frequency ramp and independent ear levels reach real offline PCM', async ({ page }) => {
  await harness(page);
  await page.locator('#edit-timeline').click();
  await page.getByLabel('Duration in seconds', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add automation to this layer' }).click();
  await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('400');
  await page.getByLabel('New keyframe time (s)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add keyframe', exact: true }).click();
  await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('200');
  await page.getByLabel('New keyframe time (s)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add keyframe', exact: true }).click();
  await page.getByLabel('Point 3 frequency in Hz', { exact: true }).fill('400');
  await page.getByLabel('Automation lane', { exact: true }).selectOption('rightLevel');
  await page.getByLabel('Point 1 level', { exact: true }).fill('0');
  await page.getByLabel('Point 2 level', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tone timeline' })).not.toBeVisible();
  const result = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const session = (window as any).timelineHarness.applied;
    const view = new DataView(await (await renderWav(session, 4.1)).arrayBuffer());
    const hz = (start: number, end: number) => {
      const crossings = [];
      for (let index = Math.round(start * 44100) + 1; index < end * 44100; index++) {
        if (view.getInt16(44 + (index - 1) * 4, true) <= 0 && view.getInt16(44 + index * 4, true) > 0) crossings.push(index);
      }
      return (crossings.length - 1) * 44100 / (crossings.at(-1)! - crossings[0]);
    };
    let rightPeak = 0;
    for (let index = 0; index < 4 * 44100; index++) rightPeak = Math.max(rightPeak, Math.abs(view.getInt16(44 + index * 4 + 2, true)));
    return { frequencies: [hz(.65, .85), hz(1.4, 1.6), hz(2.5, 2.7)], rightPeak };
  });
  result.frequencies.forEach((hz, index) => expect(Math.abs(hz - [200, 300, 400][index])).toBeLessThan(3));
  expect(result.rightPeak).toBe(0);
});

test('editing a lane preserves arbitrary times, duplicate boundaries and all other layers', async ({ page }) => {
  await harness(page, 'existing'); await page.locator('#edit-timeline').click();
  await page.getByLabel('Automation lane', { exact: true }).selectOption('right');
  await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('275.125');
  await page.getByLabel('Point 2 curve', { exact: true }).selectOption('linear');
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  const result = await page.evaluate(() => {
    const { original, applied } = (window as any).timelineHarness;
    original.layers[0].automation.right[1] = { time: .75, value: 275.125, curve: 'linear' };
    applied.layers.forEach((voice: any, index: number) => { voice.id = original.layers[index].id; });
    return { applied, original };
  });
  expect(result.applied).toEqual(result.original);
});

test('authored linear and step ear levels produce distinct rendered envelopes', async ({ page }) => {
  await harness(page); await page.locator('#edit-timeline').click();
  await page.getByLabel('Duration in seconds', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add automation to this layer' }).click();
  await page.getByLabel('Automation lane', { exact: true }).selectOption('leftLevel');
  await page.getByLabel('Point 2 time in seconds', { exact: true }).fill('4');
  await page.getByLabel('Point 2 level', { exact: true }).fill('0');
  await page.getByLabel('Automation lane', { exact: true }).selectOption('rightLevel');
  await page.getByLabel('Point 1 level', { exact: true }).fill('0');
  await page.getByLabel('Point 2 time in seconds', { exact: true }).fill('2');
  await page.getByLabel('Point 2 curve', { exact: true }).selectOption('step');
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  const result = await page.evaluate(async () => {
    const { renderWav } = await import('/src/audio/export.ts');
    const view = new DataView(await (await renderWav((window as any).timelineHarness.applied, 3.5)).arrayBuffer());
    const rms = (time: number, ear: number) => {
      let sum = 0;
      for (let index = Math.round((time - .1) * 44100); index < Math.round((time + .1) * 44100); index++) sum += (view.getInt16(44 + index * 4 + ear * 2, true) / 32768) ** 2;
      return Math.sqrt(sum / 8820);
    };
    return { leftEarly: rms(.8, 0), leftLate: rms(3.2, 0), rightEarly: rms(.8, 1), rightLate: rms(3.2, 1) };
  });
  expect(result.leftLate / result.leftEarly).toBeCloseTo(.25, 1);
  expect(result.rightEarly).toBe(0); expect(result.rightLate).toBeGreaterThan(result.leftEarly);
});

test('inserted points preserve a linear ramp and removal stays scoped to the selected lane', async ({ page }) => {
  await harness(page); await page.locator('#edit-timeline').click();
  await page.getByLabel('Duration in seconds', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Add automation to this layer' }).click();
  await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('400');
  await page.getByLabel('New keyframe time (s)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add keyframe', exact: true }).click();
  await expect(page.getByLabel('Point 2 frequency in Hz', { exact: true })).toHaveValue('250');
  await expect(page.getByRole('button', { name: 'Remove point 1', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove point 2', exact: true }).click();
  await page.getByLabel('Automation lane', { exact: true }).selectOption('rightLevel');
  await expect(page.getByLabel('Point 2 level', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify((window as any).timelineHarness.current) === JSON.stringify((window as any).timelineHarness.original))).toBe(true);
});

test('duration shortening rejects later keyframes without discarding them and retries after an apply failure', async ({ page }) => {
  await harness(page, 'existing'); await page.locator('#edit-timeline').click();
  await page.getByLabel('Duration in seconds', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  await expect(page.locator('#timeline-editor-status')).toContainText('points are never removed automatically');
  await expect(page.getByLabel('Point 4 time in seconds', { exact: true })).toHaveValue('3.875');
  await page.getByLabel('Duration in seconds', { exact: true }).fill('4');
  await page.evaluate(() => { (window as any).timelineHarness.fail = true; });
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  await expect(page.locator('#timeline-editor-status')).toContainText('Test apply failure');
  await expect(page.getByRole('button', { name: 'Apply timeline', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).timelineHarness.fail = false; });
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tone timeline' })).not.toBeVisible();
});

test('busy playback and changed sessions prevent overwriting a draft', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { (window as any).timelineHarness.busy = true; });
  await page.locator('#edit-timeline').click();
  await expect(page.locator('#timeline-editor-status')).toContainText('Stop playback');
  await expect(page.getByRole('button', { name: 'Apply timeline', exact: true })).toBeDisabled();
  await page.evaluate(() => { const state = (window as any).timelineHarness; state.busy = false; state.editor.update(); });
  await expect(page.getByRole('button', { name: 'Add automation to this layer' })).toBeEnabled();
  await page.evaluate(() => { const state = (window as any).timelineHarness; state.current.name = 'Replacement'; state.editor.update(); });
  await expect(page.locator('#timeline-editor-status')).toContainText('session changed');
  await expect(page.getByRole('button', { name: 'Apply timeline', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).timelineHarness.calls)).toBe(0);
});

test('oversized ordinary timelines and native BWGen programs remain intact and read-only', async ({ page }) => {
  for (const mode of ['large', 'native']) {
    await harness(page, mode, mode === 'native' ? [...new Uint8Array(makeBwgFixture())] : undefined);
    await page.locator('#edit-timeline').click();
    await expect(page.locator('#timeline-editor-status')).toContainText(mode === 'large' ? 'more than 128 points' : 'Make an editable static copy');
    await expect(page.getByRole('button', { name: 'Apply timeline', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate(() => JSON.stringify((window as any).timelineHarness.current) === JSON.stringify((window as any).timelineHarness.original))).toBe(true);
  }
});

test('timeline dialog fits mobile in both themes with accessible controls and focus return', async ({ page }) => {
  await harness(page, 'existing');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator('#edit-timeline').click();
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations;
    expect(violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
    expect(await page.locator('.timeline-editor').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#edit-timeline')).toBeFocused();
  }
});

test('main timeline application supports undo and silent playback gating', async ({ page }) => {
  await page.goto('/'); await page.locator('#edit-timeline').click();
  await page.getByLabel('Duration in seconds', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Add automation to this layer' }).click();
  await page.getByLabel('Point 2 frequency in Hz', { exact: true }).fill('400');
  await page.getByRole('button', { name: 'Apply timeline', exact: true }).click();
  await expect(page.locator('#timeline-info')).toBeVisible();
  await expect(page.locator('#timeline-label')).toContainText('Tone timeline: 1 min');
  await expect(page.locator('#minutes')).toHaveValue('1');
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await page.locator('h1').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('#timeline-info')).not.toBeVisible();
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#timeline-info')).toBeVisible();
  await page.locator('#play').click(); await page.locator('#edit-timeline').click();
  await expect(page.locator('#timeline-editor-status')).toContainText('Stop playback');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.locator('#play').click();
});
