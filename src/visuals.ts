import { type LightColor } from './visual-color';
import { setupColorPicker } from './color-picker';
import { setupVisualizer } from './visualizer';
import type { VisualFrame } from './audio/visual-analysis';

export function setupVisuals(audio: () => VisualFrame | undefined): { transport: (running: boolean) => void; stop: () => void } {
  document.querySelector('#visual-controls')!.innerHTML = `
    <label class="visual-toggle" for="visuals"><span><strong>Ambient light</strong><small>Color, movement and a full-screen space</small></span><input id="visuals" type="checkbox" role="switch" /></label>
    <div id="visual-preview" class="visual-preview" aria-label="Ambient color preview"></div>
    <div id="light-picker"></div>
    <label for="visual-mode">Light style</label><select id="visual-mode"><option value="still">Still color</option><option value="breathe">Slow breathing</option><option value="cycle">Slow hue journey</option></select>
    <label class="range-heading" for="visual-hue">Color hue <output id="hue-value">140°</output></label><input id="visual-hue" type="range" min="0" max="360" step="any" value="140" />
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
  const picker = setupColorPicker(document.querySelector('#light-picker')!, value => { color = value; phase = 0; refresh(); });
  const scenes = setupVisualizer(document.querySelector('#scene-controls')!, audio);

  function draw(timestamp = 0): void {
    const enabled = input('#visuals').checked;
    const mode = input('#visual-mode').value;
    const seconds = Number(input('#visual-speed').value);
    if (enabled && running && !reduced.matches && previous) phase += (timestamp - previous) / (seconds * 1000);
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
    if (enabled && running && mode !== 'still' && !reduced.matches) raf = requestAnimationFrame(draw);
  }
  function refresh(): void {
    cancelAnimationFrame(raf);
    previous = 0;
    draw();
    input('#visual-hue').value = String(color.hue);
    input('#visual-brightness').value = String(color.level);
    picker.update(color);
    input('#hue-value').textContent = `${Math.round(color.hue)}°`;
    input('#brightness-value').textContent = `${Math.round(color.level)}%`;
    input('#speed-value').textContent = `${input('#visual-speed').value} s`;
    input('#visual-status').textContent = !input('#visuals').checked
      ? 'Light is off. The preview shows your chosen color. No flashing or strobe effects.'
      : reduced.matches ? 'Reduced motion is active: light stays still.'
        : running ? 'Light is active. Color changes slowly; Escape stops audio and light.'
          : 'Color is ready. Movement follows playback and freezes when paused.';
  }
  document.querySelector('#visual-controls')!.addEventListener('input', event => {
    const control = event.target as HTMLInputElement;
    if (control.closest('#light-picker, #scene-controls')) return;
    if (control.id === 'visual-hue') { color.hue = Number(control.value); phase = 0; }
    if (control.id === 'visual-brightness') color.level = Number(control.value);
    refresh();
  });
  reduced.addEventListener('change', refresh);
  input('#light-fullscreen').addEventListener('click', async () => {
    input('#visuals').checked = true;
    stage.showModal();
    refresh();
    try { if (stage.requestFullscreen) await stage.requestFullscreen(); } catch { /* The dialog also works without browser fullscreen. */ }
  });
  async function closeStage(): Promise<void> {
    if (closing) return;
    closing = true;
    try { if (document.fullscreenElement === stage) await document.exitFullscreen(); }
    catch { /* Fullscreen can already have ended through Escape. */ }
    finally { stage.close(); closing = false; }
  }
  input('#close-light').addEventListener('click', () => { void closeStage(); });
  stage.addEventListener('cancel', event => { event.preventDefault(); void closeStage(); });
  refresh();
  return {
    transport(value) { scenes.transport(value); if (running !== value) { running = value; refresh(); } },
    stop() { scenes.stop(); input('#visuals').checked = false; running = false; phase = 0; refresh(); if (stage.open) void closeStage(); },
  };
}
