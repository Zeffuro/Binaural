import { expect, test } from '@playwright/test';

test('all seventeen original backgrounds are bounded, repeatable and independently owned', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/generated-backgrounds.ts';
    const first = await import(path);
    const fresh = await import(`${path}?deterministic-copy`);
    const stats = first.generatedBackgrounds.map((entry: { id: string; seconds: number; interval: boolean }) => {
      const sample = first.makeGeneratedBackground(entry.id);
      const data: Float32Array = sample.channels[0];
      const duplicate: Float32Array = fresh.makeGeneratedBackground(entry.id).channels[0];
      let peak = 0, sum = 0, square = 0, difference = 0, fingerprint = 2166136261;
      let finite = true, equal = data.length === duplicate.length;
      for (let i = 0; i < data.length; i++) {
        const value = data[i];
        finite &&= Number.isFinite(value);
        equal &&= value === duplicate[i];
        peak = Math.max(peak, Math.abs(value));
        sum += value; square += value * value;
        if (i) difference += (value - data[i - 1]) ** 2;
        if (i % 31 === 0) fingerprint = Math.imul(fingerprint ^ Math.round(value * 1e7), 16777619);
      }
      const original = data[100];
      data[100] = 42;
      sample.channels.push(new Float32Array(1));
      const next = first.makeGeneratedBackground(entry.id);
      const owned = next.channels[0][100] === original && next.channels[0] !== data;
      data[100] = original;
      let edgePeak = 0;
      const fadeFrames = Math.round(sample.rate * 0.005);
      for (let i = 0; i < fadeFrames; i++) {
        edgePeak = Math.max(edgePeak, Math.abs(data[i]), Math.abs(data[data.length - 1 - i]));
      }
      return { ...entry, rate: sample.rate, channels: next.channels.length, length: data.length,
        finite, equal, owned,
        peak, mean: sum / data.length, rms: Math.sqrt(square / data.length),
        deltaRms: Math.sqrt(difference / (data.length - 1)),
        boundary: Math.abs(data[0] - data[data.length - 1]), edgePeak,
        first: data[0], last: data[data.length - 1], fingerprint };
    });
    let rejectsUnknown = false;
    try { first.makeGeneratedBackground('unknown'); } catch { rejectsUnknown = true; }
    return { stats, rejectsUnknown };
  });
  expect(result.stats.map((entry: { id: string }) => entry.id)).toEqual([
    'night', 'brook', 'rain', 'seagulls', 'thunder', 'cow', 'wind', 'river', 'traffic',
    'pigeons', 'birds', 'tropical-birds', 'horse', 'wood', 'explosions', 'sheep', 'dog',
  ]);
  expect(result.rejectsUnknown).toBe(true);
  expect(new Set(result.stats.map((entry: { fingerprint: number }) => entry.fingerprint)).size).toBe(17);
  for (const entry of result.stats) {
    expect(entry.finite, entry.id).toBe(true);
    expect(entry.equal, entry.id).toBe(true);
    expect(entry.owned, entry.id).toBe(true);
    expect(entry.channels, entry.id).toBe(1);
    expect(entry.rate, entry.id).toBe(24000);
    expect(entry.length, entry.id).toBe(entry.rate * entry.seconds);
    expect(entry.peak, entry.id).toBeLessThanOrEqual(0.651);
    expect(Math.abs(entry.mean), entry.id).toBeLessThan(0.002);
    expect(entry.rms, entry.id).toBeGreaterThan(0.03);
    expect(entry.rms, entry.id).toBeLessThanOrEqual(0.111);
    if (entry.interval) {
      expect(Math.abs(entry.first), entry.id).toBe(0);
      expect(Math.abs(entry.last), entry.id).toBe(0);
      expect(entry.edgePeak, entry.id).toBeLessThan(0.005);
    } else {
      expect(entry.boundary, entry.id).toBeLessThan(0.3);
      expect(entry.boundary, entry.id).toBeLessThan(5 * entry.deltaRms + 0.001);
    }
  }
});

test('bird calls retain tonal structure while rain and wind have distinct noise spectra', async ({ page }) => {
  await page.goto('/');
  const metrics = await page.evaluate(async () => {
    const path = '/src/audio/generated-backgrounds.ts';
    const { makeGeneratedBackground } = await import(path);
    const features = (id: string) => {
      const data: Float32Array = makeGeneratedBackground(id).channels[0];
      let energy = 0, difference = 0;
      for (let i = 1; i < data.length; i++) {
        energy += data[i] ** 2;
        difference += (data[i] - data[i - 1]) ** 2;
      }
      let bestCorrelation = 0;
      const start = Math.round(0.32 * 24000), frames = 1024;
      for (let lag = 6; lag <= 24; lag++) {
        let cross = 0, left = 0, right = 0;
        for (let i = start; i < start + frames; i++) {
          cross += data[i] * data[i + lag];
          left += data[i] ** 2; right += data[i + lag] ** 2;
        }
        bestCorrelation = Math.max(bestCorrelation, cross / Math.sqrt(left * right));
      }
      return { roughness: difference / energy, periodicity: bestCorrelation };
    };
    return { birds: features('birds'), rain: features('rain'), wind: features('wind') };
  });
  expect(metrics.birds.periodicity).toBeGreaterThan(0.65);
  expect(metrics.birds.periodicity).toBeGreaterThan(metrics.rain.periodicity + 0.4);
  expect(metrics.rain.roughness).toBeGreaterThan(metrics.wind.roughness * 5);
});
