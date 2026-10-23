import { type LightColor } from './visual-color';
import { setupColorPicker } from './color-picker';
import { setupVisualizer } from './visualizer';
import type { VisualFrame } from './audio/visual-analysis';
import type { VisualTimeline } from './audio/visual-timing';
import { defaultVisualSettings, parseVisualSettings, type VisualSettings, visualBudget } from './visual-state';
import './visual-features.css';
import { setupVisualDock } from './visual-dock';
import { setupControlsPreference, setupImmersiveControls } from './immersive-controls';
import { captureSurface, type VisualCapture } from './visual-capture';

export function setupVisuals(audio: (timeline?: VisualTimeline, offsetMs?: number, needCues?: boolean) => VisualFrame | undefined, changed: () => void = () => {}, beforeEdit: () => void = () => {}, requestCues?: () => () => void) {
  document.querySelector('#visual-controls')!.innerHTML = `
    <label class="visual-toggle" for="visuals"><span><strong>Ambient light</strong><small>Color, movement and a full-screen space</small></span><input id="visuals" type="checkbox" role="switch" /></label>
    <div id="visual-preview" class="visual-preview" role="img" aria-label="Ambient color preview"></div>
    <div id="light-picker"></div>
    <label for="visual-mode">Light style</label><select id="visual-mode"><option value="still">Still color</option><option value="breathe">Slow breathing</option><option value="cycle">Slow hue journey</option></select>
    <label class="range-heading" for="visual-hue">Color hue <output id="hue-value">140°</output></label><input id="visual-hue" aria-label="Color hue" type="range" min="0" max="360" step="any" value="140" />
    <label class="range-heading" for="visual-brightness">Brightness <output id="brightness-value">35%</output></label><input id="visual-brightness" type="range" min="0" max="100" step="any" value="35" />
    <label class="range-heading" for="visual-speed">Cycle duration <output id="speed-value">30 s</output></label><input id="visual-speed" type="range" min="10" max="120" value="30" />
    <label class="visual-toggle" for="visual-theme"><span>Color the whole studio</span><input id="visual-theme" type="checkbox" /></label>
    <button id="light-fullscreen" class="save-button">Open immersive light ↗</button>
    <p id="visual-status" class="fine-print">Light is off. The preview shows your chosen color. No flashing or strobe effects.</p><div id="scene-controls"></div>`;
  const stage = document.createElement('dialog');
  stage.className = 'light-stage';
  stage.setAttribute('aria-label', 'Immersive ambient light');
  stage.innerHTML = '<div class="light-field" aria-hidden="true"></div><div class="light-overlay"><span>AMBIENT LIGHT</span><button id="close-light" class="secondary-button">Close light (Esc)</button></div>';
  document.body.append(stage);
  const input = (id: string) => document.querySelector<HTMLInputElement>(id)!;
  let color: LightColor = { hue: 140, saturation: 40, level: 35 };
  let running = false;
  let phase = 0;
  let previous = 0;
  let raf = 0;
  let closing = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const picker = setupColorPicker(document.querySelector('#light-picker')!, value => { scenes.cancelPending(); color = value; phase = 0; refresh(); changed(); });
  let lastChoice = 'aurora';
  const quick = document.querySelector<HTMLElement>('#visual-quick') ?? document.querySelector('.transport')!.appendChild(document.createElement('div'));
  quick.classList.add('visual-quick'); quick.setAttribute('aria-label', 'Visual Quick Start'); quick.setAttribute('role', 'group');
  quick.innerHTML = '<span>Visuals</span>' + ['Off', 'Calm', 'Reactive', 'Nature', 'MilkDrop', 'Light triggers'].map(name => `<button type="button" class="secondary-button" data-visual-quick="${name === 'Light triggers' ? 'triggers' : name.toLowerCase()}" aria-pressed="${name === 'Off'}">${name}</button>`).join('');
  const dock = setupVisualDock(quick, () => { beforeEdit(); void fullscreen(); });
  setupControlsPreference(dock.controls);
  const immersive = setupImmersiveControls(stage, stage.querySelector('.light-field')!, stage.querySelector('.light-overlay')!, () => { void fullscreen(); }, () => { void closeStage(); });
  const edit = () => { syncQuick(); changed(); };
  const scenes = setupVisualizer(document.querySelector('#scene-controls')!, audio, edit, dock, beforeEdit, reduced, requestCues);
  function syncQuick(): void {
    const scene = scenes.getState().scene;
    const selected = scene === 'off' ? (input('#visuals').checked ? '' : 'off') : ['milkdrop', 'triggers'].includes(scene) ? scene : scene.startsWith('nature:') ? 'nature' : ['aurora', 'water'].includes(scene) ? 'calm' : ['spectrum', 'scope', 'orbits'].includes(scene) ? 'reactive' : '';
    quick.querySelectorAll<HTMLElement>('[data-visual-quick]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.visualQuick === selected)));
  }
  quick.addEventListener('click', event => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-visual-quick]')?.dataset.visualQuick;
    if (!choice) return;
    beforeEdit();
    input('#visuals').checked = false;
    const scene = ({ off: 'off', calm: 'aurora', reactive: 'spectrum', nature: 'nature:forest-slope', milkdrop: 'milkdrop', triggers: 'triggers' } as Record<string, string>)[choice];
    scenes.choose(scene); if (scene !== 'off') lastChoice = scene; refresh(); changed();
    dock.reveal();
    if (choice === 'milkdrop') input('#milkdrop-enable').focus({ preventScroll: true });
    if (choice === 'triggers') input('#trigger-enable').focus({ preventScroll: true });
  });

  function draw(timestamp = 0): void {
    if (timestamp && previous && timestamp - previous < 1000 / visualBudget(scenes.getState().quality).fps) { raf = requestAnimationFrame(draw); return; }
    const enabled = input('#visuals').checked;
    const mode = input('#visual-mode').value;
    const seconds = Number(input('#visual-speed').value);
    if (enabled && running && !document.hidden && !reduced.matches && previous) phase += (timestamp - previous) / (seconds * 1000);
    previous = timestamp;
    const hue = (color.hue + (enabled && mode === 'cycle' ? phase * 360 : 0)) % 360;
    const swell = enabled && mode === 'breathe' && !reduced.matches ? Math.sin(phase * Math.PI * 2) * 3 : 0;
    document.documentElement.style.setProperty('--light-hue', String(hue));
    document.documentElement.style.setProperty('--light-saturation', `${color.saturation}%`);
    const level = Math.max(0, Math.min(100, color.level + swell));
    document.documentElement.style.setProperty('--light-level', `${level}%`);
    document.documentElement.style.setProperty('--light-glow', `${Math.min(level, 100 - level) * .4}%`);
    document.body.classList.toggle('color-studio', enabled && input('#visual-theme').checked);
    document.body.classList.toggle('motion-on', enabled && mode !== 'still' && !reduced.matches);
    if (enabled && running && !document.hidden && mode !== 'still' && !reduced.matches) raf = requestAnimationFrame(draw);
  }
  function refresh(): void {
    cancelAnimationFrame(raf);
    previous = 0;
    draw();
    syncQuick(); dock.light(input('#visuals').checked);
    input('#visual-hue').value = String(color.hue);
    input('#visual-brightness').value = String(color.level);
    picker.update(color);
    input('#hue-value').textContent = `${Math.round(color.hue)}°`;
    input('#brightness-value').textContent = `${Math.round(color.level)}%`;
    input('#speed-value').textContent = `${input('#visual-speed').value} s`;
    input('#visual-status').textContent = !input('#visuals').checked
      ? 'Light is off. The preview shows your chosen color. No flashing or strobe effects.'
      : reduced.matches ? 'Reduced motion is active: light stays still.'
        : running ? 'Light is active. Color changes slowly; Escape closes immersive light.'
          : 'Color is ready. Movement follows playback and freezes when paused.';
  }
  document.querySelector('#visual-controls')!.addEventListener('input', event => {
    const control = event.target as HTMLInputElement;
    if (control.closest('#light-picker, #scene-controls')) return;
    scenes.cancelPending();
    if (control.id === 'visual-hue') { color.hue = Number(control.value); phase = 0; }
    if (control.id === 'visual-brightness') color.level = Number(control.value);
    refresh(); changed();
  });
  reduced.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  async function fullscreen(): Promise<void> {
    if (closing) return;
    if (scenes.getState().scene !== 'off') { scenes.fullscreen(); return; }
    if (stage.open) return;
    const enabled = input('#visuals').checked;
    input('#visuals').checked = true;
    stage.showModal();
    refresh(); if (!enabled) changed();
    await immersive.opened();
  }
  input('#light-fullscreen').addEventListener('click', () => {
    if (closing || stage.open) return;
    input('#visuals').checked = true; changed();
    stage.showModal(); refresh(); void immersive.opened();
  });
  async function closeStage(): Promise<void> {
    if (closing) return;
    closing = true;
    try { await immersive.exit(); }
    finally { stage.close(); closing = false; }
  }
  input('#close-light').addEventListener('click', () => { void closeStage(); });
  stage.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); void closeStage(); });
  refresh();
  return {
    createCapture(width: number, height: number, fps = 30): VisualCapture {
      const surface = captureSurface(width, height, fps);
      let scene: VisualCapture | undefined, disposed = false;
      const lease: VisualCapture = { canvas: surface.canvas,
        draw() {
          if (disposed) throw new Error('This video capture has been disposed.');
          if (scenes.getState().scene !== 'off') {
            scene ??= scenes.createCapture(width, height, fps);
            scene.draw(); surface.paint(scene.canvas); return;
          }
          scene?.dispose(); scene = undefined;
          if (!input('#visuals').checked) throw new Error('Choose a visual or enable ambient light before recording.');
          const style = getComputedStyle(document.documentElement), ctx = surface.context;
          const hue = Number(style.getPropertyValue('--light-hue')) || 0;
          const saturation = style.getPropertyValue('--light-saturation').trim() || '40%';
          const level = parseFloat(style.getPropertyValue('--light-level')) || 0;
          const glow = parseFloat(style.getPropertyValue('--light-glow')) || 0;
          ctx.save(); ctx.scale(width, height);
          const gradient = ctx.createRadialGradient(.35, .35, 0, .35, .35, Math.hypot(.65, .65));
          gradient.addColorStop(0, `hsl(${hue} ${saturation} ${Math.min(100, level + glow)}%)`);
          gradient.addColorStop(1, `hsl(${hue} ${saturation} ${level}%)`);
          ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1, 1); ctx.restore();
        },
        dispose() { if (disposed) return; disposed = true; scene?.dispose(); surface.canvas.width = surface.canvas.height = 1; },
      };
      try { lease.draw(); } catch (error) { lease.dispose(); throw error; }
      return lease;
    },
    getState(): VisualSettings { return { light: { enabled: input('#visuals').checked, color: { ...color }, mode: input('#visual-mode').value as VisualSettings['light']['mode'], speed: Number(input('#visual-speed').value), studio: input('#visual-theme').checked }, ...scenes.getState() }; },
    restore(value?: VisualSettings) {
      const state = value ? parseVisualSettings(value) : defaultVisualSettings();
      color = { ...state.light.color }; phase = 0;
      input('#visuals').checked = state.light.enabled; input('#visual-mode').value = state.light.mode;
      input('#visual-speed').value = String(state.light.speed); input('#visual-theme').checked = state.light.studio;
      scenes.restore(state); refresh();
    },
    fullscreen() { void fullscreen(); },
    applyTrigger(id: string) { input('#visuals').checked = false; scenes.applyTrigger(id); lastChoice = 'triggers'; refresh(); changed(); dock.reveal(); },
    asmrApproved: scenes.asmrApproved,
    applyAsmrTrigger(id: string, approved = false): Promise<boolean> { return scenes.applyAsmrTrigger(id, () => { input('#visuals').checked = false; lastChoice = 'triggers'; refresh(); changed(); dock.reveal(); }, approved); },
    toggle() { const scene = scenes.getState().scene; if (scene !== 'off') lastChoice = scene; const enabled = scene !== 'off' || input('#visuals').checked; input('#visuals').checked = false; scenes.choose(enabled ? 'off' : lastChoice); refresh(); changed(); },
    next(direction = 1) { scenes.next(direction); },
    toggleIndependent() { scenes.toggleIndependent(); },
    transport(value: boolean) { scenes.transport(value); if (running !== value) { running = value; refresh(); } },
    stop() { scenes.stop(); input('#visuals').checked = false; running = false; phase = 0; refresh(); if (stage.open) void closeStage(); },
  };
}
