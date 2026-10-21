import type { Session } from '../model';
import { noiseBuffer, smooth } from './graph';
import { offlineTone } from './offline-tone';
import { schedule } from './automation';
import { generatedBackgrounds, makeGeneratedBackground } from './generated-backgrounds';
import { AsmrMixer } from './asmr-mixer';
import { listeningMode, modeGains } from '../listening-mode';
import { phaseCycles, setSinePhase } from './render-timing';
import { asmrBackgroundGain } from '../asmr-focus';

function seededNoise(): () => number {
  let seed = 0x6b2f916d;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}

function ambience(context: OfflineAudioContext, session: Session, output: AudioNode, offset: number, endAt?: number): void {
  if (session.ambient === 'none' || session.ambientLevel === 0) return;
  const source = context.createBufferSource(), generated = generatedBackgrounds.find(item => item.id === session.ambient);
  if (generated) {
    const sample = makeGeneratedBackground(generated.id);
    const buffer = context.createBuffer(sample.channels.length, sample.channels[0].length, sample.rate);
    sample.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    source.buffer = buffer;
  } else source.buffer = noiseBuffer(context, session.ambient, seededNoise());
  source.loop = true;
  const filter = context.createBiquadFilter(); filter.type = 'lowpass';
  filter.frequency.value = session.ambient === 'ocean' ? 950 : 16000;
  const swell = context.createGain(); swell.gain.value = .65;
  const level = context.createGain(); level.gain.value = 0;
  smooth(level.gain, session.ambientLevel * .22 * asmrBackgroundGain(session), 0);
  source.connect(filter).connect(swell).connect(level).connect(output);
  if (session.ambient === 'ocean') {
    const modulation = context.createOscillator(); modulation.frequency.value = .07;
    if (offset > 0) setSinePhase(context, modulation, phaseCycles(modulation.frequency.value, offset));
    const depth = context.createGain(); depth.gain.value = .3;
    modulation.connect(depth).connect(swell.gain); modulation.start();
    if (endAt !== undefined) modulation.stop(endAt);
  }
  source.start(0, offset % source.buffer.duration);
  if (endAt !== undefined) source.stop(endAt);
}

export function exportGraph(context: OfflineAudioContext, session: Session, offset: number, end: number | undefined,
    native?: [Float32Array, Float32Array], music?: AudioBuffer): () => void {
  const localEnd = end === undefined ? undefined : end - offset;
  const master = context.createGain(); master.gain.value = session.master;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10; compressor.knee.value = 6; compressor.ratio.value = 12;
  compressor.attack.value = .003; compressor.release.value = .25;
  const gate = context.createGain();
  const duration = session.timelineDuration ?? session.minutes * 60;
  const fadeIn = duration > 0 ? Math.min(.5, duration / 4) : .5;
  schedule(gate.gain, [{ time: 0, value: 0, curve: 'step' }, { time: fadeIn, value: 1, curve: 'linear' },
    ...(end === undefined ? [] : [{ time: end - Math.min(2, duration / 2), value: 1, curve: 'step' as const },
      { time: end, value: 0, curve: 'linear' as const }])], -offset, 0);
  master.connect(compressor).connect(gate).connect(context.destination);
  const gains = modeGains(listeningMode(session)), tones = context.createGain();
  tones.gain.value = session.tonesMuted ? 0 : gains.tones; tones.connect(master);
  if (!session.bwg) for (const layer of session.layers) offlineTone(context, layer, tones, session.layers.length, localEnd, offset);
  if (native) {
    const source = context.createBufferSource(), buffer = context.createBuffer(2, native[0].length, context.sampleRate);
    native.forEach((channel, ear) => buffer.getChannelData(ear).set(channel));
    source.buffer = buffer;
    source.connect(master); source.start();
    if (localEnd !== undefined) source.stop(localEnd);
  }
  ambience(context, session, master, offset, localEnd);
  if (music && session.musicLevel > 0) {
    const source = context.createBufferSource(), level = context.createGain();
    source.buffer = music; source.loop = true; level.gain.value = 0;
    smooth(level.gain, session.musicLevel * .4 * asmrBackgroundGain(session), 0);
    source.connect(level).connect(master); source.start(0, offset % music.duration);
    if (localEnd !== undefined) source.stop(localEnd);
  }
  const asmr = new AsmrMixer(context, master, localEnd, offset); asmr.update(session.asmr, !!gains.asmr);
  return () => asmr.dispose();
}
