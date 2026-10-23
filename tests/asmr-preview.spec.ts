import { expect, test, type Page } from '@playwright/test';

async function controlled(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    const previewPath = '/src/audio/asmr-preview.ts', modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
    const { AsmrPreview } = await import(previewPath), { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
    const deferred = () => {
      let resolve!: () => void, reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    const h: any = { engines: [], events: [], states: [], blockStart: false, blockStop: false, deferred };
    h.session = initialSession(); h.session.mode = 'mixed'; h.session.master = 1.4; h.session.volumeBoost = true;
    h.session.asmr = { level: .72, focus: true,
      variation: { mode: 'turns', seed: 1, amount: 1, phraseSeconds: 30, turnSeconds: 600 },
      space: { amount: .25, size: 1.3, warmth: .8 }, layers: [
        { ...makeAsmrLayer('recorded-hair'), muted: true, solo: true, pan: -.4, rate: .7, tone: .3,
          pressure: .6, pressurePhase: 250, period: 17, spatial: { azimuth: 65, elevation: 20, distance: .7, motion: 'rise' } },
        { ...makeAsmrLayer('glass'), solo: true },
      ] };
    h.id = h.session.asmr.layers[0].id;
    h.preview = new AsmrPreview((state: any) => h.states.push(state), () => {
      const index = h.engines.length, start = deferred(), stop = deferred();
      const engine: any = { remaining: 5, startGate: start, stopGate: stop,
        async start(session: any) {
          engine.session = session; h.events.push(`start${index}`);
          if (h.blockStart) await start.promise;
        },
        async stop() {
          h.events.push(`stop${index}`);
          if (h.blockStop) await stop.promise;
          h.events.push(`closed${index}`);
        },
      };
      h.engines.push(engine); return engine;
    });
    (window as any).previewHarness = h;
  });
}

test('preview snapshots only one steady sound, current levels and space without mutating the session', async ({ page }) => {
  await controlled(page);
  const result = await page.evaluate(async () => {
    const h = (window as any).previewHarness;
    h.session.bwg = { ignored: true }; h.session.source = { format: 'bwg', name: 'Private import' };
    h.session.bwgBackgroundSource = 'embedded'; h.session.visual = { enabled: true };
    const before = JSON.stringify(h.session), layer = h.session.asmr.layers[0];
    await h.preview.start(h.session, h.id);
    const isolated = h.engines[0].session;
    const expected = { ...layer, muted: false, solo: false };
    const preserved = JSON.stringify(isolated.asmr.layers[0]) === JSON.stringify(expected);
    isolated.layers[0].name = 'Changed'; isolated.asmr.layers[0].spatial.azimuth = -10; isolated.asmr.space.amount = 0;
    const frozen = Object.isFrozen(h.preview.state) && h.states.every(Object.isFrozen);
    await h.preview.stop();
    return { preserved, frozen, unchanged: JSON.stringify(h.session) === before,
      keys: Object.keys(isolated).sort(), asmrKeys: Object.keys(isolated.asmr).sort(),
      levels: [isolated.master, isolated.volumeBoost, isolated.asmr.level, isolated.timelineDuration, isolated.minutes],
      muted: isolated.tonesMuted, mode: isolated.mode, ambient: isolated.ambient,
      background: [isolated.ambientLevel, isolated.musicLevel], phases: h.states.map((state: any) => state.phase), active: h.preview.active };
  });
  expect(result.preserved).toBe(true); expect(result.frozen).toBe(true); expect(result.unchanged).toBe(true);
  expect(result.keys).toEqual(['ambient', 'ambientLevel', 'asmr', 'layers', 'master', 'minutes', 'mode', 'musicLevel', 'name', 'timelineDuration', 'tonesMuted', 'version', 'volumeBoost']);
  expect(result.asmrKeys).toEqual(['layers', 'level', 'space']); expect(result.levels).toEqual([1.4, true, .72, 5, 0]);
  expect(result.muted).toBe(true); expect(result.mode).toBe('asmr'); expect(result.ambient).toBe('none'); expect(result.background).toEqual([0, 0]);
  expect(result.phases).toEqual(['loading', 'playing', 'stopping', 'idle']); expect(result.active).toBe(false);
});

test('cancelled blocked starts cannot adopt late and rapid replacements wait for owned closure', async ({ page }) => {
  await controlled(page);
  const result = await page.evaluate(async () => {
    const h = (window as any).previewHarness;
    h.blockStart = true; h.blockStop = true;
    const first = h.preview.start(h.session, h.id);
    await Promise.resolve(); await Promise.resolve();
    let stopped = false; const stop = h.preview.stop().then(() => { stopped = true; });
    const second = h.preview.start(h.session, h.id), third = h.preview.start(h.session, h.session.asmr.layers[1].id);
    await Promise.resolve(); await Promise.resolve();
    const beforeClose = [...h.events], countBeforeClose = h.engines.length;
    h.engines[0].stopGate.resolve(); await stop; await second;
    await Promise.resolve(); await Promise.resolve();
    const afterClose = [...h.events];
    h.engines[0].startGate.reject(new Error('Cancelled network load failed late')); await first;
    const neverPlayedOld = !h.states.some((state: any) => state.phase === 'playing');
    h.engines[1].startGate.resolve(); await third;
    const activeId = h.preview.state.id;
    const finalStop = h.preview.stop(); await Promise.resolve(); await Promise.resolve();
    h.engines[1].stopGate.resolve(); await finalStop; await h.preview.stop();
    return { beforeClose, countBeforeClose, afterClose, stopped, neverPlayedOld, activeId,
      expectedId: h.session.asmr.layers[1].id, events: h.events, state: h.preview.state };
  });
  expect(result.beforeClose).toEqual(['start0', 'stop0']); expect(result.countBeforeClose).toBe(1);
  expect(result.afterClose).toEqual(['start0', 'stop0', 'closed0', 'start1']); expect(result.stopped).toBe(true); expect(result.neverPlayedOld).toBe(true);
  expect(result.activeId).toBe(result.expectedId); expect(result.events).toEqual(['start0', 'stop0', 'closed0', 'start1', 'stop1', 'closed1']);
  expect(result.state).toEqual({ phase: 'idle' });
});

test('startup errors clean up and retry while audio end and processor failure reset their timers', async ({ page }) => {
  await controlled(page); await page.clock.install();
  const result = await page.evaluate(async () => {
    const h = (window as any).previewHarness; h.blockStart = true;
    const failed = h.preview.start(h.session, h.id).then(() => '', (error: Error) => error.message);
    await Promise.resolve(); await Promise.resolve(); h.engines[0].startGate.reject(new Error('Recording unavailable'));
    const rejection = await failed, failure = h.preview.state;
    h.blockStart = false; await h.preview.start(h.session, h.id);
    const retried = h.preview.state; h.engines[1].remaining = 0;
    return { rejection, failure, retried };
  });
  expect(result.rejection).toBe('Recording unavailable'); expect(result.failure).toEqual({ phase: 'idle', error: 'Recording unavailable' });
  expect(result.retried.phase).toBe('playing');
  await page.clock.fastForward(100);
  expect(await page.evaluate(() => (window as any).previewHarness.preview.state)).toEqual({ phase: 'idle' });
  await page.evaluate(async () => {
    const h = (window as any).previewHarness; await h.preview.start(h.session, h.id); h.engines[2].failure = 'Processor failed';
  });
  await page.clock.fastForward(100);
  expect(await page.evaluate(() => (window as any).previewHarness.preview.state)).toEqual({ phase: 'idle', error: 'Processor failed' });
  await page.clock.fastForward(16_000);
  const ended = await page.evaluate(() => {
    const h = (window as any).previewHarness; return { state: h.preview.state, events: h.events, poll: h.preview.poll, watchdog: h.preview.watchdog };
  });
  expect(ended.state.error).toBe('Processor failed'); expect(ended.events.filter((event: string) => event.startsWith('closed'))).toHaveLength(3);
  expect(ended.poll).toBeUndefined(); expect(ended.watchdog).toBeUndefined();
});

test('wall watchdog closes a frozen or loading preview without awaiting the blocked start', async ({ page }) => {
  await controlled(page); await page.clock.install();
  await page.evaluate(async () => {
    const h = (window as any).previewHarness; h.blockStart = true;
    h.pending = h.preview.start(h.session, h.id); await Promise.resolve(); await Promise.resolve();
  });
  await page.clock.fastForward(15_001);
  const result = await page.evaluate(async () => {
    const h = (window as any).previewHarness, timedOut = h.preview.state;
    h.engines[0].startGate.resolve(); await h.pending;
    h.blockStart = false; await h.preview.start(h.session, h.id); await h.preview.stop();
    return { timedOut, events: h.events, state: h.preview.state, poll: h.preview.poll, watchdog: h.preview.watchdog };
  });
  expect(result.timedOut).toEqual({ phase: 'idle', error: 'The ASMR preview timed out and was stopped.' });
  expect(result.events).toEqual(['start0', 'stop0', 'closed0', 'start1', 'stop1', 'closed1']); expect(result.state).toEqual({ phase: 'idle' });
  expect(result.poll).toBeUndefined(); expect(result.watchdog).toBeUndefined();
});

test('an unconfirmed engine closure blocks replacement instead of creating overlapping audio', async ({ page }) => {
  await controlled(page);
  const result = await page.evaluate(async () => {
    const h = (window as any).previewHarness;
    await h.preview.start(h.session, h.id); h.blockStop = true;
    const stop = h.preview.stop().then(() => '', (error: Error) => error.message);
    await Promise.resolve(); await Promise.resolve(); h.engines[0].stopGate.reject(new Error('Context close failed'));
    const stopped = await stop;
    const replacement = await h.preview.start(h.session, h.id).then(() => '', (error: Error) => error.message);
    return { stopped, replacement, engines: h.engines.length, state: h.preview.state, poll: h.preview.poll, watchdog: h.preview.watchdog };
  });
  expect(result.stopped).toBe('Context close failed'); expect(result.replacement).toBe('Context close failed'); expect(result.engines).toBe(1);
  expect(result.state).toEqual({ phase: 'idle', error: 'Context close failed' }); expect(result.poll).toBeUndefined(); expect(result.watchdog).toBeUndefined();
});

function stereoRecording(): Buffer {
  const rate = 24000, frames = rate * 2, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(3600 * Math.sin(frame * 2 * Math.PI * 200 / rate)), 44 + frame * 4);
    bytes.writeInt16LE(Math.round(1200 * Math.sin(frame * 2 * Math.PI * 700 / rate)), 46 + frame * 4);
  }
  return bytes;
}

test('@live pending recording cancellation closes its actual context before fetch settles and a failed recording retries', async ({ page }) => {
  test.setTimeout(40_000);
  let release!: () => void, requested!: () => void, writingRequests = 0;
  const released = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/audio/asmr/hair-brushing.mp3', async route => {
    requested(); await released;
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() });
  });
  await page.route('**/audio/asmr/pencil-writing.mp3', route => {
    writingRequests++;
    return route.fulfill(writingRequests === 1 ? { status: 503, body: 'Unavailable' }
      : { status: 200, contentType: 'audio/wav', body: stereoRecording() });
  });
  await page.goto('/'); await page.locator('h1').click();
  try {
    await page.evaluate(async () => {
      const previewPath = '/src/audio/asmr-preview.ts', enginePath = '/src/audio/engine.ts';
      const modelPath = '/src/model.ts', statePath = '/src/asmr-state.ts';
      const { AsmrPreview } = await import(previewPath), { AudioEngine } = await import(enginePath);
      const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath);
      const h: any = { engines: [], contexts: [], resumes: [], phases: [], session: initialSession() };
      h.session.asmr = { level: .8, layers: [{ ...makeAsmrLayer('recorded-hair'), motion: 'still' }] };
      h.id = h.session.asmr.layers[0].id; h.before = JSON.stringify(h.session);
      h.preview = new AsmrPreview((state: any) => h.phases.push(state.phase), () => {
        const engine: any = new AudioEngine(), index = h.engines.length, start = engine.start.bind(engine);
        engine.start = (session: any) => {
          const pending = start(session), context: AudioContext = engine.context, resume = context.resume.bind(context);
          h.contexts.push(context); h.resumes.push(0);
          context.resume = () => { h.resumes[index]++; return resume(); };
          return pending;
        };
        h.engines.push(engine); return engine;
      });
      h.pending = h.preview.start(h.session, h.id);
      (window as any).recordingPreviewHarness = h;
    });
    await reached;
    const cancelled = await page.evaluate(async () => {
      const h = (window as any).recordingPreviewHarness, engine = h.engines[0], context = h.contexts[0];
      const analyser = context.createAnalyser(), samples = new Float32Array(2048);
      engine.transport.connect(analyser); analyser.getFloatTimeDomainData(samples);
      const frozenAt = context.currentTime; await new Promise(resolve => setTimeout(resolve, 40));
      const initial = { phase: h.preview.state.phase, context: context.state, frozen: context.currentTime === frozenAt,
        silent: samples.every(value => value === 0), voices: engine.asmr.voices.size };
      await h.preview.stop(); analyser.disconnect();
      return { initial, closed: context.state === 'closed', state: h.preview.state, resumes: h.resumes[0] };
    });
    expect(cancelled.initial.phase).toBe('loading'); expect(cancelled.initial.context).toBe('suspended'); expect(cancelled.initial.frozen).toBe(true);
    expect(cancelled.initial.silent).toBe(true); expect(cancelled.initial.voices).toBe(0); expect(cancelled.closed).toBe(true);
    expect(cancelled.state).toEqual({ phase: 'idle' }); expect(cancelled.resumes).toBe(0);
    release();
    const failed = await page.evaluate(async () => {
      const h = (window as any).recordingPreviewHarness;
      await h.pending;
      const late = { state: h.preview.state, phases: [...h.phases], resumes: h.resumes[0], unchanged: h.before === JSON.stringify(h.session) };
      h.session.asmr.layers[0].sound = 'recorded-writing'; h.before = JSON.stringify(h.session);
      const error = await h.preview.start(h.session, h.id).then(() => '', (failure: Error) => failure.message);
      return { late, error, state: h.preview.state, closed: h.contexts[1].state === 'closed', resumes: h.resumes[1] };
    });
    expect(failed.late.state).toEqual({ phase: 'idle' }); expect(failed.late.phases).toEqual(['loading', 'stopping', 'idle']);
    expect(failed.late.resumes).toBe(0); expect(failed.late.unchanged).toBe(true); expect(failed.closed).toBe(true); expect(failed.resumes).toBe(0);
    expect(failed.error).toContain('Could not load Pencil writing'); expect(failed.state).toEqual({ phase: 'idle', error: failed.error });
    const retried = await page.evaluate(async () => {
      const h = (window as any).recordingPreviewHarness, clockPath = '/tests/helpers/audio-clock.ts';
      const { waitForAudioTime } = await import(clockPath);
      await h.preview.start(h.session, h.id);
      const engine = h.engines[2], context = h.contexts[2], analyser = context.createAnalyser(), samples = new Float32Array(2048);
      engine.transport.connect(analyser);
      await waitForAudioTime(context, context.currentTime + .7); analyser.getFloatTimeDomainData(samples);
      const result = { phase: h.preview.state.phase, finite: samples.every(Number.isFinite), peak: Math.max(...samples.map(Math.abs)),
        resumes: h.resumes[2], unchanged: h.before === JSON.stringify(h.session) };
      await h.preview.stop(); analyser.disconnect();
      return { ...result, closed: h.contexts.every((value: AudioContext) => value.state === 'closed'), state: h.preview.state };
    });
    expect(writingRequests).toBe(2); expect(retried.phase).toBe('playing'); expect(retried.finite).toBe(true); expect(retried.peak).toBeGreaterThan(.001);
    expect(retried.peak).toBeLessThan(1); expect(retried.resumes).toBe(1); expect(retried.unchanged).toBe(true);
    expect(retried.closed).toBe(true); expect(retried.state).toEqual({ phase: 'idle' });
  } finally { release(); await page.evaluate(async () => { await (window as any).recordingPreviewHarness?.preview.stop(); }); }
});

for (const kind of ['generated', 'stereo', 'hrtf'] as const) {
  test(`@live ${kind} preview uses actual protected room output, expected ears and a five-second audio gate`, async ({ page }) => {
    test.setTimeout(40_000);
    await page.route('**/audio/asmr/hair-brushing.mp3', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: stereoRecording() }));
    await page.goto('/'); await page.locator('h1').click();
    const result = await page.evaluate(async (kind) => {
      const previewPath = '/src/audio/asmr-preview.ts', enginePath = '/src/audio/engine.ts', modelPath = '/src/model.ts';
      const statePath = '/src/asmr-state.ts', clockPath = '/tests/helpers/audio-clock.ts';
      const { AsmrPreview } = await import(previewPath), { AudioEngine } = await import(enginePath);
      const { initialSession } = await import(modelPath), { makeAsmrLayer } = await import(statePath), { waitForAudioTime } = await import(clockPath);
      const source = initialSession(); source.master = 1.8; source.volumeBoost = true;
      const layer = { ...makeAsmrLayer(kind === 'generated' ? 'air' : 'recorded-hair'),
        muted: true, solo: true, level: 1, rate: .85, tone: .4, motion: 'still', pan: kind === 'generated' ? -1 : 0 };
      if (kind === 'hrtf') layer.spatial = { azimuth: 75, elevation: 25, distance: .6, motion: 'still' };
      source.asmr = { level: 1, focus: true, layers: [layer], space: { amount: .35, size: 1.5, warmth: .9 },
        variation: { mode: 'turns', seed: 991, amount: 1, phraseSeconds: 30, turnSeconds: 600 } };
      const before = JSON.stringify(source), phases: string[] = [], engine: any = new AudioEngine();
      let tail = Infinity, stoppedAt = 0, ownedStops = 0;
      const compressors: DynamicsCompressorNode[] = [], nativeCompressor = AudioContext.prototype.createDynamicsCompressor;
      AudioContext.prototype.createDynamicsCompressor = function () {
        const compressor = nativeCompressor.call(this); compressors.push(compressor); return compressor;
      };
      const nativeStop = engine.stop.bind(engine);
      let taps: AnalyserNode[], samples: Float32Array<ArrayBuffer>, context: AudioContext, end: number;
      const read = () => taps.map(tap => {
        tap.getFloatTimeDomainData(samples); let energy = 0, peak = 0;
        for (const value of samples) { energy += value ** 2; peak = Math.max(peak, Math.abs(value)); }
        return { energy: energy / samples.length, peak, finite: samples.every(Number.isFinite) };
      });
      engine.stop = async () => {
        ownedStops++;
        if (context && context.state !== 'closed') {
          await waitForAudioTime(context, end + .18); tail = Math.max(...read().map(value => value.peak)); stoppedAt = context.currentTime;
        }
        await nativeStop();
      };
      const preview = new AsmrPreview((state: any) => phases.push(state.phase), () => engine);
      try {
        await preview.start(source, layer.id);
        context = engine.context; end = engine.sequenceEnd;
        const origin = engine.origin, mixer = engine.asmr, room = mixer.space.bank;
        const splitter = context.createChannelSplitter(2); engine.transport.connect(splitter);
        taps = [context.createAnalyser(), context.createAnalyser()]; samples = new Float32Array(2048);
        taps.forEach((tap, ear) => { tap.fftSize = 2048; splitter.connect(tap, ear); });
        await waitForAudioTime(context, origin + 1); const audible = read();
        await waitForAudioTime(context, origin + 3.2); const earlyFade = read();
        await waitForAudioTime(context, origin + 4.7); const lateFade = read();
        const deadline = performance.now() + 12_000;
        while (preview.active && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        taps.forEach(tap => tap.disconnect()); splitter.disconnect();
        const compressor = compressors[0];
        return { audible, earlyFade, lateFade, tail, stoppedAt, duration: end - origin, phases: [...phases], state: preview.state, ownedStops,
          untouched: before === JSON.stringify(source), closed: context.state === 'closed', disposed: mixer.voices.size === 0 && mixer.space.bank === undefined,
          roomUsed: !!room, compressed: compressors.length === 1,
          protection: [compressor.threshold.value, compressor.knee.value, compressor.ratio.value, compressor.attack.value, compressor.release.value] };
      } finally { AudioContext.prototype.createDynamicsCompressor = nativeCompressor; await preview.stop(); }
    }, kind);
    expect(result.duration).toBe(5); expect(result.untouched).toBe(true); expect(result.roomUsed).toBe(true); expect(result.compressed).toBe(true);
    expect(result.protection[0]).toBe(-10); expect(result.protection[1]).toBe(6); expect(result.protection[2]).toBe(12);
    expect(result.protection[3]).toBeCloseTo(.003, 6); expect(result.protection[4]).toBe(.25);
    for (const reading of [...result.audible, ...result.earlyFade, ...result.lateFade]) { expect(reading.finite).toBe(true); expect(reading.peak).toBeLessThan(1); }
    const [left, right] = result.audible;
    if (kind === 'generated') { expect(left!.energy).toBeGreaterThan(1e-6); expect(right!.energy).toBeLessThan(1e-12); }
    if (kind === 'stereo') { expect(left!.energy).toBeGreaterThan(right!.energy * 2); expect(right!.energy).toBeGreaterThan(1e-7); }
    if (kind === 'hrtf') { expect(right!.energy).toBeGreaterThan(left!.energy * 1.1); expect(left!.energy).toBeGreaterThan(1e-7); }
    expect(result.lateFade.reduce((sum, ear) => sum + ear.energy, 0)).toBeLessThan(result.earlyFade.reduce((sum, ear) => sum + ear.energy, 0) * .25);
    expect(result.tail).toBeLessThan(1e-8); expect(result.stoppedAt).toBeGreaterThanOrEqual(5.18);
    expect(result.phases).toEqual(['loading', 'playing', 'stopping', 'idle']); expect(result.state).toEqual({ phase: 'idle' });
    expect(result.ownedStops).toBe(1); expect(result.closed).toBe(true); expect(result.disposed).toBe(true);
  });
}
