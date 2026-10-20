import type { VisualFrame } from './audio/visual-analysis';
import { butterchurnPresets } from './butterchurn-presets';
import { type VisualQuality, visualRatio } from './visual-state';

type Engine = ReturnType<typeof import('butterchurn').default.createVisualizer>;

export class Milkdrop {
  private engine?: Engine;
  private revision = 0;
  private selected?: string;
  private silent = new Uint8Array(1024).fill(128);
  private size = '';
  private lost = false;
  private frames = 0;
  private snapshot = document.createElement('canvas');
  private snapshotContext = this.snapshot.getContext('2d')!;

  constructor(readonly canvas: HTMLCanvasElement, private report: (message: string) => void) {
    this.snapshot.className = canvas.className; this.clearFrame();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; this.clearFrame();
      this.report('Graphics were interrupted. Choose another scene or reload to retry MilkDrop.');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.engine = undefined; this.selected = undefined;
      this.report('Graphics restored. Select the MilkDrop preset again to continue.');
    });
  }

  async load(id: string, blendSeconds = 0): Promise<boolean> {
    if (id === this.selected && this.engine) return !this.lost;
    const preset = butterchurnPresets.find(item => item.id === id);
    if (!preset) return false;
    const ticket = ++this.revision;
    try {
      const [library, response] = await Promise.all([import('butterchurn'), fetch(preset.url)]);
      if (!response.ok) throw new Error('Preset download failed. Try selecting it again.');
      const data = await response.json();
      if (ticket !== this.revision) return false;
      if (!this.engine) {
        if (!this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false })) throw new Error('MilkDrop needs WebGL 2. Try a music pattern or nature scene instead.');
        // Supplied output samples keep visualization separate from the audible graph.
        const factory = 'createVisualizer' in library.default ? library.default : (library.default as unknown as { default: typeof library.default }).default;
        this.engine = factory.createVisualizer(null, this.canvas,
          { width: 320, height: 200, pixelRatio: 1, meshWidth: 32, meshHeight: 24 });
      }
      this.engine.loadPreset(data, this.selected ? blendSeconds : 0);
      this.selected = id; this.size = ''; this.clearFrame();
      this.canvas.dataset.preset = id;
      this.report(`${preset.name} by ${preset.author}.`);
      return true;
    } catch (error) {
      if (ticket === this.revision) this.report(error instanceof Error ? error.message : 'MilkDrop could not start. Try another scene.');
      return false;
    }
  }

  private clearFrame(): void {
    this.frames = 0; this.snapshot.width = this.snapshot.height = 1; delete this.canvas.dataset.frames;
  }

  cancel(): void { this.revision++; this.clearFrame(); }

  captureReady(): boolean { return !!this.engine && !!this.selected && !this.lost && this.frames > 0; }

  captureFrame(): HTMLCanvasElement { return this.snapshot; }

  render(frame: VisualFrame | undefined, seconds: number, quality: VisualQuality = 'balanced', captureSize?: { width: number; height: number }, moving = true): void {
    if (!this.engine || this.lost || (!moving && this.frames > 0)) return;
    const bounds = captureSize ?? this.canvas.getBoundingClientRect();
    const ratio = visualRatio(bounds.width, quality);
    const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio));
    const size = `${width}x${height}`;
    if (size !== this.size) { this.canvas.width = width; this.canvas.height = height; this.engine.setRendererSize(width, height); this.size = size; }
    this.engine.render({ elapsedTime: Math.max(1 / 120, seconds), audioLevels: {
      timeByteArray: frame?.waveform ?? this.silent,
      timeByteArrayL: frame?.left ?? this.silent,
      timeByteArrayR: frame?.right ?? this.silent,
    } });
    // Retain the fresh WebGL frame so paused captures never advance the renderer.
    if (this.snapshot.width !== width || this.snapshot.height !== height) { this.snapshot.width = width; this.snapshot.height = height; }
    this.snapshotContext.drawImage(this.canvas, 0, 0);
    this.canvas.dataset.frames = String(++this.frames);
    this.canvas.dataset.audio = frame ? 'mix' : 'silence';
  }
}
