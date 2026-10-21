import type { AsmrCue, AsmrCueKind } from './audio/asmr-cues';
import type { TriggerSettings } from './trigger-state';

const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function halo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number): void {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `${color}dc`); gradient.addColorStop(.22, `${color}8c`); gradient.addColorStop(1, `${color}00`);
  ctx.save(); ctx.globalAlpha *= clamp(alpha); ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); ctx.restore();
}

function brush(ctx: CanvasRenderingContext2D, size: number, progress: number, state: TriggerSettings): void {
  ctx.rotate(-.35 + (.5 - Math.cos(progress * TAU) * .5) * .7);
  const length = size * 2.7;
  for (let i = 0; i < 39; i++) {
    const strand = (i - 19) / 19, wave = Math.sin(i * 2.37) * size * .05;
    ctx.strokeStyle = i % 3 ? state.color : state.accent; ctx.globalAlpha = .12 + .22 * (1 - Math.abs(strand));
    ctx.lineWidth = Math.max(.6, size * .008);
    ctx.beginPath(); ctx.moveTo(-length * .5, strand * size * .23);
    ctx.bezierCurveTo(-length * .1, strand * size * .4 + wave, length * .3, strand * size * .28, length * .5, strand * size * .14);
    ctx.stroke();
  }
  ctx.globalAlpha = 1; halo(ctx, 0, 0, size * 1.2, state.accent, .18);
}

function trace(ctx: CanvasRenderingContext2D, size: number, progress: number, state: TriggerSettings): void {
  ctx.lineWidth = Math.max(1, size * .014); ctx.strokeStyle = state.accent; ctx.lineCap = 'round';
  ctx.beginPath();
  let x = 0, y = 0;
  for (let i = 0; i <= 45; i++) {
    const angle = (progress - (45 - i) / 90) * TAU;
    x = Math.sin(angle) * size * 1.35; y = Math.sin(angle * 2) * size * .65;
    if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); halo(ctx, x, y, size * .3, state.color, .7);
}

function inspect(ctx: CanvasRenderingContext2D, size: number, progress: number, state: TriggerSettings): void {
  const approach = .5 - Math.cos(progress * TAU) * .5;
  ctx.rotate((approach - .5) * .7); ctx.scale(.8 + approach * .35, .8 + approach * .35);
  const body = ctx.createLinearGradient(-size, -size, size, size);
  body.addColorStop(0, `${state.color}10`); body.addColorStop(.32, `${state.color}70`);
  body.addColorStop(.49, `${state.accent}18`); body.addColorStop(.7, `${state.accent}55`); body.addColorStop(1, `${state.color}08`);
  ctx.fillStyle = body; ctx.strokeStyle = `${state.color}aa`; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const angle = i / 6 * TAU, x = Math.cos(angle) * size, y = Math.sin(angle) * size;
    if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = `${state.accent}70`; ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size * .5, size * .866);
  ctx.lineTo(0, -size * .7); ctx.closePath(); ctx.stroke(); halo(ctx, -size * .3, -size * .4, size * .25, state.color, .5);
}

function contact(ctx: CanvasRenderingContext2D, size: number, cue: AsmrCue, kind: AsmrCueKind, state: TriggerSettings): void {
  const retreat = clamp(1 - cue.contact), radius = size * (.16 + cue.contact * .14);
  halo(ctx, 0, 0, radius * 3, state.color, .6);
  const rings = kind === 'drop' ? 3 : 1;
  for (let i = 0; i < rings; i++) {
    ctx.globalAlpha = (.35 - i * .08) * (1 - retreat * .65); ctx.strokeStyle = state.accent; ctx.lineWidth = Math.max(1, size * .015);
    ctx.beginPath(); ctx.ellipse(0, radius * .25, size * (.2 + retreat * .9 + i * .22), size * (.14 + retreat * .36 + i * .1), 0, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  halo(ctx, 0, -radius * retreat * 2, radius, '#fff1dd', .3 + cue.contact * .35);
}

export function renderGestures(ctx: CanvasRenderingContext2D, width: number, height: number,
    state: TriggerSettings, cues: readonly AsmrCue[], phase: number): void {
  const background = ctx.createRadialGradient(width * .5, height * .55, 0, width * .5, height * .5, Math.hypot(width, height) * .6);
  background.addColorStop(0, '#14111d'); background.addColorStop(1, '#030309'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  const selected = (state.syncAsmr ? cues : []).filter(cue => cue.strength > .001).sort((a, b) => b.strength - a.strength).slice(0, 3);
  if (!selected.length) {
    if (state.syncAsmr) { halo(ctx, width * .5, height * .5, Math.min(width, height) * .12, state.color, .12); return; }
    selected.push({ id: 'preview', kind: 'follow', pan: Math.sin(phase * .3) * .8, progress: (Math.sin(phase * .2) + 1) / 2, strength: .5, contact: 0, time: 0 });
  }
  const reach = Math.min(width, height);
  const still = !state.speed && !state.drift && !state.lightSpeed;
  for (const measured of selected) {
    const cue = still ? { ...measured, progress: 0, pan: 0, contact: 0, strength: .5 } : measured;
    const kind = state.gesture && state.gesture !== 'auto' ? state.gesture : cue.kind;
    const placement = state.path === 'manual' ? state.offsetX : cue.pan;
    const x = width * (.5 + placement * .4);
    const y = height * (state.path === 'manual' ? .5 + state.offsetY * .4 : .52 + Math.sin(cue.progress * TAU) * .08);
    const size = reach * (.075 + state.size * .22) * (.75 + cue.strength * .5);
    ctx.save(); ctx.globalAlpha = .35 + cue.strength * .65;
    if (kind === 'ear') {
      const edge = placement < 0 ? 0 : width;
      ctx.translate(edge, height * .5); ctx.scale(1, 2.1);
      halo(ctx, 0, 0, reach * (.14 + cue.strength * .2), state.color, .3 + cue.strength * .55);
      halo(ctx, (placement < 0 ? 1 : -1) * size * .25, 0, size, state.accent, cue.strength * .3);
    } else {
      ctx.translate(x, y);
      if (kind === 'brush') brush(ctx, size, cue.progress, state);
      else if (kind === 'trace') trace(ctx, size, cue.progress, state);
      else if (kind === 'inspect') inspect(ctx, size, cue.progress, state);
      else if (kind === 'tap' || kind === 'drop') contact(ctx, size, cue, kind, state);
      else {
        halo(ctx, 0, 0, size * (1.6 + cue.progress * .3), state.accent, .3);
        halo(ctx, 0, 0, size * .7, state.color, .8);
        halo(ctx, -size * .08, -size * .08, size * .23, '#fff3db', .65);
      }
    }
    ctx.restore();
  }
}
