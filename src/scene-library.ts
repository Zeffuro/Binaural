import type { VisualFrame } from './audio/visual-analysis';
import { butterchurnPresets } from './butterchurn-presets';
import { moodscapes } from './moodscape-catalog';
import { Milkdrop } from './milkdrop';
import { Panorama } from './panorama';

export const libraryControls = `
  <div id="milkdrop-controls" hidden><label for="milkdrop-preset">MilkDrop preset</label><select id="milkdrop-preset">${butterchurnPresets.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}</select>
    <p class="fine-print">MilkDrop patterns can include rapid motion or flashing. Leave disabled if you are sensitive to flashing light.</p>
    <label class="visual-toggle" for="milkdrop-enable"><span>Enable MilkDrop visuals</span><input id="milkdrop-enable" type="checkbox" /></label></div>
  <div id="nature-controls" hidden><label class="range-heading" for="nature-direction">Look around <output id="nature-angle">0°</output></label><input id="nature-direction" type="range" min="0" max="360" value="0" /></div>
  <p id="scene-credit" class="fine-print" hidden></p>
  <p class="fine-print"><a href="${import.meta.env.BASE_URL}credits.html" target="_blank" rel="noopener">Visual credits and licenses ↗</a></p>`;

export const libraryOptions = `<optgroup label="MilkDrop"><option value="milkdrop">Butterchurn</option></optgroup><optgroup label="Nature photography">${moodscapes.map(item => `<option value="nature:${item.id}">${item.name}</option>`).join('')}</optgroup>`;

export function setupSceneLibrary(host: HTMLElement, redraw: () => void, report: (message: string) => void) {
  const viewport = host.querySelector<HTMLElement>('.scene-viewport')!;
  const milkCanvas = document.createElement('canvas'); milkCanvas.className = 'scene-milkdrop'; milkCanvas.hidden = true;
  milkCanvas.setAttribute('aria-label', 'MilkDrop music visualization');
  const natureCanvas = document.createElement('canvas'); natureCanvas.className = 'scene-panorama'; natureCanvas.hidden = true;
  natureCanvas.setAttribute('aria-label', 'Nature panorama');
  const flat = new Image(); flat.className = 'scene-nature-flat'; flat.hidden = true;
  viewport.append(flat, natureCanvas, milkCanvas);
  const preset = host.querySelector<HTMLSelectElement>('#milkdrop-preset')!;
  const consent = host.querySelector<HTMLInputElement>('#milkdrop-enable')!;
  const direction = host.querySelector<HTMLInputElement>('#nature-direction')!;
  const credit = host.querySelector<HTMLElement>('#scene-credit')!;
  let panorama: Panorama | undefined;
  let selected = '', revision = 0, ready = false, useFlat = false;
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
      void milk.load(item.id).then(ok => { if (ticket === revision) { ready = ok; redraw(); } });
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
  preset.addEventListener('change', () => { selected = ''; redraw(); });
  consent.addEventListener('change', () => { selected = ''; redraw(); });
  direction.addEventListener('input', () => { host.querySelector('#nature-angle')!.textContent = `${direction.value}°`; redraw(); });
  return {
    select,
    render(mode: string, frame: VisualFrame | undefined, seconds: number, elapsed: number) {
      if (!ready) return;
      if (mode === 'milkdrop' && consent.checked) milk.render(frame, seconds);
      if (mode.startsWith('nature:') && !useFlat) panorama?.render(Number(direction.value) * Math.PI / 180 + elapsed * 0.012);
    },
  };
}
