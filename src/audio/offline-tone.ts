import type { AutomationPoint, Layer } from '../model';
import { schedule } from './automation';
import { smooth } from './graph';

function sineSamples(samples: Float32Array, rate: number, offset: number, frequency: number, points?: AutomationPoint[]): void {
  let index = 0, cycles = 0;
  let hz = Math.fround(points?.[0].value ?? frequency), start = 0;
  const slopeAt = () => points && points[index + 1]?.curve === 'linear' && points[index + 1].time > start
    ? (Math.fround(points[index + 1].value) - hz) / (points[index + 1].time - start) : 0;
  let slope = slopeAt();
  // Absolute phase avoids browser oscillator drift between independently rendered sections.
  for (let frame = 0; frame < samples.length; frame++) {
    const time = offset + frame / rate;
    while (points && index + 1 < points.length && points[index + 1].time <= time) {
      const duration = points[index + 1].time - start;
      cycles = (cycles + duration * (hz + slope * duration / 2)) % 1;
      start = points[++index].time; hz = Math.fround(points[index].value); slope = slopeAt();
    }
    const duration = time - start;
    samples[frame] = Math.sin(2 * Math.PI * ((cycles + duration * (hz + slope * duration / 2)) % 1));
  }
}

export function offlineTone(context: OfflineAudioContext, layer: Layer, destination: AudioNode,
    count: number, endAt?: number, offset = 0): void {
  const output = context.createGain(), merger = context.createChannelMerger(2);
  output.gain.value = 0;
  smooth(output.gain, .22 * layer.level / Math.max(1, count), 0);
  merger.connect(output).connect(destination);
  const weights = { binaural: [1, 0, 0, 1], mixed: [.5, .5, .5, .5],
    left: [1, 0, 0, 0], right: [0, 0, 0, 1] }[layer.route];
  for (let ear = 0; ear < 2; ear++) {
    const points = ear ? layer.automation?.right : layer.automation?.left;
    const frequency = ear ? layer.right : layer.left;
    const buffer = context.createBuffer(1, context.length, context.sampleRate), samples = buffer.getChannelData(0);
    sineSamples(samples, context.sampleRate, offset, frequency, points);
    const source = context.createBufferSource(), envelope = context.createGain();
    source.buffer = buffer;
    if (layer.automation) schedule(envelope.gain,
      ear ? layer.automation.rightLevel : layer.automation.leftLevel, -offset, 0);
    source.connect(envelope);
    for (let channel = 0; channel < 2; channel++) {
      const route = context.createGain(); route.gain.value = 0;
      smooth(route.gain, weights[ear * 2 + channel], 0);
      envelope.connect(route).connect(merger, 0, channel);
    }
    source.start();
    if (endAt !== undefined) source.stop(endAt);
  }
}
