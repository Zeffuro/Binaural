import type { TriggerSettings } from './trigger-state';

type Motion = { glass: number; light: number; energy: number; pan: number };
type Point = { x: number; y: number };
const TAU = Math.PI * 2;
const SOURCE = 512;
const TRIANGLE_HEIGHT = Math.sqrt(3) / 2;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const rgba = (hex: string, alpha: number) => `${hex}${Math.round(clamp(alpha) * 255).toString(16).padStart(2, '0')}`;
function jewelColor(hex: string): string {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const middle = (Math.max(...channels) + Math.min(...channels)) / 2;
  return `#${channels.map(channel => Math.round(clamp(middle + (channel - middle) * 1.6, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

function canvas(width = SOURCE, height = width): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let bits = Math.imul(value ^ value >>> 15, 1 | value);
    bits ^= bits + Math.imul(bits ^ bits >>> 7, 61 | bits);
    return ((bits ^ bits >>> 14) >>> 0) / 4294967296;
  };
}

function pathPosition(state: TriggerSettings, phase: number): Point {
  let x = 0, y = 0;
  if (state.path === 'orbit') { x = Math.cos(phase) * .78; y = Math.sin(phase) * .65; }
  else if (state.path === 'horizontal') x = Math.sin(phase) * .95;
  else if (state.path === 'vertical') y = Math.sin(phase) * .95;
  else if (state.path === 'figure-eight') { x = Math.sin(phase) * .85; y = Math.sin(phase * 2) * .56; }
  return { x: x + state.offsetX, y: y + state.offsetY };
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number): void {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(.2, rgba(color, alpha * .8));
  gradient.addColorStop(.58, rgba(color, alpha * .23));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function glassPiece(ctx: CanvasRenderingContext2D, motif: TriggerSettings['motif'], radius: number, color: string, depth: number, rng: () => number): void {
  ctx.save();
  color = jewelColor(color);
  const shape = () => {
    ctx.beginPath();
    if (motif === 'beads') ctx.ellipse(0, 0, radius * .65, radius, 0, 0, TAU);
    else if (motif === 'petals') {
      ctx.moveTo(0, -radius);
      ctx.bezierCurveTo(radius * 1.2, -radius * .2, radius * .65, radius, 0, radius);
      ctx.bezierCurveTo(-radius * .65, radius, -radius * 1.2, -radius * .2, 0, -radius);
    } else {
      const count = motif === 'stars' ? 10 : 5;
      for (let j = 0; j < count; j++) {
        const angle = j / count * TAU - Math.PI / 2;
        const r = motif === 'stars' && j % 2 ? radius * .45 : radius;
        if (j) ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
    }
    ctx.closePath();
  };
  shape();
  ctx.shadowColor = '#16062099'; ctx.shadowBlur = radius * .17; ctx.shadowOffsetY = radius * .1;
  const body = ctx.createRadialGradient(-radius * .25, -radius * .3, radius * .02, 0, 0, radius);
  body.addColorStop(0, rgba(color, .78)); body.addColorStop(.45, rgba(color, .98));
  body.addColorStop(.78, rgba(color, .85)); body.addColorStop(1, '#26132ced');
  ctx.fillStyle = body; ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.clip();
  const lower = ctx.createLinearGradient(-radius, -radius, radius, radius);
  lower.addColorStop(0, '#f8e0ff99'); lower.addColorStop(.23, '#ffffff00');
  lower.addColorStop(.65, '#1c092330'); lower.addColorStop(.85, '#e9dbff88'); lower.addColorStop(1, '#ffffff0a');
  ctx.fillStyle = lower; ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  if (motif === 'prism' || motif === 'stars') {
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5;
      polygon(ctx, [{ x: 0, y: radius * .12 }, { x: Math.cos(a) * radius, y: Math.sin(a) * radius }, { x: Math.cos(a + TAU / 5) * radius, y: Math.sin(a + TAU / 5) * radius }]);
      ctx.fillStyle = i % 2 ? '#d3efff28' : '#2e143b32'; ctx.fill();
    }
  }
  ctx.globalAlpha = .32 + depth * .5;
  ctx.lineWidth = Math.max(.8, radius * .065); ctx.strokeStyle = '#ffe7f7';
  ctx.beginPath(); ctx.ellipse(-radius * .16, -radius * .15, radius * .44, radius * .68, 0, Math.PI * .93, Math.PI * 1.58); ctx.stroke();
  ctx.globalAlpha = .75 + depth * .25;
  glow(ctx, -radius * .23, -radius * .48, radius * .19, '#fff9ff', 1);
  glow(ctx, radius * .24, radius * .48, radius * .3, '#fff2ff', .5 + rng() * .2);
  ctx.restore();
}

function createTexture(state: TriggerSettings): HTMLCanvasElement {
  const result = canvas(), ctx = result.getContext('2d')!, rng = random(state.seed);
  const backing = ctx.createLinearGradient(0, 0, SOURCE, SOURCE);
  backing.addColorStop(0, '#683c7c'); backing.addColorStop(.45, '#a694ba'); backing.addColorStop(1, '#3e8198');
  ctx.fillStyle = backing; ctx.fillRect(0, 0, SOURCE, SOURCE);
  for (let i = 0; i < 24; i++) {
    glow(ctx, rng() * SOURCE, rng() * SOURCE, 40 + rng() * 100, i % 2 ? state.accent : '#f0c7e8', .08);
  }
  const count = Math.round(state.density * 18);
  for (let i = 0; i < count; i++) {
    const x = rng() * SOURCE, y = rng() * SOURCE;
    const radius = 6 + rng() * 13 + (i % 19 === 0 ? 9 : 0);
    const color = i % 17 === 0 ? '#edb454' : i % 4 === 0 ? state.accent : state.color;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * TAU);
    glassPiece(ctx, state.motif, radius, color, state.depth, rng); ctx.restore();
  }
  for (let i = 0; i < 10; i++) {
    ctx.save(); ctx.translate(rng() * SOURCE, rng() * SOURCE); ctx.rotate(rng() * TAU);
    polygon(ctx, [{ x: -28, y: -19 }, { x: 37, y: -9 }, { x: 17, y: 48 }]);
    ctx.fillStyle = '#152b728c'; ctx.fill();
    ctx.strokeStyle = '#a4d4ef80'; ctx.lineWidth = 1; ctx.stroke();
    polygon(ctx, [{ x: -28, y: -19 }, { x: 7, y: 5 }, { x: 17, y: 48 }]);
    ctx.fillStyle = '#75c8e738'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(7, 5); ctx.lineTo(37, -9); ctx.strokeStyle = '#dbb6ff80'; ctx.stroke(); ctx.restore();
  }
  // Fine original texture keeps the translucent backing from reading as a flat vector fill.
  const grain = ctx.getImageData(0, 0, SOURCE, SOURCE);
  for (let i = 0; i < grain.data.length; i += 4) {
    const amount = (rng() - .5) * 5;
    grain.data[i] += amount; grain.data[i + 1] += amount; grain.data[i + 2] += amount;
  }
  ctx.putImageData(grain, 0, 0);
  return result;
}

export class TriggerRenderer {
  private texture: HTMLCanvasElement | null = null;
  private textureKey = '';
  private readonly source = canvas();
  private readonly frame = canvas(1);
  private readonly lit = canvas();

  reset(): void {
    this.texture = null; this.textureKey = '';
    this.frame.width = 1; this.frame.height = 1;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings, motion: Motion): void {
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(1, 1440 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.frame.width !== w || this.frame.height !== h) { this.frame.width = w; this.frame.height = h; }
    const frame = this.frame.getContext('2d')!;
    frame.clearRect(0, 0, w, h); frame.fillStyle = '#050408'; frame.fillRect(0, 0, w, h);
    if (state.style === 'kaleidoscope') this.kaleidoscope(frame, w, h, state, motion);
    else if (state.style === 'scan') this.scan(frame, w, h, state, motion);
    else this.torch(frame, w, h, state, motion);
    ctx.save();
    try {
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
      ctx.filter = 'none'; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, height);
      const exposure = clamp(state.brightness * 2), gain = 1 + Math.max(0, state.brightness - 1) * 1.5;
      const finish = `brightness(${gain})`;
      ctx.globalAlpha = exposure;
      ctx.filter = `${finish} blur(${state.softness * 2.4}px)`;
      ctx.drawImage(this.frame, 0, 0, width, height);
      if (state.glow > 0) {
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = state.glow * .3 * exposure;
        ctx.filter = `${finish} blur(${4 + state.glow * 15}px)`; ctx.drawImage(this.frame, 0, 0, width, height);
      }
      ctx.filter = 'none'; ctx.globalAlpha = exposure / gain; ctx.globalCompositeOperation = 'source-over';
      const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .2, width / 2, height / 2, Math.hypot(width, height) * .55);
      vignette.addColorStop(0, '#03020a00'); vignette.addColorStop(.65, '#03020a18'); vignette.addColorStop(1, '#03020aac');
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    } finally { ctx.restore(); }
  }

  private illuminate(state: TriggerSettings, motion: Motion): void {
    const key = [state.seed, state.motif, state.color, state.accent, state.density, state.depth].join(':');
    if (!this.texture || key !== this.textureKey) { this.texture = createTexture(state); this.textureKey = key; }
    const source = this.source.getContext('2d')!, lit = this.lit.getContext('2d')!;
    const phase = motion.glass;
    source.clearRect(0, 0, SOURCE, SOURCE);
    source.save(); source.translate(SOURCE / 2, SOURCE / 2);
    source.rotate(phase * .19);
    source.translate(Math.sin(phase * .63) * state.drift * 55, Math.sin(phase * .41) * state.drift * 55);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      source.save(); source.translate(x * SOURCE - SOURCE / 2, y * SOURCE - SOURCE / 2);
      if (x % 2) { source.translate(SOURCE, 0); source.scale(-1, 1); }
      if (y % 2) { source.translate(0, SOURCE); source.scale(1, -1); }
      source.drawImage(this.texture, 0, 0); source.restore();
    }
    source.restore();
    lit.globalCompositeOperation = 'source-over'; lit.fillStyle = '#080611'; lit.fillRect(0, 0, SOURCE, SOURCE);
    lit.globalAlpha = .12 + clamp(state.brightness) * .36; lit.drawImage(this.source, 0, 0); lit.globalAlpha = 1;
    const point = pathPosition(state, motion.light);
    const x = SOURCE * (.44 + point.x * .46 + clamp(motion.pan, -1, 1) * state.reaction * .06);
    const y = SOURCE * (.38 + point.y * .46);
    const radius = SOURCE * (.2 + state.size * .8) * (state.path === 'manual' ? 1 : 1 + Math.sin(motion.light * .7) * .12);
    const strength = state.light * (.5 + clamp(state.brightness) * .48 + clamp(motion.energy) * state.reaction * .1);
    // The lamp illuminates the source before any mirrors, so matching facets brighten together.
    lit.globalCompositeOperation = 'screen';
    glow(lit, x, y, radius * 1.8, state.lampColor, strength * .9);
    glow(lit, x, y, radius * 1.2, jewelColor(state.lampColor), strength);
    lit.globalCompositeOperation = 'lighter';
    glow(lit, x, y, radius * .82, '#edfbff', strength * .95);
    lit.globalCompositeOperation = 'multiply'; lit.globalAlpha = .72;
    lit.filter = 'saturate(1.65)'; lit.drawImage(this.source, 0, 0); lit.filter = 'none';
    lit.globalAlpha = 1; lit.globalCompositeOperation = 'source-over';
    lit.globalAlpha = .045 + state.depth * .055; lit.drawImage(this.source, 0, 0); lit.globalAlpha = 1;
    if (state.light > 1) {
      lit.filter = `brightness(${1 + (state.light - 1) * .5})`; lit.globalCompositeOperation = 'copy';
      lit.drawImage(this.lit, 0, 0); lit.filter = 'none'; lit.globalCompositeOperation = 'source-over';
    }
  }

  private kaleidoscope(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings, motion: Motion): void {
    this.illuminate(state, motion);
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(state.rotation * Math.PI / 180);
    if (state.layout === 'radial') this.radial(ctx, width, height, state);
    else this.tiled(ctx, width, height, state);
    ctx.restore();
  }

  private tiled(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings): void {
    const side = Math.min(width, height) * .32 * state.zoom;
    const rise = side * TRIANGLE_HEIGHT;
    const reach = Math.hypot(width, height) * .56;
    const columns = Math.ceil(reach / side) + 2, rows = Math.ceil(reach / rise) + 2;
    const label = (i: number, j: number) => ((i - j) % 3 + 3) % 3;
    const vertex = (i: number, j: number) => ({ x: (i + j * .5) * side, y: j * rise });
    for (let j = -rows; j <= rows; j++) {
      const center = -Math.round(j * .5);
      for (let i = center - columns; i <= center + columns; i++) {
        for (const indices of [[[i, j], [i + 1, j], [i, j + 1]], [[i + 1, j], [i + 1, j + 1], [i, j + 1]]]) {
          const points: Point[] = [];
          for (const [a, b] of indices) points[label(a, b)] = vertex(a, b);
          this.triangle(ctx, points);
        }
      }
    }
  }

  private triangle(ctx: CanvasRenderingContext2D, points: Point[]): void {
    const [a, b, c] = points;
    ctx.save(); polygon(ctx, points); ctx.clip();
    ctx.transform((b.x - a.x) / SOURCE, (b.y - a.y) / SOURCE,
      (c.x - (a.x + b.x) / 2) / (SOURCE * TRIANGLE_HEIGHT), (c.y - (a.y + b.y) / 2) / (SOURCE * TRIANGLE_HEIGHT), a.x, a.y);
    ctx.drawImage(this.lit, 0, 0); ctx.restore();
  }

  private radial(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings): void {
    const count = Math.max(6, Math.round(state.symmetry) * 2), step = TAU / count;
    const radius = Math.hypot(width, height) * .55;
    for (let i = 0; i < count; i++) {
      ctx.save(); ctx.rotate(i * step);
      polygon(ctx, [{ x: 0, y: 0 }, { x: radius + 2, y: 0 }, { x: Math.cos(step) * (radius + 2), y: Math.sin(step) * (radius + 2) }]); ctx.clip();
      if (i % 2) { ctx.rotate(step); ctx.scale(1, -1); }
      const size = radius * (1.1 + state.zoom * .45);
      ctx.drawImage(this.lit, -size * .12, -size * .18, size, size); ctx.restore();
    }
  }

  private scan(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings, motion: Motion): void {
    const reach = Math.min(width, height);
    const rotation = state.rotation * Math.PI / 180;
    const length = reach * (.12 + state.size * .76), breadth = reach * (.012 + state.size * .085);
    const samples = 1 + Math.round(state.trail * 15);
    for (let i = samples - 1; i >= 0; i--) {
      const point = pathPosition(state, motion.light - i * .035);
      const x = width * (.5 + point.x * .4 + clamp(motion.pan, -1, 1) * state.reaction * .04), y = height * (.5 + point.y * .4);
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.scale(length, breadth);
      const strength = (1 - i / samples) * (i ? .1 : .8) * (.2 + clamp(state.brightness) * .8) * (1 + clamp(motion.energy) * state.reaction * .08);
      glow(ctx, 0, 0, 1.6, state.accent, strength * .5);
      glow(ctx, 0, 0, 1, state.color, strength);
      glow(ctx, 0, 0, .55, '#fff1ed', strength * .45); ctx.restore();
    }
  }

  private torch(ctx: CanvasRenderingContext2D, width: number, height: number, state: TriggerSettings, motion: Motion): void {
    const point = pathPosition(state, motion.light), reach = Math.min(width, height);
    const angle = state.rotation * Math.PI / 180;
    const x = width * (.5 + (point.x * Math.cos(angle) - point.y * Math.sin(angle)) * .34), y = height * (.5 + (point.x * Math.sin(angle) + point.y * Math.cos(angle)) * .34);
    const radius = reach * (.035 + state.size * .32);
    const strength = (.2 + clamp(state.brightness) * .65) * (1 + clamp(motion.energy) * state.reaction * .08);
    ctx.globalCompositeOperation = 'screen';
    glow(ctx, x, y, radius * 2.8, state.color, strength * .38);
    glow(ctx, x, y, radius * 1.5, state.accent, strength * .65);
    const disk = ctx.createRadialGradient(x - radius * .2, y - radius * .2, 0, x, y, radius);
    disk.addColorStop(0, rgba('#fffaf4', strength * .95)); disk.addColorStop(.6, rgba(state.color, strength * .72));
    disk.addColorStop(.84, rgba(state.accent, strength * .58)); disk.addColorStop(1, rgba(state.accent, 0));
    ctx.fillStyle = disk; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    if (state.depth > 0) {
      glow(ctx, width - x, height - y, radius * .65, state.accent, strength * state.depth * .28);
      glow(ctx, width / 2 + (x - width / 2) * .25, height / 2 + (y - height / 2) * .25, radius * .3, state.color, strength * state.depth * .3);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
