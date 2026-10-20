import { expect, test } from '@playwright/test';
import { makeBwgFixture } from './helpers/bwg';

for (const fails of [false, true]) {
  test(`a cancelled native start cannot affect replacement playback when worklet loading ${fails ? 'fails' : 'finishes'}`, async ({ page }) => {
    await page.goto('/'); await page.locator('h1').click();
    const result = await page.evaluate(async ({ data, fails }) => {
      const enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts', importPath = '/src/import/bwg.ts', clockPath = '/tests/helpers/audio-clock.ts';
      const { AudioEngine } = await import(enginePath), { initialSession } = await import(modelPath);
      const { waitForAudioTime } = await import(clockPath);
      const { importBwg } = await import(importPath);
      let entered!: () => void, release!: () => void;
      const loading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      const original = Worklet.prototype.addModule;
      let delayed = false;
      Worklet.prototype.addModule = async function(...args) {
        if (!delayed) { delayed = true; entered(); await gate; if (fails) throw new Error('Late worklet failure'); }
        return original.apply(this, args);
      };
      const engine = new AudioEngine();
      try {
        const first = engine.start(importBwg(new Uint8Array(data)).session).catch(() => {});
        await Promise.race([loading, first.then(() => { throw new Error('Native start settled before loading'); })]);
        await engine.stop(); await engine.start(initialSession());
        release(); await first;
        await waitForAudioTime(engine.context, .75);
        const samples = engine.visualFrame()?.left;
        return { playing: engine.playing, state: engine.state, range: samples ? Math.max(...samples) - Math.min(...samples) : 0 };
      } finally { Worklet.prototype.addModule = original; await engine.stop(); }
    }, { data: makeBwgFixture(), fails });
    expect(result.playing).toBe(true); expect(result.state).toBe('running'); expect(result.range).toBeGreaterThan(5);
  });
}

test('level edits during native loading cannot create duplicate ordinary oscillators', async ({ page }) => {
  await page.goto('/'); await page.locator('h1').click();
  const result = await page.evaluate(async data => {
    const enginePath = '/src/audio/engine.ts', importPath = '/src/import/bwg.ts';
    const { AudioEngine } = await import(enginePath), { importBwg } = await import(importPath);
    let entered!: () => void, release!: () => void, oscillators = 0;
    const loading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const originalModule = Worklet.prototype.addModule, originalOscillator = AudioContext.prototype.createOscillator;
    Worklet.prototype.addModule = async function(...args) { entered(); await gate; return originalModule.apply(this, args); };
    AudioContext.prototype.createOscillator = function() { oscillators++; return originalOscillator.call(this); };
    const engine = new AudioEngine(), session = importBwg(new Uint8Array(data)).session;
    let starting: Promise<void> | undefined;
    try {
      starting = engine.start(session); await loading;
      session.master = .12; engine.update(session); session.tonesMuted = true; engine.update(session);
      session.tonesMuted = false; engine.update(session);
      const pendingOscillators = oscillators;
      release(); await starting; await new Promise(resolve => setTimeout(resolve, 300));
      const samples = engine.visualFrame()?.left;
      return { pendingOscillators, oscillators, playing: engine.playing, range: samples ? Math.max(...samples) - Math.min(...samples) : 0 };
    } finally {
      release(); await starting?.catch(() => {}); Worklet.prototype.addModule = originalModule;
      AudioContext.prototype.createOscillator = originalOscillator; await engine.stop();
    }
  }, makeBwgFixture());
  expect(result.pendingOscillators).toBe(0); expect(result.oscillators).toBe(0);
  expect(result.playing).toBe(true); expect(result.range).toBeGreaterThan(0);
});
