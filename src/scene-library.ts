import type { VisualFrame } from './audio/visual-analysis';
import { butterchurnPresets } from './butterchurn-presets';
import { moodscapes } from './moodscape-catalog';
import { Milkdrop } from './milkdrop';
import { Panorama } from './panorama';
import { type VisualSettings, type VisualQuality, visualBudget } from './visual-state';

export const libraryControls = `
  <div id="milkdrop-controls" hidden><label for="milkdrop-preset">MilkDrop preset</label><select id="milkdrop-preset">${butterchurnPresets.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}</select>
    <div id="milkdrop-consent"><p class="fine-print">MilkDrop patterns can include rapid motion or flashing. Leave disabled if you are sensitive to flashing light.</p>
    <label class="visual-toggle" for="milkdrop-enable"><span>Enable MilkDrop visuals</span><input id="milkdrop-enable" type="checkbox" /></label></div>
    <div class="scene-navigation"><button id="milkdrop-previous" class="secondary-button" aria-label="Previous preset">← Previous</button><button id="milkdrop-next" class="secondary-button">Next →</button><button id="milkdrop-shuffle" class="secondary-button">Shuffle</button><button id="milkdrop-favorite" class="secondary-button" aria-pressed="false">Favorite</button></div>
    <label class="visual-toggle" for="milkdrop-auto"><span>Automatically change presets</span><input id="milkdrop-auto" type="checkbox" /></label>
    <label for="milkdrop-interval">Change every (seconds)</label><input id="milkdrop-interval" type="number" min="10" max="300" value="30" />
    <label for="milkdrop-blend">Blend duration (seconds)</label><input id="milkdrop-blend" type="number" min="0" max="10" step="0.5" value="2" /></div>
  <div id="nature-controls" hidden><label class="range-heading" for="nature-direction">Look around <output id="nature-angle">0°</output></label><input id="nature-direction" type="range" min="0" max="360" value="0" /></div>
  <label for="visual-quality">Visual quality</label><select id="visual-quality"><option value="eco">Eco (30 FPS)</option><option value="balanced" selected>Balanced (45 FPS)</option><option value="high">High (60 FPS)</option></select>
  <p id="scene-credit" class="fine-print" hidden></p>
  <p class="fine-print"><a href="${import.meta.env.BASE_URL}credits.html" target="_blank" rel="noopener">Visual credits and licenses ↗</a></p>`;

export const libraryOptions = `<optgroup label="MilkDrop"><option value="milkdrop">Butterchurn</option></optgroup><optgroup label="Nature photography">${moodscapes.map(item => `<option value="nature:${item.id}">${item.name}</option>`).join('')}</optgroup>`;

export function setupSceneLibrary(host: HTMLElement, redraw: () => void, report: (message: string) => void, changed: () => void) {
  const viewport = host.querySelector<HTMLElement>('.scene-viewport')!;
  const milkCanvas = document.createElement('canvas'); milkCanvas.className = 'scene-milkdrop'; milkCanvas.hidden = true;
  milkCanvas.setAttribute('aria-label', 'MilkDrop music visualization');
  const natureCanvas = document.createElement('canvas'); natureCanvas.className = 'scene-panorama'; natureCanvas.hidden = true;
  natureCanvas.setAttribute('aria-label', 'Nature panorama');
  natureCanvas.tabIndex = 0;
  natureCanvas.setAttribute('aria-description', 'Drag to look around. Use Left and Right arrow keys to turn. Home resets the view.');
  const flat = new Image(); flat.className = 'scene-nature-flat'; flat.hidden = true;
  viewport.append(flat, natureCanvas, milkCanvas);
  const preset = host.querySelector<HTMLSelectElement>('#milkdrop-preset')!;
  const consent = host.querySelector<HTMLInputElement>('#milkdrop-enable')!;
  const consentBox = host.querySelector<HTMLElement>('#milkdrop-consent')!;
  const direction = host.querySelector<HTMLInputElement>('#nature-direction')!;
  const credit = host.querySelector<HTMLElement>('#scene-credit')!;
  const control = (id: string) => host.querySelector<HTMLInputElement>(id)!;
  const quality = () => control('#visual-quality').value as VisualQuality;
  const favorite = control('#milkdrop-favorite');
  let favorites: string[] = [];
  try { const saved: unknown = JSON.parse(localStorage.getItem('binaural:visual-favorites') || '[]'); if (Array.isArray(saved)) favorites = saved.filter(id => butterchurnPresets.some(item => item.id === id)); } catch { /* Local preferences are optional. */ }
  const updateFavorite = () => { favorite.setAttribute('aria-pressed', String(favorites.includes(preset.value))); favorite.textContent = favorites.includes(preset.value) ? '★ Favorite' : '☆ Favorite'; };
  updateFavorite();
  let panorama: Panorama | undefined;
  let selected = '', revision = 0, ready = false, useFlat = false, cycleElapsed = 0;
  const milk = new Milkdrop(milkCanvas, message => { if (selected.startsWith('milkdrop:')) report(message); });
  function attribution(name: string, author: string, source: string, license: string): void {
    const link = document.createElement('a'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${name} by ${author}`;
    credit.replaceChildren(link, document.createTextNode(` (${license}).`)); credit.hidden = false;
  }
  function select(mode: string): void {
    const nature = moodscapes.find(item => mode === `nature:${item.id}`);
    const enabled = mode === 'milkdrop' && consent.checked;
    const key = nature?.id ?? (enabled ? `milkdrop:${preset.value}` : mode === 'milkdrop' ? 'milkdrop-disabled' : '');
    host.querySelector<HTMLElement>('#milkdrop-controls')!.hidden = mode !== 'milkdrop';
    consentBox.hidden = mode !== 'milkdrop';
    host.querySelector<HTMLElement>('#nature-controls')!.hidden = !nature;
    milkCanvas.hidden = !enabled;
    natureCanvas.hidden = !nature || useFlat;
    flat.hidden = !nature || !useFlat;
    if (key === selected) return;
    selected = key; ready = false; milk.cancel(); const ticket = ++revision;
    credit.hidden = true;
    if (enabled) {
      const item = butterchurnPresets.find(item => item.id === preset.value)!;
      attribution(item.name, item.author, item.source, item.license);
      report('Loading MilkDrop…');
      void milk.load(item.id, Number(control('#milkdrop-blend').value)).then(ok => { if (ticket === revision) { ready = ok; redraw(); } });
    } else if (nature) {
      attribution(nature.name, nature.author, nature.source, 'CC0');
      flat.alt = `${nature.name}, photographed by ${nature.author}`; flat.src = nature.url;
      natureCanvas.setAttribute('aria-label', flat.alt);
      report(`Loading ${nature.name}…`);
      void (async () => {
        let nextFlat = false;
        try {
          panorama ??= new Panorama(natureCanvas, () => {
            useFlat = true;
            if (moodscapes.some(item => item.id === selected)) { report('Panorama graphics were interrupted. Showing the photo instead.'); redraw(); }
          });
          await panorama.load(nature.url);
        } catch { nextFlat = true; try { await flat.decode(); } catch { if (ticket === revision) report('The nature photo could not load. Try another scene.'); return; } }
        if (ticket !== revision) return;
        useFlat = nextFlat; ready = true; report(nextFlat ? `${nature.name}. Showing the photo in flat view.` : `${nature.name}. Use Look around to explore.`); redraw();
      })();
    } else if (mode === 'milkdrop') report('Enable MilkDrop visuals to display this preset.');
    else if (mode !== 'local') report('Motion follows playback. Your files stay on this device.');
  }
  function next(direction = 1, shuffle = false, notify = true): void {
    const items = butterchurnPresets;
    const current = items.findIndex(item => item.id === preset.value);
    const offset = shuffle ? 1 + Math.floor(Math.random() * (items.length - 1)) : direction;
    preset.value = items[(current + offset + items.length) % items.length].id;
    cycleElapsed = 0; updateFavorite(); redraw(); if (notify) changed();
  }
  preset.addEventListener('change', () => { cycleElapsed = 0; updateFavorite(); redraw(); });
  consent.addEventListener('change', () => { selected = ''; redraw(); });
  direction.addEventListener('input', () => { host.querySelector('#nature-angle')!.textContent = `${direction.value}°`; redraw(); });
  control('#milkdrop-previous').addEventListener('click', () => next(-1));
  control('#milkdrop-next').addEventListener('click', () => next());
  control('#milkdrop-shuffle').addEventListener('click', () => next(1, true));
  favorite.addEventListener('click', () => {
    favorites = favorites.includes(preset.value) ? favorites.filter(id => id !== preset.value) : [...favorites, preset.value];
    try { localStorage.setItem('binaural:visual-favorites', JSON.stringify(favorites)); } catch { /* Local preferences are optional. */ }
    updateFavorite();
  });
  const move = (degrees: number) => { direction.value = String(((degrees % 360) + 360) % 360); host.querySelector('#nature-angle')!.textContent = `${direction.value}°`; redraw(); };
  let pointer: { id: number; x: number; angle: number } | undefined;
  natureCanvas.addEventListener('pointerdown', event => { pointer = { id: event.pointerId, x: event.clientX, angle: Number(direction.value) }; natureCanvas.setPointerCapture(event.pointerId); });
  natureCanvas.addEventListener('pointermove', event => { if (pointer?.id === event.pointerId) move(pointer.angle + (pointer.x - event.clientX) * .25); });
  natureCanvas.addEventListener('pointerup', event => { if (pointer?.id === event.pointerId) { pointer = undefined; changed(); } });
  natureCanvas.addEventListener('pointercancel', () => { pointer = undefined; });
  natureCanvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); move(event.key === 'Home' ? 0 : Number(direction.value) + (event.key === 'ArrowLeft' ? -5 : 5)); changed();
  });
  return {
    select,
    next,
    quality,
    getState() { return { milkdropPreset: preset.value, natureDirection: Number(direction.value), quality: quality(), autoCycle: control('#milkdrop-auto').checked,
      cycleSeconds: Number(control('#milkdrop-interval').value), blendSeconds: Number(control('#milkdrop-blend').value) }; },
    restore(state: VisualSettings) {
      consent.checked = false; cycleElapsed = 0; preset.value = state.milkdropPreset; direction.value = String(state.natureDirection);
      host.querySelector('#nature-angle')!.textContent = `${direction.value}°`; control('#visual-quality').value = state.quality;
      control('#milkdrop-auto').checked = state.autoCycle; control('#milkdrop-interval').value = String(state.cycleSeconds); control('#milkdrop-blend').value = String(state.blendSeconds); updateFavorite();
    },
    canvas() { return selected.startsWith('milkdrop:') ? milkCanvas : natureCanvas; },
    captureReady() { return ready && (!selected.startsWith('milkdrop') || consent.checked); },
    flat() { return ready && useFlat && moodscapes.some(item => item.id === selected) ? flat : undefined; },
    render(mode: string, frame: VisualFrame | undefined, seconds: number, elapsed: number) {
      if (!ready) return;
      if (mode === 'milkdrop' && consent.checked) {
        milk.render(frame, seconds, quality());
        cycleElapsed += seconds;
        if (control('#milkdrop-auto').checked && cycleElapsed >= Number(control('#milkdrop-interval').value)) { queueMicrotask(() => next(1, false, false)); cycleElapsed = 0; }
      }
      if (mode.startsWith('nature:') && !useFlat) panorama?.render(Number(direction.value) * Math.PI / 180 + (visualBudget(quality()).fps > 30 ? elapsed * 0.012 : 0), quality());
    },
  };
}
