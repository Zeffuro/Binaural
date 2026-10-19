import { type Session } from '../model';
import { hold, noiseBuffer, smooth, ToneVoice } from './graph';
import { bwgContinues, decodeBwg } from '../import/bwg-program';
import workletUrl from './bwg-worklet.ts?worker&url';
import { backgroundAssets } from '../background-assets';
import { generatedBackgrounds, makeGeneratedBackground } from './generated-backgrounds';
import { VisualAnalysis, type VisualFrame } from './visual-analysis';

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private gate?: GainNode;
  private transport?: GainNode;
  private musicGain?: GainNode;
  private toneBus?: GainNode;
  private voices = new Map<string, ToneVoice>();
  private noise?: AudioBufferSourceNode;
  private noiseGain?: GainNode;
  private modulation?: OscillatorNode;
  private ambient?: Session['ambient'];
  private endAt?: number;
  private music?: HTMLAudioElement;
  private musicUrl?: string;
  private stopping = false;
  private isPaused = false;
  private origin = 0;
  private bwgNode?: AudioWorkletNode;
  private continues = false;
  private analysis?: VisualAnalysis;
  private sequenceEnd?: number;
  failure?: string;

  get holding(): boolean { return this.continues && (this.sequenceEnd ?? Infinity) <= (this.context?.currentTime ?? 0); }

  get playing(): boolean { return !!this.context && !this.stopping; }
  get state(): string { return this.context?.state ?? 'stopped'; }
  get paused(): boolean { return this.isPaused; }
  visualFrame(): VisualFrame | undefined { return this.analysis?.read(); }
  get remaining(): number | undefined {
    return this.sequenceEnd === undefined ? undefined : Math.max(0, this.sequenceEnd - (this.context?.currentTime ?? 0));
  }

  async start(session: Session): Promise<void> {
    if (this.context) return;
    const context = new AudioContext({ latencyHint: 'playback' });
    this.context = context;
    const current = () => this.context === context && !this.stopping;
    this.failure = undefined;
    try {
      await context.suspend();
      if (!current()) return;
      this.origin = context.currentTime;
      this.master = context.createGain();
      this.gate = context.createGain();
      this.transport = context.createGain();
      this.master.gain.value = session.master;
      const bwg = session.bwg ? decodeBwg(session.bwg).preset : undefined;
      this.continues = !!bwg && bwgContinues(bwg);
      const duration = session.timelineDuration ?? session.minutes * 60;
      if (duration > 0) this.sequenceEnd = context.currentTime + duration;
      this.gate.gain.setValueAtTime(0, context.currentTime);
      this.gate.gain.linearRampToValueAtTime(1, context.currentTime + (duration > 0 ? Math.min(0.5, duration / 4) : 0.5));
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      this.analysis = new VisualAnalysis(context);
      this.master.connect(compressor).connect(this.gate).connect(this.transport).connect(this.analysis.node).connect(context.destination);
      if (duration > 0 && !this.continues) {
        this.endAt = context.currentTime + duration;
        this.gate.gain.setValueAtTime(1, this.endAt - Math.min(2, duration / 2));
        this.gate.gain.linearRampToValueAtTime(0, this.endAt);
      }
      this.musicGain = context.createGain();
      this.musicGain.connect(this.master);
      this.toneBus = context.createGain();
      this.toneBus.gain.value = session.tonesMuted ? 0 : 1;
      this.toneBus.connect(this.master);
      if (bwg) {
        await context.audioWorklet.addModule(workletUrl);
        if (!current()) return;
        const background = await backgroundAssets.resolve(bwg, session.bwgBackgroundSource);
        if (!current()) return;
        this.bwgNode = new AudioWorkletNode(context, 'bwg-sequence', { numberOfInputs: 0,
          numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { preset: bwg, background } });
        this.bwgNode.addEventListener('processorerror', () => { this.failure = 'The BWGen audio processor stopped unexpectedly. Playback has been stopped.'; });
        this.bwgNode.connect(this.master);
      }
      this.update(session);
      await context.resume();
      if (!current()) return;
      if (this.musicUrl) await this.attachMusic(this.musicUrl);
    } catch (error) {
      if (!current()) return;
      await this.stop();
      throw error;
    }
  }

  update(session: Session): void {
    const context = this.context;
    if (!context || !this.master || !this.musicGain) return;
    smooth(this.master.gain, session.master, context.currentTime);
    if (this.toneBus) smooth(this.toneBus.gain, session.tonesMuted ? 0 : 1, context.currentTime);
    // The session gate is downstream, so edits cannot erase its scheduled fade-out.
    smooth(this.musicGain.gain, session.musicLevel * 0.4, context.currentTime);
    for (const [id, voice] of this.voices) {
      if (!session.layers.some(layer => layer.id === id)) {
        voice.dispose();
        this.voices.delete(id);
      }
    }
    if (this.bwgNode) this.bwgNode.port.postMessage({ levels: session.layers.map(layer => session.tonesMuted ? 0 : layer.level) });
    for (const layer of session.bwg ? [] : session.layers) {
      const existing = this.voices.get(layer.id);
      if (existing) existing.update(layer, session.layers.length);
      else this.voices.set(layer.id, new ToneVoice(context, layer, this.toneBus!, session.layers.length, this.endAt, this.origin));
    }
    if (this.ambient !== session.ambient) this.changeAmbient(session);
    if (this.noiseGain) smooth(this.noiseGain.gain, session.ambientLevel * 0.22, context.currentTime);
  }

  private changeAmbient(session: Session): void {
    const context = this.context!;
    if (this.noiseGain) {
      const oldGain = this.noiseGain;
      const oldNoise = this.noise;
      const oldModulation = this.modulation;
      smooth(oldGain.gain, 0, context.currentTime);
      oldNoise?.stop(context.currentTime + 0.25);
      oldModulation?.stop(context.currentTime + 0.25);
      setTimeout(() => { oldGain.disconnect(); oldNoise?.disconnect(); oldModulation?.disconnect(); }, 300);
    }
    this.noise = undefined;
    this.noiseGain = undefined;
    this.modulation = undefined;
    this.ambient = session.ambient;
    if (session.ambient === 'none') return;
    this.noise = context.createBufferSource();
    const generated = generatedBackgrounds.find(item => item.id === session.ambient);
    if (generated) {
      const sample = makeGeneratedBackground(generated.id);
      const buffer = context.createBuffer(sample.channels.length, sample.channels[0].length, sample.rate);
      sample.channels.forEach((channel, index) => { buffer.getChannelData(index).set(channel); });
      this.noise.buffer = buffer;
    } else this.noise.buffer = noiseBuffer(context, session.ambient);
    this.noise.loop = true;
    this.noiseGain = context.createGain();
    this.noiseGain.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = session.ambient === 'ocean' ? 950 : 16000;
    const swell = context.createGain();
    swell.gain.value = 0.65;
    this.noise.connect(filter).connect(swell).connect(this.noiseGain).connect(this.master!);
    if (session.ambient === 'ocean') {
      this.modulation = context.createOscillator();
      this.modulation.frequency.value = 0.07;
      const depth = context.createGain();
      depth.gain.value = 0.3;
      this.modulation.connect(depth).connect(swell.gain);
      this.modulation.start();
      if (this.endAt !== undefined) this.modulation.stop(this.endAt);
    }
    this.noise.start();
    if (this.endAt !== undefined) this.noise.stop(this.endAt);
  }

  async setMusic(file?: File): Promise<void> {
    this.detachMusic();
    if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
    this.musicUrl = undefined;
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); probe.onloadeddata = null; probe.onerror = null; };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Audio file took too long to load.')); }, 10000);
        probe.onloadeddata = () => { cleanup(); resolve(); };
        probe.onerror = () => { cleanup(); reject(new Error('Audio format is unsupported or the file is damaged.')); };
        probe.preload = 'auto';
        probe.src = url;
      });
      this.musicUrl = url;
      if (this.playing) await this.attachMusic(url);
    } catch (error) {
      this.detachMusic();
      URL.revokeObjectURL(url);
      this.musicUrl = undefined;
      throw error;
    } finally {
      probe.removeAttribute('src');
      probe.load();
    }
  }

  private async attachMusic(url: string): Promise<void> {
    this.detachMusic();
    const music = new Audio(url);
    music.loop = true;
    this.music = music;
    this.context!.createMediaElementSource(music).connect(this.musicGain!);
    if (!this.isPaused) await music.play();
  }

  private detachMusic(): void {
    this.music?.pause();
    if (this.music) { this.music.removeAttribute('src'); this.music.load(); }
    this.music = undefined;
  }

  async pause(): Promise<void> {
    const context = this.context;
    if (!context || this.stopping || this.isPaused) return;
    if (context.state === 'running') {
      hold(this.transport!.gain, context.currentTime);
      this.transport!.gain.linearRampToValueAtTime(0, context.currentTime + 0.05);
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    if (this.context !== context || this.stopping) return;
    await context.suspend();
    this.music?.pause();
    this.isPaused = true;
  }

  async resume(): Promise<void> {
    const context = this.context;
    if (!context || this.stopping) return;
    if (this.music) await this.music.play();
    await context.resume();
    if (this.context !== context || this.stopping) return;
    smooth(this.transport!.gain, 1, context.currentTime);
    this.isPaused = false;
  }

  async stop(): Promise<void> {
    const context = this.context;
    if (!context || this.stopping) return;
    this.stopping = true;
    if (this.gate && context.state === 'running') {
      hold(this.gate.gain, context.currentTime);
      this.gate.gain.linearRampToValueAtTime(0, context.currentTime + 0.12);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    this.detachMusic();
    await context.close();
    this.voices.clear();
    this.bwgNode?.disconnect();
    this.bwgNode = undefined;
    this.continues = false;
    this.sequenceEnd = undefined;
    this.context = undefined;
    this.master = undefined;
    this.gate = undefined;
    this.transport = undefined;
    this.analysis = undefined;
    this.noise = undefined;
    this.noiseGain = undefined;
    this.musicGain = undefined;
    this.toneBus = undefined;
    this.ambient = undefined;
    this.endAt = undefined;
    this.stopping = false;
    this.isPaused = false;
  }
}
