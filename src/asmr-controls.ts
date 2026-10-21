import { asmrMotions, asmrRanges, generatedAsmrSounds, recordedAsmrSounds, defaultAsmr, makeAsmrLayer, MAX_ASMR_LAYERS, type AsmrLayer, type AsmrSettings, type AsmrSound } from './asmr-state';
import { asmrPresets } from './asmr-presets';
import { ASMR_FAVORITES_KEY, createAsmrLibrary, filterAsmrLibrary, parseAsmrFavorites, saveAsmrFavorites } from './asmr-library';
import { asmrSpatialRanges, defaultSpatial } from './asmr-spatial';
import './asmr-controls.css';

export function setupAsmr(options: {
  get: () => AsmrSettings | undefined;
  update: (value: AsmrSettings, light?: string) => void;
  beforeEdit: () => void;
  isolate: () => void;
  busy: () => boolean;
  importedMute: () => boolean | undefined;
  muteImported: (value: boolean) => void;
  enabled?: () => boolean;
  enable?: () => void;
}) {
  const host = document.querySelector<HTMLElement>('#asmr-controls')!;
  const presetGroup = (preset: typeof asmrPresets[number]) => 'group' in preset ? preset.group : 'Layered mixes';
  const presetGroups = [...new Set(['Ear focus', ...asmrPresets.map(presetGroup)])];
  const quickSounds: [AsmrSound, string][] = [['brush', 'Brush'], ['fingertip-taps', 'Tapping'], ['fabric', 'Fabric'], ['recorded-crinkles', 'Crinkle'], ['air', 'Air'], ['water', 'Water']];
  const starters = [['hands-close', 'Hands up close'], ['slow-ear-sweep', 'Hands moving slowly'], ['woven-hush', 'Soft fabric'], ['soft-crinkle-room', 'Delicate crinkles'], ['fingertip-duet', 'Fingertip tapping'], ['ear-cupping', 'Warm ear cups']];
  host.innerHTML = `<div class="section-heading"><div><span class="eyebrow">UP CLOSE</span><h2>ASMR mixer <span id="asmr-count" class="count">0 / 6</span></h2></div><button id="asmr-add" class="text-button">＋ Add sound</button></div>
    <p class="small-muted">Choose a sound for close listening. Stereo headphones work best.</p>
    <label class="visual-toggle"><span>ASMR focus</span><input id="asmr-focus" type="checkbox" aria-describedby="asmr-focus-help" /></label>
    <p id="asmr-focus-help" class="fine-print">Lower atmosphere and music by 10 dB while ASMR sounds are active. Your volume settings are kept.</p>
    <div class="asmr-quick" role="group" aria-label="Quick ASMR sounds">${quickSounds.map(([sound, label]) => `<button class="secondary-button" data-asmr-sound="${sound}">${label}</button>`).join('')}</div>
    <p class="asmr-starter-label">Or start with an experience</p>
    <div class="asmr-featured" role="group" aria-label="Starter experiences">${starters.map(([id, label]) => `<button class="secondary-button" data-asmr-preset="${id}">${label}</button>`).join('')}</div>
    <details id="asmr-more-experiences" class="asmr-library"><summary>More experiences</summary>
    <div class="asmr-recipes"><label for="asmr-preset">Choose an experience</label><select id="asmr-preset">${presetGroups.map(group => `<optgroup label="${group}">${asmrPresets.filter(preset => presetGroup(preset) === group).map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}</optgroup>`).join('')}</select><p id="asmr-description" class="fine-print"></p>
      <div class="asmr-actions"><button id="asmr-load" class="secondary-button">Load sounds</button><button id="asmr-pair" class="secondary-button">Load sounds + lights</button></div></div>
      <label for="asmr-search">Find a mix</label><input id="asmr-search" type="search" placeholder="Try left ear, cloth or tapping" />
      <label for="asmr-filter">Show mixes</label><select id="asmr-filter"><option value="all">All mixes</option><option value="favorites">Favorites</option>${presetGroups.map(group => `<option>${group}</option>`).join('')}</select>
      <p class="fine-print">Search names, descriptions and sounds. Favorites stay in this browser. Loading a mix does not start playback.</p>
      <p id="asmr-results" class="fine-print" role="status"></p><div id="asmr-library-list"></div></details>
    <details id="asmr-mixer" class="asmr-mixer"><summary>Current sounds <span id="asmr-enabled-status"></span></summary>
    <label class="range-heading" for="asmr-level">ASMR volume <output id="asmr-volume" aria-hidden="true"></output></label><input id="asmr-level" aria-label="ASMR volume" type="range" min="0" max="1" step=".01" />
    <div id="asmr-layers"></div><p id="asmr-empty" class="fine-print">Choose a mix or add a sound. Nothing plays until you start listening.</p>
    <div class="asmr-actions"><button id="asmr-only" class="text-button">Listen to ASMR only</button><button id="asmr-clear" class="text-button">Clear sounds</button></div>
    <label id="asmr-imported-row" class="visual-toggle" hidden><span>Mute imported BWGen audio</span><input id="asmr-imported-mute" type="checkbox" /></label>
    <p class="fine-print">Ear cupping changes warmth and level to suggest a close, muffled sound.</p></details>
    <p class="fine-print">Original textures and CC0 recordings. <a href="./credits.html#asmr" target="_blank" rel="noopener">Sound credits and sources</a></p>
    <p id="asmr-status" class="fine-print" role="status"></p>`;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const settings = () => options.get() ?? defaultAsmr();
  const enabled = () => options.enabled?.() ?? true;
  let wasEnabled: boolean | undefined;
  const library = createAsmrLibrary(asmrPresets, [...generatedAsmrSounds, ...recordedAsmrSounds]);
  let favorites = new Set<string>();
  try { favorites = parseAsmrFavorites(localStorage.getItem(ASMR_FAVORITES_KEY), library); } catch { /* Storage may be unavailable. */ }
  function renderLibrary(): void {
    const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedId = focused?.closest<HTMLElement>('[data-asmrlibrary]')?.dataset.asmrlibrary;
    const focusedAction = focused?.dataset.libraryAction;
    const matches = filterAsmrLibrary(library, $<HTMLInputElement>('#asmr-search').value, $<HTMLSelectElement>('#asmr-filter').value, favorites);
    $('#asmr-results').textContent = matches.length ? `${matches.length} of ${library.length} mixes` : 'No mixes found. Try another search or choose All mixes.';
    $('#asmr-library-list').replaceChildren(...matches.map(entry => {
      const card = document.createElement('article'); card.className = 'asmr-library-card'; card.dataset.asmrlibrary = entry.id;
      card.innerHTML = '<h3></h3><p class="fine-print"></p><p class="small-muted"></p><div class="asmr-actions"><button class="secondary-button" data-library-action="load">Load sounds</button><button class="secondary-button" data-library-action="pair">Load sounds + lights</button><button class="text-button" data-library-action="favorite">☆ Favorite</button></div>';
      card.querySelector('h3')!.textContent = entry.name;
      card.querySelector('.fine-print')!.textContent = entry.description;
      card.querySelector('.small-muted')!.textContent = `${entry.group}: ${entry.sounds.join(' + ')}`;
      card.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        button.disabled = options.busy();
        button.setAttribute('aria-label', `${button.textContent!.replace('☆ ', '')}: ${entry.name}`);
      });
      const favorite = card.querySelector<HTMLButtonElement>('[data-library-action="favorite"]')!;
      favorite.setAttribute('aria-pressed', String(favorites.has(entry.id)));
      favorite.textContent = favorites.has(entry.id) ? '★ Favorite' : '☆ Favorite';
      return card;
    }));
    if (focusedId && focusedAction) {
      const replacement = host.querySelector<HTMLButtonElement>(`[data-asmrlibrary="${focusedId}"] [data-library-action="${focusedAction}"]`);
      (replacement ?? $('#asmr-filter')).focus({ preventScroll: true });
    }
  }
  function loadPreset(id: string, pair = false): void {
    const preset = asmrPresets.find(preset => preset.id === id);
    if (!preset) return;
    options.beforeEdit();
    options.enable?.();
    $<HTMLSelectElement>('#asmr-preset').value = id;
    $('#asmr-description').textContent = preset.description;
    options.update({ ...preset.make(), focus: settings().focus ?? false }, pair ? preset.light : undefined); render();
    $('#asmr-status').textContent = `${preset.name} loaded. Start listening when ready.`;
  }
  const ranges = (layer: AsmrLayer, index: number, fields: (keyof typeof asmrRanges)[]) => fields.map(field => {
    const labels = { level: 'Volume', pan: 'Left / right', width: 'Travel width', period: 'Movement / cupping cycle', rate: 'Sound pace', tone: 'Tone', pressure: 'Ear cupping', pressurePhase: 'Alternate sides (advanced)' };
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
  function formatPosition(field: string, value: number): string {
    if (field === 'distance') return `${value.toFixed(2)} m`;
    if (field === 'elevation') return value === 0 ? 'Ear level' : `${Math.abs(value)}° ${value > 0 ? 'above' : 'below'}`;
    return value === 0 ? 'Ahead' : Math.abs(value) === 180 ? 'Behind' : `${Math.abs(value)}° ${value < 0 ? 'left' : 'right'}`;
  }
  const positionRanges = (layer: AsmrLayer, index: number, fields: (keyof typeof asmrSpatialRanges)[]) => fields.map(field => {
    const [min, max] = asmrSpatialRanges[field], value = layer.spatial![field], id = `asmr-position-${index}-${field}`;
    const label = { azimuth: 'Direction', elevation: 'Height', distance: 'Distance' }[field];
    return `<label class="range-heading" for="${id}">${label}<output data-position-output="${field}" aria-hidden="true">${formatPosition(field, value)}</output></label><input id="${id}" aria-label="Sound ${index + 1} ${label.toLowerCase()}" data-position="${field}" type="range" min="${min}" max="${max}" step="${field === 'distance' ? '.05' : '1'}" value="${value}" aria-valuetext="${formatPosition(field, value)}" />`;
  }).join('');
  function transport(): void {
    const full = settings().layers.length >= MAX_ASMR_LAYERS;
    host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(input => { input.disabled = options.busy(); });
    $('#asmr-add').toggleAttribute('disabled', options.busy() || full);
    host.querySelectorAll<HTMLButtonElement>('[data-action=duplicate]').forEach(button => { button.disabled = options.busy() || full; });
    host.querySelectorAll<HTMLButtonElement>('[data-asmr-sound]').forEach(button => {
      button.disabled = options.busy() || (full && !settings().layers.some(layer => layer.sound === button.dataset.asmrSound));
    });
  }
  function placement(layer: AsmrLayer, action: string): void {
    if (action === 'cupping') { layer.pressure = layer.pressure > 0 ? 0 : .8; return; }
    if (action === 'slow') {
      if (layer.spatial) layer.spatial.motion = 'orbit';
      else { layer.pan = 0; layer.motion = 'sweep'; if (!layer.width) layer.width = .85; }
      layer.period = Math.max(18, layer.period); return;
    }
    const pan = { left: -1, center: 0, right: 1 }[action];
    if (pan === undefined) return;
    if (layer.spatial) { layer.spatial.azimuth = pan * 90; layer.spatial.motion = 'still'; }
    else { layer.pan = pan; layer.motion = 'still'; }
  }
  function placementSelected(layer: AsmrLayer, action: string): boolean {
    if (action === 'cupping') return layer.pressure > 0;
    if (action === 'slow') return (layer.spatial ? layer.spatial.motion === 'orbit' : layer.motion !== 'still') && layer.period >= 18;
    const pan = { left: -1, center: 0, right: 1 }[action];
    return layer.spatial ? layer.spatial.motion === 'still' && layer.spatial.azimuth === pan! * 90 : layer.motion === 'still' && layer.pan === pan;
  }
  function focusLayer(id: string): void {
    $<HTMLDetailsElement>('#asmr-mixer').open = true;
    host.querySelector<HTMLElement>(`[data-asmr="${id}"] select[data-field=sound]`)?.focus({ preventScroll: true });
  }
  function refreshPlacement(id: string): void {
    const layer = settings().layers.find(layer => layer.id === id)!;
    host.querySelectorAll<HTMLButtonElement>(`[data-asmr="${id}"] [data-placement]`).forEach(button => {
      button.setAttribute('aria-pressed', String(placementSelected(layer, button.dataset.placement!)));
    });
  }
  function render(): void {
    const state = settings();
    const active = enabled(), mixer = $<HTMLDetailsElement>('#asmr-mixer');
    if (wasEnabled !== active) mixer.open = active;
    wasEnabled = active;
    $('#asmr-enabled-status').textContent = active ? 'On' : 'Off';
    const expanded = new Set([...host.querySelectorAll<HTMLDetailsElement>('.asmr-advanced[open]')].map(details => details.closest<HTMLElement>('[data-asmr]')!.dataset.asmr));
    const focused = document.activeElement as HTMLElement | null;
    const focusedLayer = focused?.closest<HTMLElement>('[data-asmr]')?.dataset.asmr;
    const focusedField = focused?.dataset.field, focusedPosition = focused?.dataset.position, focusedPlacement = focused?.dataset.placement;
    $<HTMLInputElement>('#asmr-level').value = String(state.level); $('#asmr-volume').textContent = format('level', state.level);
    $<HTMLInputElement>('#asmr-focus').checked = !!state.focus;
    $('#asmr-imported-row').hidden = options.importedMute() === undefined;
    $<HTMLInputElement>('#asmr-imported-mute').checked = !!options.importedMute();
    $('#asmr-count').textContent = `${state.layers.length} / ${MAX_ASMR_LAYERS}`; $('#asmr-empty').hidden = state.layers.length > 0;
    $('#asmr-layers').innerHTML = state.layers.map((layer, i) => `<article class="asmr-layer" data-asmr="${layer.id}" aria-label="ASMR sound ${i + 1}">
      <div class="asmr-layer-top"><label for="asmr-sound-${i}">Sound ${i + 1}</label><select id="asmr-sound-${i}" aria-label="Sound ${i + 1} trigger" data-field="sound">${[recordedAsmrSounds, generatedAsmrSounds].map((sounds, index) => `<optgroup label="${index ? 'Textures' : 'Recordings'}">${sounds.map(sound => `<option value="${sound.id}" ${sound.id === layer.sound ? 'selected' : ''}>${sound.name}</option>`).join('')}</optgroup>`).join('')}</select>
        <button class="text-button" data-action="remove" aria-label="Remove sound ${i + 1}">×</button></div>
      ${ranges(layer, i, ['level'])}
      <div class="asmr-flags"><button class="secondary-button" data-action="muted" aria-label="Mute sound ${i + 1}" aria-pressed="${layer.muted}">Mute</button></div>
      <div class="asmr-placement" role="group" aria-label="Sound ${i + 1} placement">${[['left', 'Left ear'], ['center', 'Center'], ['right', 'Right ear'], ['slow', 'Move slowly'], ['cupping', 'Cupping']].map(([action, label]) => `<button class="secondary-button" data-placement="${action}" aria-pressed="${placementSelected(layer, action)}">${label}</button>`).join('')}</div>
      <details class="asmr-advanced" ${expanded.has(layer.id) ? 'open' : ''}><summary>Adjust</summary>
      <div class="asmr-flags"><button class="secondary-button" data-action="solo" aria-label="Solo sound ${i + 1}" aria-pressed="${layer.solo}">Solo</button><button class="text-button" data-action="duplicate" aria-label="Duplicate sound ${i + 1}">Duplicate</button></div>
      <label for="asmr-space-${i}">Sound space</label><select id="asmr-space-${i}" aria-label="Sound ${i + 1} sound space" data-field="space"><option value="stereo" ${!layer.spatial ? 'selected' : ''}>Stereo</option><option value="hrtf" ${layer.spatial ? 'selected' : ''}>3D headphones</option></select>
      ${layer.spatial ? `<div class="asmr-position">${positionRanges(layer, i, ['azimuth', 'distance'])}<label for="asmr-orbit-${i}">3D movement</label><select id="asmr-orbit-${i}" aria-label="Sound ${i + 1} 3D movement" data-position="motion"><option value="still" ${layer.spatial.motion === 'still' ? 'selected' : ''}>Stay in place</option><option value="orbit" ${layer.spatial.motion === 'orbit' ? 'selected' : ''}>Orbit around your head</option></select><p class="fine-print">Places this layer as one source around your head. Direction sets the orbit's starting angle. Stereo keeps a recording's original width.</p></div>`
        : `<label for="asmr-motion-${i}">Movement</label><select id="asmr-motion-${i}" aria-label="Sound ${i + 1} movement" data-field="motion">${asmrMotions.map(motion => `<option value="${motion}" ${motion === layer.motion ? 'selected' : ''}>${({ still: 'Stay in place', sweep: 'Left / right sweep', wander: 'Slow wander' })[motion]}</option>`).join('')}</select>`}
      ${ranges(layer, i, layer.spatial ? ['pressure', 'period', 'rate', 'tone', 'pressurePhase'] : ['pan', 'pressure', 'width', 'period', 'rate', 'tone', 'pressurePhase'])}${layer.spatial ? positionRanges(layer, i, ['elevation']) : ''}</details></article>`).join('');
    host.querySelectorAll<HTMLInputElement>('input[data-field]').forEach(input => input.setAttribute('aria-valuetext', format(input.dataset.field!, Number(input.value))));
    transport();
    if (focusedLayer && (focusedField || focusedPosition || focusedPlacement)) {
      const attribute = focusedField ? 'data-field' : focusedPosition ? 'data-position' : 'data-placement';
      host.querySelector<HTMLElement>(`[data-asmr="${focusedLayer}"] [${attribute}="${focusedField ?? focusedPosition ?? focusedPlacement}"]`)?.focus({ preventScroll: true });
    }
  }
  function edit(change: (value: AsmrSettings) => void, light?: string): void {
    if (options.busy()) return;
    const next = structuredClone(settings()); change(next); options.update(next, light);
  }
  host.addEventListener('focusin', event => { const target = event.target as HTMLElement; if (target.matches('input,select') && !target.closest('.asmr-library')) options.beforeEdit(); });
  host.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (!input.checkValidity() || options.busy()) return;
    if (input.id === 'asmr-search' || input.id === 'asmr-filter') { renderLibrary(); return; }
    if (input.id === 'asmr-imported-mute') { options.muteImported(input.checked); return; }
    if (input.id === 'asmr-focus') { edit(value => { value.focus = input.checked; }); return; }
    if (input.id === 'asmr-level') { edit(value => { value.level = Number(input.value); }); $('#asmr-volume').textContent = format('level', Number(input.value)); return; }
    const id = input.closest<HTMLElement>('[data-asmr]')?.dataset.asmr;
    if (!id) return;
    if (input.dataset.position) {
      edit(value => {
        const position = value.layers.find(layer => layer.id === id)!.spatial!;
        const field = input.dataset.position!;
        if (field === 'motion') position.motion = input.value as 'still' | 'orbit';
        else position[field as keyof typeof asmrSpatialRanges] = Number(input.value);
      });
      if (input.type === 'range') {
        const text = formatPosition(input.dataset.position, Number(input.value));
        input.parentElement!.querySelector(`[data-position-output="${input.dataset.position}"]`)!.textContent = text;
        input.setAttribute('aria-valuetext', text);
      }
      refreshPlacement(id);
      return;
    }
    if (input.dataset.field === 'space') {
      const index = settings().layers.findIndex(layer => layer.id === id);
      edit(value => {
        const layer = value.layers[index];
        if (input.value === 'hrtf') layer.spatial = { ...defaultSpatial(), azimuth: Math.round(layer.pan * 90) };
        else delete layer.spatial;
      });
      render(); $(`#asmr-space-${index}`).focus({ preventScroll: true }); return;
    }
    if (!input.dataset.field) return;
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
    refreshPlacement(id);
    if (input.dataset.field === 'sound') transport();
  });
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || options.busy()) return;
    if (button.dataset.libraryAction) {
      const id = button.closest<HTMLElement>('[data-asmrlibrary]')!.dataset.asmrlibrary!;
      if (button.dataset.libraryAction !== 'favorite') { loadPreset(id, button.dataset.libraryAction === 'pair'); return; }
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      let saved = false;
      try { saved = saveAsmrFavorites(localStorage, favorites); } catch { /* Keep favorites for this tab. */ }
      $('#asmr-status').textContent = saved ? 'Favorites saved in this browser.' : 'Favorites kept for this tab. Browser storage is unavailable.';
      renderLibrary();
      const replacement = host.querySelector<HTMLButtonElement>(`[data-asmrlibrary="${id}"] [data-library-action="favorite"]`);
      (replacement ?? $('#asmr-filter')).focus(); return;
    }
    if (button.dataset.asmrPreset) {
      loadPreset(button.dataset.asmrPreset); return;
    }
    if (button.id === 'asmr-load' || button.id === 'asmr-pair') {
      loadPreset($<HTMLSelectElement>('#asmr-preset').value, button.id === 'asmr-pair'); return;
    }
    if (button.dataset.asmrSound) {
      const sound = button.dataset.asmrSound as AsmrSound;
      const existing = settings().layers.find(layer => layer.sound === sound);
      if (!existing && settings().layers.length >= MAX_ASMR_LAYERS) return;
      options.beforeEdit(); options.enable?.();
      const layer = existing ?? makeAsmrLayer(sound);
      if (!existing) edit(value => { value.layers.push(layer); });
      render(); focusLayer(layer.id); return;
    }
    options.beforeEdit();
    if (button.id === 'asmr-add') {
      if (settings().layers.length >= MAX_ASMR_LAYERS) return;
      options.enable?.();
      const layer = makeAsmrLayer(); edit(value => { value.layers.push(layer); }); render(); focusLayer(layer.id);
    }
    else if (button.id === 'asmr-clear') { edit(value => { value.layers = []; }); render(); }
    else if (button.id === 'asmr-only') { options.isolate(); $('#asmr-status').textContent = 'ASMR is on and tones are off. Your tone settings are kept.'; }
    else if (button.dataset.placement) {
      const id = button.closest<HTMLElement>('[data-asmr]')!.dataset.asmr;
      edit(value => { placement(value.layers.find(layer => layer.id === id)!, button.dataset.placement!); }); render();
    }
    else if (button.dataset.action) {
      const id = button.closest<HTMLElement>('[data-asmr]')!.dataset.asmr;
      edit(value => {
        const index = value.layers.findIndex(layer => layer.id === id), layer = value.layers[index];
        const action = button.dataset.action;
        if (action === 'remove') value.layers.splice(index, 1);
        else if (action === 'duplicate' && value.layers.length < MAX_ASMR_LAYERS) value.layers.splice(index + 1, 0, { ...structuredClone(layer), id: crypto.randomUUID() });
        else if (action === 'muted' || action === 'solo') layer[action] = !layer[action];
      });
      if (['muted', 'solo'].includes(button.dataset.action)) {
        const layer = settings().layers.find(layer => layer.id === id)!;
        button.setAttribute('aria-pressed', String(layer[button.dataset.action as 'muted' | 'solo']));
      } else render();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== ASMR_FAVORITES_KEY && event.key !== null) return;
    try { if (event.storageArea !== localStorage) return; } catch { return; }
    favorites = parseAsmrFavorites(event.newValue, library); renderLibrary();
  });
  $<HTMLSelectElement>('#asmr-preset').addEventListener('change', () => { $('#asmr-description').textContent = asmrPresets.find(preset => preset.id === $<HTMLSelectElement>('#asmr-preset').value)!.description; });
  $('#asmr-description').textContent = asmrPresets[0].description;
  $<HTMLSelectElement>('#asmr-preset').value = asmrPresets[0].id;
  renderLibrary(); render(); return { refresh: render, transport };
}
