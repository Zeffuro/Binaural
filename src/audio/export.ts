import { parseSession, type Session } from '../model';
import { noiseBuffer, smooth, ToneVoice } from './graph';
import { generatedBackgrounds, makeGeneratedBackground } from './generated-backgrounds';

export const WAV_SAMPLE_RATE = 44100;
export const MAX_EXPORT_SECONDS = 180;

function seededNoise(): () => number {
  let seed = 0x6b2f916d;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function ambience(context: OfflineAudioContext, session: Session, destination: AudioNode, endAt?: number): void {
  if (session.ambient === 'none') return;
  const source = context.createBufferSource();
  const generated = generatedBackgrounds.find(item => item.id === session.ambient);
  if (generated) {
    const sample = makeGeneratedBackground(generated.id);
    const buffer = context.createBuffer(sample.channels.length, sample.channels[0].length, sample.rate);
    sample.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    source.buffer = buffer;
  } else source.buffer = noiseBuffer(context, session.ambient, seededNoise());
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = session.ambient === 'ocean' ? 950 : 16000;
  const swell = context.createGain();
  swell.gain.value = 0.65;
  const level = context.createGain();
  level.gain.value = 0;
  smooth(level.gain, session.ambientLevel * 0.22, 0);
  source.connect(filter).connect(swell).connect(level).connect(destination);
  if (session.ambient === 'ocean') {
    const modulation = context.createOscillator();
    modulation.frequency.value = 0.07;
    const depth = context.createGain();
    depth.gain.value = 0.3;
    modulation.connect(depth).connect(swell.gain);
    modulation.start();
    if (endAt !== undefined) modulation.stop(endAt);
  }
  source.start();
  if (endAt !== undefined) source.stop(endAt);
}

function encodeWav(buffer: AudioBuffer): Blob {
  const output = new ArrayBuffer(44 + buffer.length * 4);
  const view = new DataView(output);
  const text = (offset: number, value: string): void => {
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  };
  text(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true); view.setUint32(28, WAV_SAMPLE_RATE * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, buffer.length * 4, true);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      const value = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(44 + frame * 4 + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

export async function renderWav(input: Session, seconds: number, signal?: AbortSignal): Promise<Blob> {
  if (!Number.isFinite(seconds) || seconds < 0.05 || seconds > MAX_EXPORT_SECONDS) {
    throw new Error(`Choose an export duration from 0.05 to ${MAX_EXPORT_SECONDS} seconds.`);
  }
  if (input?.bwg) throw new Error('WAV export currently supports ordinary tone and background sessions. BWGen export is not available yet.');
  const session = parseSession(input);
  signal?.throwIfAborted();
  if (typeof OfflineAudioContext === 'undefined') throw new Error('Offline audio rendering is unavailable in this browser.');
  // Limit both the Float32 render and PCM download allocations before creating either.
  const context = new OfflineAudioContext(2, Math.round(seconds * WAV_SAMPLE_RATE), WAV_SAMPLE_RATE);
  const duration = session.timelineDuration ?? session.minutes * 60;
  const endAt = duration > 0 ? duration : undefined;
  const master = context.createGain();
  master.gain.value = session.master;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  const gate = context.createGain();
  gate.gain.setValueAtTime(0, 0);
  gate.gain.linearRampToValueAtTime(1, duration > 0 ? Math.min(0.5, duration / 4) : 0.5);
  if (endAt !== undefined) {
    gate.gain.setValueAtTime(1, endAt - Math.min(2, duration / 2));
    gate.gain.linearRampToValueAtTime(0, endAt);
  }
  master.connect(compressor).connect(gate).connect(context.destination);
  const tones = context.createGain();
  tones.gain.value = session.tonesMuted ? 0 : 1;
  tones.connect(master);
  for (const layer of session.layers) new ToneVoice(context, layer, tones, session.layers.length, endAt, 0);
  ambience(context, session, master, endAt);
  const buffer = await context.startRendering();
  signal?.throwIfAborted();
  return encodeWav(buffer);
}
