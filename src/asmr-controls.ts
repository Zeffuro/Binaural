import { asmrMotions, asmrRanges, generatedAsmrSounds, recordedAsmrSounds, defaultAsmr, makeAsmrLayer, MAX_ASMR_LAYERS, type AsmrLayer, type AsmrSettings } from './asmr-state';
import { asmrPresets } from './asmr-presets';
import './asmr-controls.css';

export function setupAsmr(options: {
  get: () => AsmrSettings | undefined;
  update: (value: AsmrSettings, light?: string) => void;
  beforeEdit: () => void;
  isolate: () => void;
  busy: () => boolean;
  importedMute: () => boolean | undefined;
  muteImported: (value: boolean) => void;
}) {
  const host = document.querySelector<HTMLElement>('#asmr-controls')!;
  host.innerHTML = `<div class="section-heading"><div><span class="eyebrow">UP CLOSE</span><h2>ASMR mixer <span id="asmr-count" class="count">0 / 6</span></h2></div><button id="asmr-add" class="text-button">＋ Add sound</button></div>
    <p class="small-muted">Layer little sounds and let them travel between your ears. Stereo headphones work best.</p>
    <div class="asmr-featured" role="group" aria-label="Ear focus presets">${['ear-cupping', 'left-ear-focus', 'right-ear-focus', 'hands-close'].map(id => `<button class="secondary-button" data-asmr-preset="${id}">${asmrPresets.find(preset => preset.id === id)!.name}</button>`).join('')}</div>
    <div class="asmr-recipes"><label for="asmr-preset">Start with a mix</label><select id="asmr-preset">${['Ear focus', 'Recorded textures', 'Layered mixes'].map(group => `<optgroup label="${group}">${asmrPresets.filter(preset => ('group' in preset ? preset.group : 'Layered mixes') === group).map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}</optgroup>`).join('')}</select><p id="asmr-description" class="fine-print"></p>
      <div class="asmr-actions"><button id="asmr-load" class="secondary-button">Load sounds</button><button id="asmr-pair" class="secondary-button">Load sounds + lights</button></div></div>
    <label class="range-heading" for="asmr-level">ASMR volume <output id="asmr-volume" aria-hidden="true"></output></label><input id="asmr-level" aria-label="ASMR volume" type="range" min="0" max="1" step=".01" />
    <div id="asmr-layers"></div><p id="asmr-empty" class="fine-print">Choose a mix or add a sound. Nothing plays until you start listening.</p>
    <div class="asmr-actions"><button id="asmr-only" class="text-button">ASMR mode</button><button id="asmr-clear" class="text-button">Clear sounds</button></div>
    <label id="asmr-imported-row" class="visual-toggle" hidden><span>Mute imported BWGen audio</span><input id="asmr-imported-mute" type="checkbox" /></label>
    <p class="fine-print">Use Mixed mode to include tone layers. Atmosphere and music remain available in every mode. Ear cupping changes warmth and level to suggest a close, muffled sound.</p>
    <p class="fine-print">Original textures and CC0 recordings. <a href="./credits.html#asmr" target="_blank" rel="noopener">Sound credits and sources</a></p>
    <p id="asmr-status" class="fine-print" role="status"></p>`;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const settings = () => options.get() ?? defaultAsmr();
  const ranges = (layer: AsmrLayer, index: number, fields: (keyof typeof asmrRanges)[]) => fields.map(field => {
    const labels = { level: 'Volume', pan: 'Left / right', width: 'Travel width', period: 'Movement / cupping cycle', rate: 'Sound pace', tone: 'Tone', pressure: 'Ear cupping', pressurePhase: 'Cupping phase' };
    const [min, max] = asmrRanges[field]; const id = `asmr-${index}-${field}`;
    return `<label class="range-heading" for="${id}">${labels[field]}<output data-output="${field}" aria-hidden="true">${format(field, layer[field])}</output></label><input id="${id}" aria-label="Sound ${index + 1} ${labels[field].toLowerCase()}" data-field="${field}" type="range" min="${min}" max="${max}" step="${field === 'period' || field === 'pressurePhase' ? 1 : .01}" value="${layer[field]}" />`;
  }).join('');
  function format(field: string, value: number): string {
    if (field === 'period') return `${Math.round(value)} s`;
    if (field === 'pressurePhase') return `${Math.round(value)}°`;
    if (field === 'rate') return `${value.toFixed(2)}×`;
    if (field === 'pan') return value === 0 ? 'Center' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'left' : 'right'}`;
    return `${Math.round(value * 100)}%`;
  }
  function transport(): void { host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(input => { input.disabled = options.busy(); }); $('#asmr-add').toggleAttribute('disabled', options.busy() || settings().layers.length >= MAX_ASMR_LAYERS); }
  function render(): void {
    const state = settings();
    $<HTMLInputElement>('#asmr-level').value = String(state.level); $('#asmr-volume').textContent = format('level', state.level);
    $('#asmr-imported-row').hidden = options.importedMute() === undefined;
    $<HTMLInputElement>('#asmr-imported-mute').checked = !!options.importedMute();
    $('#asmr-count').textContent = `${state.layers.length} / ${MAX_ASMR_LAYERS}`; $('#asmr-empty').hidden = state.layers.length > 0;
    $('#asmr-layers').innerHTML = state.layers.map((layer, i) => `<article class="asmr-layer" data-asmr="${layer.id}" aria-label="ASMR sound ${i + 1}">
      <div class="asmr-layer-top"><label for="asmr-sound-${i}">Sound ${i + 1}</label><select id="asmr-sound-${i}" aria-label="Sound ${i + 1} trigger" data-field="sound">${[recordedAsmrSounds, generatedAsmrSounds].map((sounds, index) => `<optgroup label="${index ? 'Textures' : 'Recordings'}">${sounds.map(sound => `<option value="${sound.id}" ${sound.id === layer.sound ? 'selected' : ''}>${sound.name}</option>`).join('')}</optgroup>`).join('')}</select>
        <button class="text-button" data-action="remove" aria-label="Remove sound ${i + 1}">×</button></div>
      <div class="asmr-flags"><button class="secondary-button" data-action="muted" aria-label="Mute sound ${i + 1}" aria-pressed="${layer.muted}">Mute</button><button class="secondary-button" data-action="solo" aria-label="Solo sound ${i + 1}" aria-pressed="${layer.solo}">Solo</button><button class="text-button" data-action="duplicate" aria-label="Duplicate sound ${i + 1}">Duplicate</button></div>
      ${ranges(layer, i, ['level', 'pan', 'pressure'])}<label for="asmr-motion-${i}">Movement</label><select id="asmr-motion-${i}" aria-label="Sound ${i + 1} movement" data-field="motion">${asmrMotions.map(motion => `<option value="${motion}" ${motion === layer.motion ? 'selected' : ''}>${({ still: 'Stay in place', sweep: 'Left / right sweep', wander: 'Slow wander' })[motion]}</option>`).join('')}</select>
      <details class="asmr-advanced"><summary>Advanced sound controls</summary>${ranges(layer, i, ['width', 'period', 'rate', 'tone', 'pressurePhase'])}</details></article>`).join('');
    host.querySelectorAll<HTMLInputElement>('input[data-field]').forEach(input => input.setAttribute('aria-valuetext', format(input.dataset.field!, Number(input.value))));
    transport();
  }
  function edit(change: (value: AsmrSettings) => void, light?: string): void {
    if (options.busy()) return;
    const next = structuredClone(settings()); change(next); options.update(next, light);
  }
  host.addEventListener('focusin', event => { if ((event.target as HTMLElement).matches('input,select')) options.beforeEdit(); });
  host.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (!input.checkValidity() || options.busy()) return;
    if (input.id === 'asmr-imported-mute') { options.muteImported(input.checked); return; }
    if (input.id === 'asmr-level') { edit(value => { value.level = Number(input.value); }); $('#asmr-volume').textContent = format('level', Number(input.value)); return; }
    const id = input.closest<HTMLElement>('[data-asmr]')?.dataset.asmr;
    if (!id || !input.dataset.field) return;
    edit(value => {
      const layer = value.layers.find(layer => layer.id === id)!;
      const field = input.dataset.field!;
      if (field === 'sound') layer.sound = input.value as AsmrLayer['sound'];
      else if (field === 'motion') layer.motion = input.value as AsmrLayer['motion'];
      else layer[field as keyof typeof asmrRanges] = Number(input.value);
    });
    const output = input.parentElement!.querySelector(`[data-output="${input.dataset.field}"]`);
    if (output) output.textContent = format(input.dataset.field, Number(input.value));
    if (input.type === 'range') input.setAttribute('aria-valuetext', format(input.dataset.field, Number(input.value)));
  });
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || options.busy()) return;
    options.beforeEdit();
    if (button.dataset.asmrPreset) {
      $<HTMLSelectElement>('#asmr-preset').value = button.dataset.asmrPreset;
      const preset = asmrPresets.find(preset => preset.id === button.dataset.asmrPreset)!;
      $('#asmr-description').textContent = preset.description; options.update(preset.make()); render();
      $('#asmr-status').textContent = `${preset.name} loaded. Start listening when ready.`;
    } else if (button.id === 'asmr-load' || button.id === 'asmr-pair') {
      const preset = asmrPresets.find(preset => preset.id === $<HTMLSelectElement>('#asmr-preset').value)!;
      options.update(preset.make(), button.id === 'asmr-pair' ? preset.light : undefined); render();
      $('#asmr-status').textContent = button.id === 'asmr-pair' ? `${preset.name} loaded. Enable light triggers in the preview, then start listening.` : `${preset.name} loaded. Start listening when ready.`;
    } else if (button.id === 'asmr-add') { edit(value => { if (value.layers.length < MAX_ASMR_LAYERS) value.layers.push(makeAsmrLayer()); }); render(); }
    else if (button.id === 'asmr-clear') { edit(value => { value.layers = []; }); render(); }
    else if (button.id === 'asmr-only') { options.isolate(); $('#asmr-status').textContent = 'ASMR mode selected. Your tone settings are kept. Atmosphere and music remain available.'; }
    else if (button.dataset.action) {
      const id = button.closest<HTMLElement>('[data-asmr]')!.dataset.asmr;
      edit(value => {
        const index = value.layers.findIndex(layer => layer.id === id), layer = value.layers[index];
        const action = button.dataset.action;
        if (action === 'remove') value.layers.splice(index, 1);
        else if (action === 'duplicate' && value.layers.length < MAX_ASMR_LAYERS) value.layers.splice(index + 1, 0, { ...layer, id: crypto.randomUUID() });
        else if (action === 'muted' || action === 'solo') layer[action] = !layer[action];
      });
      if (['muted', 'solo'].includes(button.dataset.action)) {
        const layer = settings().layers.find(layer => layer.id === id)!;
        button.setAttribute('aria-pressed', String(layer[button.dataset.action as 'muted' | 'solo']));
      } else render();
    }
  });
  $<HTMLSelectElement>('#asmr-preset').addEventListener('change', () => { $('#asmr-description').textContent = asmrPresets.find(preset => preset.id === $<HTMLSelectElement>('#asmr-preset').value)!.description; });
  $('#asmr-description').textContent = asmrPresets[0].description;
  $<HTMLSelectElement>('#asmr-preset').value = asmrPresets[0].id;
  render(); return { refresh: render, transport };
}
