import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptiveVisualQuality } from '../src/adaptive-visual-quality.ts';

function observe(controller, duration, cost = 1, cadence = 1000 / 60, interval = 1000 / 30) {
  let changes = 0;
  for (let time = 0; time < duration; time += interval) changes += Number(controller.sample(cost, cadence, interval));
  return changes;
}

test('Auto starts conservatively and requires sustained headroom for each promotion', () => {
  const controller = new AdaptiveVisualQuality();
  assert.equal(controller.quality('auto'), 'eco');
  assert.equal(observe(controller, 10000), 0);
  assert.equal(controller.quality('auto'), 'eco');
  assert.equal(observe(controller, 5000), 1);
  assert.equal(controller.quality('auto'), 'balanced');
  observe(controller, 15000);
  assert.equal(controller.quality('auto'), 'balanced');
  observe(controller, 8000);
  assert.equal(controller.quality('auto'), 'high');
});

test('measured rendering overload degrades promptly and recovery needs sustained headroom', () => {
  const controller = new AdaptiveVisualQuality(); controller.quality('auto');
  observe(controller, 40000);
  assert.equal(controller.quality('auto'), 'high');
  assert.equal(observe(controller, 3500, 22), 1);
  assert.equal(controller.quality('auto'), 'balanced');
  observe(controller, 3500, 30);
  assert.equal(controller.quality('auto'), 'eco');
  observe(controller, 10000);
  assert.equal(controller.quality('auto'), 'eco');
  observe(controller, 5000);
  assert.equal(controller.quality('auto'), 'balanced');
});

test('slow RAF cadence prevents promotion despite low CPU cost and can lower quality', () => {
  const controller = new AdaptiveVisualQuality(); controller.quality('auto');
  assert.equal(observe(controller, 60000, .1, 1000 / 30), 0);
  assert.equal(controller.quality('auto'), 'eco');
  observe(controller, 40000);
  assert.equal(controller.quality('auto'), 'high');
  observe(controller, 3500, .1, 40);
  assert.equal(controller.quality('auto'), 'balanced');
});

test('boundary noise and brief spikes do not oscillate quality', () => {
  const controller = new AdaptiveVisualQuality(); controller.quality('auto');
  observe(controller, 15000);
  assert.equal(controller.quality('auto'), 'balanced');
  let changes = 0;
  for (let second = 0; second < 100; second++) changes += observe(controller, 1000, second % 2 ? 8 : 14);
  assert.equal(changes, 0);
  assert.equal(controller.quality('auto'), 'balanced');
  observe(controller, 500, 100, 200);
  observe(controller, 3000, 8);
  assert.equal(controller.quality('auto'), 'balanced');
});

test('manual options bypass learning and switching back to Auto starts at Eco', () => {
  const controller = new AdaptiveVisualQuality();
  for (const quality of ['eco', 'balanced', 'high']) {
    assert.equal(controller.quality(quality), quality);
    assert.equal(observe(controller, 60000), 0);
    assert.equal(observe(controller, 60000, 100, 100), 0);
    assert.equal(controller.quality(quality), quality);
  }
  assert.equal(controller.quality('auto'), 'eco');
});

test('pause clears partial evidence and invalid observations cannot change quality', () => {
  const controller = new AdaptiveVisualQuality(); controller.quality('auto');
  observe(controller, 10000); controller.pause(); observe(controller, 10000);
  assert.equal(controller.quality('auto'), 'eco');
  for (const args of [[NaN, 16, 33], [Infinity, 16, 33], [-1, 16, 33], [1, 0, 33], [1, Infinity, 33], [1, 16, NaN], [1, 16, -1]]) {
    assert.equal(controller.sample(...args), false);
  }
  observe(controller, 5000);
  assert.equal(controller.quality('auto'), 'balanced');
  controller.reset();
  assert.equal(controller.quality('auto'), 'eco');
});

test('long active frames remain overload evidence without counting an entire suspended gap', () => {
  const controller = new AdaptiveVisualQuality(); controller.quality('auto'); observe(controller, 40000);
  assert.equal(controller.sample(1000, 1000, 10000), false);
  assert.equal(controller.quality('auto'), 'high');
  observe(controller, 10000, 1000, 1000, 1000);
  assert.equal(controller.quality('auto'), 'balanced');
});
