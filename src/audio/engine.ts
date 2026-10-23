import { type Session } from '../model';
import { hold, noiseBuffer, smooth, ToneVoice } from './graph';
import { bwgContinues, decodeBwg } from '../import/bwg-program';
import workletUrl from './bwg-worklet.ts?worker&url';
import { backgroundAssets } from '../background-assets';
import { generatedBackgrounds, makeGeneratedBackground } from './generated-backgrounds';
import { VisualAnalysis, type VisualFrame } from './visual-analysis';
import { AsmrMixer } from './asmr-mixer';
import { listeningMode, modeGains } from '../listening-mode';
import { asmrAudioReady, prepareAsmrAudio } from './asmr-phrase-source';
import { asmrBackgroundGain } from '../asmr-focus';
import { AsmrCueTimeline, visualOutputTime, type VisualTimeline } from './visual-timing';

export interface AudioCaptureLease {
  stream: MediaStream;
  time(): number;
  state(): 'playing' | 'paused' | 'stopped';
  dispose(): void;
}

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
  private musicFile?: File;
  private musicRevision = 0;
  private stopping = false;
  private isPaused = false;
  private origin = 0;
  private bwgNode?: AudioWorkletNode;
  private bwgBus?: GainNode;
  private continues = false;
  private analysis?: VisualAnalysis;
  private sequenceEnd?: number;
  private asmr?: AsmrMixer;
  private asmrRevision = 0;
  private asmrPending = false;
  private visualGain = 0;
  private visualFadeIn = .5;
  private captures = new Set<AudioCaptureLease>();
  private cueTimeline = new AsmrCueTimeline();
  private cueSignature = '';
  private cueReaders = new Set<symbol>();
  get loadingAsmr(): boolean { return this.asmrPending; }
  failure?: string;

  get holding(): boolean { return this.continues && (this.sequenceEnd ?? Infinity) <= (this.context?.currentTime ?? 0); }

  get playing(): boolean { return !!this.context && !this.stopping; }
  get state(): string { return this.context?.state ?? 'stopped'; }
  get paused(): boolean { return this.isPaused; }
  get selectedMusicFile(): File | undefined { return this.musicFile; }
  requestVisualCues(): () => void {
    const reader = Symbol();
    this.cueReaders.add(reader);
    return () => {
      if (!this.cueReaders.delete(reader) || this.cueReaders.size) return;
      this.asmr?.clearCues(); this.cueTimeline.clear();
    };
  }
  visualFrame(timeline: VisualTimeline = 'analysis', offsetMs = 0, needCues = true): VisualFrame | undefined {
    const frame = this.analysis?.read(), context = this.context;
    if (!frame || !context) return frame;
    if (!needCues) return { ...frame, asmr: [] };
    const audible = !this.stopping && !this.isPaused && context.state === 'running' && !this.asmrPending &&
      this.visualGain > 0 && (this.endAt === undefined || context.currentTime < this.endAt);
    if (!audible) { this.asmr?.clearCues(); this.cueTimeline.clear(); frame.asmr = []; }
    else {
      const fadeIn = Math.min(1, (context.currentTime - this.origin) / this.visualFadeIn);
      const fadeOut = this.endAt === undefined ? 1 : Math.min(1, (this.endAt - context.currentTime) / Math.min(2, (this.endAt - this.origin) / 2));
      frame.asmr = this.asmr?.readCues(this.visualGain * Math.max(0, Math.min(fadeIn, fadeOut)), frame.time) ?? [];
      this.cueTimeline.push(frame.time, frame.asmr);
    }
    return timeline === 'analysis' ? frame : { ...frame,
      asmr: this.cueTimeline.read(visualOutputTime(context, timeline, offsetMs), context.sampleRate) };
  }
  captureAudio(): AudioCaptureLease {
    const context = this.context, transport = this.transport;
    if (!context || !transport || this.stopping || this.isPaused || context.state !== 'running') {
      throw new Error('Start playback before recording video.');
    }
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    destination.channelCountMode = 'explicit';
    destination.channelInterpretation = 'speakers';
    let disposed = false;
    const lease: AudioCaptureLease = {
      stream: destination.stream,
      time: () => context.currentTime,
      state: () => disposed || this.context !== context || context.state === 'closed' ? 'stopped'
        : this.isPaused || context.state !== 'running' ? 'paused' : 'playing',
      dispose: () => {
        if (disposed) return;
        disposed = true;
        transport.disconnect(destination);
        destination.disconnect();
        destination.stream.getTracks().forEach(track => track.stop());
        this.captures.delete(lease);
      },
    };
    transport.connect(destination);
    this.captures.add(lease);
    return lease;
  }
  get remaining(): number | undefined {
    return this.sequenceEnd === undefined ? undefined : Math.max(0, this.sequenceEnd - (this.context?.currentTime ?? 0));
  }

  async start(session: Session): Promise<void> {
    if (this.context) return;
    const context = new AudioContext({ latencyHint: 'playback' });
    this.context = context;
    this.cueTimeline.clear(); this.cueSignature = '';
    context.addEventListener('sinkchange', () => this.cueTimeline.clear());
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
      this.visualFadeIn = duration > 0 ? Math.min(.5, duration / 4) : .5;
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
      this.toneBus.gain.value = session.tonesMuted ? 0 : modeGains(listeningMode(session)).tones;
      this.toneBus.connect(this.master);
      this.asmr = new AsmrMixer(context, this.master, this.endAt, 0,
        () => { if (current()) this.failure = 'The ASMR phrase processor stopped unexpectedly. Playback has been stopped.'; });
      if (modeGains(listeningMode(session)).asmr) {
        await prepareAsmrAudio(context, session.asmr);
        if (!current()) return;
      }
      if (bwg) {
        await context.audioWorklet.addModule(workletUrl);
        if (!current()) return;
        const background = await backgroundAssets.resolve(bwg, session.bwgBackgroundSource);
        if (!current()) return;
        this.bwgNode = new AudioWorkletNode(context, 'bwg-sequence', { numberOfInputs: 0,
          numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { preset: bwg, background } });
        this.bwgNode.addEventListener('processorerror', () => { this.failure = 'The BWGen audio processor stopped unexpectedly. Playback has been stopped.'; });
        this.bwgBus = context.createGain(); this.bwgBus.gain.value = session.bwgMuted ? 0 : modeGains(listeningMode(session)).tones;
        this.bwgNode.connect(this.bwgBus).connect(this.master);
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
    const gains = modeGains(listeningMode(session));
    const cueSignature = JSON.stringify([!!gains.asmr, session.master > 0, (session.asmr?.level ?? 0) > 0,
      session.asmr?.variation?.mode !== 'steady' && !!session.asmr?.variation,
      session.asmr?.layers.map(layer => [layer.id, layer.sound, !!layer.spatial, layer.muted, layer.solo, layer.level > 0])]);
    if (cueSignature !== this.cueSignature) { this.cueTimeline.clear(); this.cueSignature = cueSignature; }
    smooth(this.master.gain, session.master, context.currentTime);
    this.visualGain = session.master;
    if (this.toneBus) smooth(this.toneBus.gain, session.tonesMuted ? 0 : gains.tones, context.currentTime);
    for (const [id, voice] of this.voices) {
      if (!session.layers.some(layer => layer.id === id)) {
        voice.dispose();
        this.voices.delete(id);
      }
    }
    if (this.bwgNode) this.bwgNode.port.postMessage({ levels: session.layers.map(layer => session.tonesMuted ? 0 : layer.level) });
    if (this.bwgBus) smooth(this.bwgBus.gain, session.bwgMuted ? 0 : gains.tones, context.currentTime);
    for (const layer of session.bwg ? [] : session.layers) {
      const existing = this.voices.get(layer.id);
      if (existing) existing.update(layer, session.layers.length);
      else this.voices.set(layer.id, new ToneVoice(context, layer, this.toneBus!, session.layers.length, this.endAt, this.origin));
    }
    if (this.ambient !== session.ambient) this.changeAmbient(session);
    const ready = asmrAudioReady(context, session.asmr);
    this.updateBackgroundLevels(session, ready);
    const revision = ++this.asmrRevision, mixer = this.asmr;
    if (!mixer) return;
    if (!gains.asmr || ready) {
      this.asmrPending = false; mixer.update(session.asmr, !!gains.asmr); return;
    }
    this.asmrPending = true;
    const settings = structuredClone(session.asmr);
    mixer.update(settings, false);
    const current = () => this.context === context && this.asmr === mixer && this.asmrRevision === revision && !this.stopping;
    void prepareAsmrAudio(context, settings).then(() => { if (current()) {
      this.asmrPending = false; mixer.update(settings, true); this.updateBackgroundLevels({ ...session, asmr: settings });
    } }, error => {
      if (current()) { this.asmrPending = false; this.failure = error instanceof Error ? error.message : 'The ASMR recording could not load.'; }
    });
  }

  private updateBackgroundLevels(session: Session, ready = true): void {
    const time = this.context!.currentTime, gain = asmrBackgroundGain(session, ready);
    // The session gate is downstream, so edits cannot erase its scheduled fade-out.
    if (this.musicGain) smooth(this.musicGain.gain, session.musicLevel * .4 * gain, time);
    if (this.noiseGain) smooth(this.noiseGain.gain, session.ambientLevel * .22 * gain, time);
    this.bwgNode?.port.postMessage({ backgroundGain: gain });
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
    const revision = ++this.musicRevision;
    this.detachMusic();
    if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
    this.musicUrl = undefined;
    this.musicFile = undefined;
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    let adopted = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); probe.onloadeddata = null; probe.onerror = null; };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Audio file took too long to load.')); }, 10000);
        probe.onloadeddata = () => { cleanup(); resolve(); };
        probe.onerror = () => { cleanup(); reject(new Error('Audio format is unsupported or the file is damaged.')); };
        probe.preload = 'auto';
        probe.src = url;
      });
      if (this.musicRevision !== revision) return;
      this.musicUrl = url;
      this.musicFile = file;
      adopted = true;
      if (this.playing) await this.attachMusic(url);
    } catch (error) {
      if (this.musicRevision !== revision) return;
      this.detachMusic();
      this.musicUrl = undefined;
      this.musicFile = undefined;
      adopted = false;
      throw error;
    } finally {
      if (!adopted) URL.revokeObjectURL(url);
      probe.removeAttribute('src');
      probe.load();
    }
  }

  private async attachMusic(url: string): Promise<void> {
    const context = this.context, gain = this.musicGain;
    if (!context || !gain || this.stopping || this.musicUrl !== url) return;
    this.detachMusic();
    const music = new Audio(url);
    music.loop = true;
    this.music = music;
    context.createMediaElementSource(music).connect(gain);
    if (!this.isPaused) {
      try { await music.play(); }
      catch (error) { if (this.music === music && this.context === context && !this.stopping) throw error; }
    }
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
    this.cueTimeline.clear();
  }

  async resume(): Promise<void> {
    const context = this.context;
    if (!context || this.stopping) return;
    if (this.music) await this.music.play();
    await context.resume();
    if (this.context !== context || this.stopping) return;
    smooth(this.transport!.gain, 1, context.currentTime);
    this.isPaused = false;
    this.cueTimeline.clear();
  }

  async stop(): Promise<void> {
    const context = this.context;
    if (!context || this.stopping) return;
    this.stopping = true;
    this.cueTimeline.clear();
    this.visualGain = 0; this.asmr?.clearCues();
    ++this.asmrRevision; this.asmrPending = false;
    if (this.gate && context.state === 'running') {
      hold(this.gate.gain, context.currentTime);
      this.gate.gain.linearRampToValueAtTime(0, context.currentTime + 0.12);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    this.detachMusic();
    for (const capture of this.captures) capture.dispose();
    await context.close();
    this.asmr?.dispose(); this.asmr = undefined;
    this.voices.clear();
    this.bwgNode?.disconnect();
    this.bwgNode = undefined;
    this.bwgBus?.disconnect(); this.bwgBus = undefined;
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
