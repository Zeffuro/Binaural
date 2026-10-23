import { setupColorPicker } from './color-picker';
import { fromHex, toHex } from './visual-color';
import { defaultTriggerSettings, parseTriggerSettings, triggerRanges, triggerGestures, type TriggerSettings } from './trigger-state';
import { triggerPresets } from './trigger-presets';
import { setupAsmrVisualConsent } from './asmr-visual-consent';
import './trigger-controls.css';
import { setupLightTiming } from './light-timing';

type Numeric = keyof typeof triggerRanges;
const labels: Record<Numeric, string> = { symmetry: 'Radial symmetry', density: 'Glass pieces', zoom: 'Zoom', speed: 'Glass rotation speed', rotation: 'Starting angle', drift: 'Glass drift',
  depth: 'Glass depth', softness: 'Softness', glow: 'Glow', brightness: 'Brightness', light: 'Backlight strength', lightSpeed: 'Light movement speed', size: 'Light size',
  trail: 'Light trail', reaction: 'Audio influence', offsetX: 'Horizontal position', offsetY: 'Vertical position', seed: 'Glass seed' };
const options = (values: [string, string][]) => values.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
const select = (field: string, label: string, values: [string, string][]) => `<label>${label}<select aria-label="${label}" data-trigger="${field}">${options(values)}</select></label>`;
const range = (field: Numeric) => {
  const [min, max, step] = triggerRanges[field];
  return `<label class="trigger-range" for="trigger-${field}">${labels[field]}<output aria-hidden="true" data-trigger-output="${field}"></output><input id="trigger-${field}" aria-label="${labels[field]}" data-trigger="${field}" type="${field === 'seed' ? 'number' : 'range'}" min="${min}" max="${max}" step="${step}" /></label>`;
};
const group = (title: string, fields: Numeric[], extra = '', kind = '') => `<fieldset ${kind ? `data-trigger-group="${kind}"` : ''}><legend>${title}</legend>${extra}${fields.map(range).join('')}</fieldset>`;
const featured = ['prism-lantern', 'rose-glass', 'red-scan', 'soft-torch', 'bright-prism', 'very-bright-torch'];
const intensities = [['Comfortable', .55], ['Bright', 1.5], ['Very bright', 4]] as const;

export function setupTriggerControls(host: HTMLElement, redraw: () => void, changed: () => void, beforeEdit: () => void) {
  let state = defaultTriggerSettings(), basePreset = state.preset;
  let asmrContext = false, manualPosition = false, revision = 0;
  const approval = setupAsmrVisualConsent();
  const cancelPending = () => { revision++; approval.cancel(); };
  const panel = document.createElement('section'); panel.className = 'trigger-controls'; panel.id = 'trigger-controls'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Light trigger controls');
  panel.innerHTML = `<h3>Light triggers</h3><div class="trigger-featured" aria-label="Featured light presets">${featured.map(id => {
    const item = triggerPresets.find(preset => preset.id === id)!;
    return `<button type="button" class="secondary-button" data-trigger-preset="${id}" aria-pressed="false"><span class="trigger-swatch" aria-hidden="true" style="--trigger-color:${item.settings.color};--trigger-accent:${item.settings.accent}"></span>${item.name}</button>`;
  }).join('')}</div><label for="trigger-preset">Light trigger preset</label><select id="trigger-preset">${options(triggerPresets.map(item => [item.id, item.name]))}<option value="custom" disabled>Custom settings</option></select>
    <p id="trigger-description" class="fine-print"></p><div class="trigger-navigation"><button type="button" class="secondary-button" data-trigger-prev>Previous light</button><button type="button" class="secondary-button" data-trigger-next>Next light</button><button type="button" class="text-button" data-trigger-reset>Reset preset</button></div>
    <div class="trigger-grid trigger-essentials">${group('Intensity', ['brightness'], `<div class="trigger-intensity" role="group" aria-label="Light intensity">${intensities.map(([name, value]) => `<button type="button" class="secondary-button" data-trigger-intensity="${value}" aria-pressed="false">${name}</button>`).join('')}</div><p class="fine-print">Up to 400% exposure for intense white highlights.</p>`)}
    ${group('Light movement', ['lightSpeed', 'size'], select('path', 'Light path', [['orbit', 'Orbit'], ['horizontal', 'Side to side'], ['vertical', 'Up and down'], ['figure-eight', 'Figure eight'], ['manual', 'Place by hand']]))}</div>
    <details class="trigger-settings"><summary>More settings: color, glass and light</summary><div class="trigger-grid">
    <fieldset><legend>Style and color</legend>${select('style', 'Trigger style', [['kaleidoscope', 'Optical kaleidoscope'], ['scan', 'Light scan'], ['torch', 'Soft torch'], ['gesture', 'Close-up gestures']])}<div data-trigger-color="color"></div><div data-trigger-color="accent"></div><div data-trigger-color="lampColor"></div></fieldset>
    ${group('Mirrors and glass', ['symmetry', 'density', 'zoom', 'seed'], select('layout', 'Mirror layout', [['tiled', 'Mirrored tiles'], ['radial', 'Radial mirrors']]) + select('motif', 'Glass shapes', [['beads', 'Beads'], ['prism', 'Prisms'], ['petals', 'Petals'], ['stars', 'Stars']]), 'glass')}
    ${group('Glass movement', ['speed', 'drift'], '', 'glass')}
    ${group('Light placement and backlight', ['light', 'rotation', 'offsetX', 'offsetY'])}
    ${group('Finish and response', ['depth', 'softness', 'glow', 'trail', 'reaction'])}
    </div><p class="fine-print">Glass and backlight move independently. Place by hand lets you drag the preview. Audio influence gently follows the current mix; it does not add sound. Motion follows playback or Animate without audio.</p></details>`;
  host.append(panel);
  const consentBox = document.createElement('div'); consentBox.id = 'trigger-consent'; consentBox.hidden = true;
  consentBox.innerHTML = '<p class="fine-print">Moving mirrored patterns and bright lights can be uncomfortable for photosensitive viewers. These presets use smooth movement without strobe effects.</p><label class="visual-toggle"><span>Enable light triggers</span><input id="trigger-enable" type="checkbox" /></label>';
  host.append(consentBox);
  const consent = consentBox.querySelector<HTMLInputElement>('input')!;
  const preset = panel.querySelector<HTMLSelectElement>('#trigger-preset')!;
  const details = panel.querySelector('details')!;
  const timing = setupLightTiming(details.querySelector('.trigger-grid')!, redraw);
  const description = panel.querySelector('#trigger-description')!;
  const richControls = [...panel.children].filter(child => child.tagName !== 'H3' && child !== details);
  const advanced = document.createElement('div'); details.querySelector('summary')!.after(advanced);
  const syncControls = document.createElement('div'); syncControls.className = 'asmr-gesture-controls';
  const gestureNames = ['Match the sound', 'Follow the light', 'Brush pass', 'Tap contact', 'Tracing', 'Inspect an object', 'Ear attention', 'Water ripples'];
  syncControls.innerHTML = '<label class="visual-toggle"><span>Sync with ASMR sounds</span><input id="trigger-sync-asmr" data-trigger="syncAsmr" type="checkbox" /></label>'
    + `<div id="trigger-gesture-choice">${select('gesture', 'Visual gesture', triggerGestures.map((value, i) => [value, gestureNames[i]]))}</div>`
    + '<p id="trigger-sync-help" class="fine-print">Follows each sound’s activity and audible side. Recorded clips use detected sound activity. Start listening to see the gestures.</p>';
  panel.querySelector('h3')!.after(syncControls);
  const simple = document.createElement('div'); simple.className = 'asmr-visual-simple'; simple.hidden = true;
  const quickSelect = (field: string, label: string, values: [string, string][]) => `<label>${label}<select aria-label="ASMR ${label.toLowerCase()}" data-asmr-visual="${field}">${options(values)}<option value="custom" disabled>Custom</option></select></label>`;
  simple.innerHTML = quickSelect('intensity', 'Intensity', [['soft', 'Soft'], ['normal', 'Normal'], ['focused', 'Focused']])
    + quickSelect('pace', 'Pace', [['still', 'Still'], ['very-slow', 'Very slow'], ['slow', 'Slow']])
    + quickSelect('position', 'Position', [['follow', 'Follow'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['manual', 'Manual']])
    + '<p class="fine-print">Soft, slow paired lights. Advanced visual settings include all presets, colors and brighter lights. Manual lets you drag the preview or use the advanced position controls.</p>';
  panel.querySelector('h3')!.after(simple);
  function context(value: boolean): void {
    if (asmrContext === value) return;
    asmrContext = value; simple.hidden = !value;
    details.querySelector('summary')!.textContent = value ? 'Advanced visual settings' : 'More settings: color, glass and light';
    for (const control of richControls) {
      if (value) advanced.append(control); else panel.insertBefore(control, details);
    }
    details.open = false;
  }
  const dialog = document.createElement('dialog'); dialog.className = 'trigger-dialog'; dialog.setAttribute('aria-label', 'Adjust light triggers');
  dialog.innerHTML = '<div class="trigger-dialog-heading"><h2>Adjust light triggers</h2><button type="button" class="secondary-button">Close light settings (Esc)</button></div><p class="fine-print">Changes update the preview immediately.</p>';
  document.body.append(dialog);
  let returnParent: HTMLElement | undefined, previousOpen = false;
  const pickers = (['color', 'accent', 'lampColor'] as const).map(key => ({ key, picker: setupColorPicker(panel.querySelector(`[data-trigger-color="${key}"]`)!, value => {
    state[key] = toHex(value); customize();
  }, { prefix: `trigger-${key}`, label: key === 'color' ? 'Main color' : key === 'accent' ? 'Accent color' : 'Backlight color' }) }));
  function format(key: Numeric): string {
    const value = state[key];
    return key === 'zoom' ? `${value.toFixed(2)}×` : key === 'rotation' ? `${value}°` : key === 'lightSpeed' ? (value ? `${Math.round(value * 60)} cycles/min` : 'Still') : ['symmetry', 'density', 'seed'].includes(key) ? String(value) : `${Math.round(value * 100)}%`;
  }
  function sync(): void {
    preset.value = state.preset;
    panel.querySelectorAll<HTMLButtonElement>('[data-trigger-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.triggerPreset === state.preset)));
    const intensity = state.brightness < 1 ? .55 : state.brightness < 2.5 ? 1.5 : 4;
    panel.querySelectorAll<HTMLButtonElement>('[data-trigger-intensity]').forEach(button => button.setAttribute('aria-pressed', String(state.brightness > 0 && Number(button.dataset.triggerIntensity) === intensity)));
    description.textContent = triggerPresets.find(item => item.id === state.preset)?.description ?? 'Custom light settings. Save the session to keep this combination.';
    panel.querySelector('[data-trigger-reset]')!.textContent = state.preset === 'custom' ? `Reset to ${triggerPresets.find(item => item.id === basePreset)?.name ?? 'Prism lantern'}` : 'Reset preset';
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-trigger]').forEach(input => {
      const key = input.dataset.trigger as keyof TriggerSettings;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = !!state[key];
      else input.value = String(state[key]);
      if (key in triggerRanges) input.setAttribute('aria-valuetext', format(key as Numeric));
    });
    panel.querySelectorAll<HTMLOutputElement>('[data-trigger-output]').forEach(output => { output.textContent = format(output.dataset.triggerOutput as Numeric); });
    panel.querySelectorAll<HTMLFieldSetElement>('[data-trigger-group=glass]').forEach(field => { field.disabled = state.style !== 'kaleidoscope'; });
    panel.querySelector<HTMLElement>('[data-trigger-color=lampColor]')!.hidden = state.style !== 'kaleidoscope';
    panel.querySelector<HTMLInputElement>('[data-trigger=symmetry]')!.disabled = state.layout !== 'radial';
    panel.querySelector<HTMLInputElement>('[data-trigger=light]')!.disabled = state.style !== 'kaleidoscope';
    panel.querySelector<HTMLInputElement>('[data-trigger=trail]')!.disabled = state.style !== 'scan';
    panel.querySelector<HTMLInputElement>('[data-trigger=depth]')!.disabled = state.style === 'scan';
    panel.querySelector<HTMLElement>('#trigger-gesture-choice')!.hidden = state.style !== 'gesture';
    panel.querySelector<HTMLElement>('#trigger-sync-help')!.hidden = !state.syncAsmr;
    timing.enabled(!!state.syncAsmr);
    for (const key of ['offsetX', 'offsetY']) panel.querySelector<HTMLInputElement>(`[data-trigger=${key}]`)!.disabled = state.path !== 'manual';
    pickers.forEach(({ key, picker }) => picker.update(fromHex(state[key], 0)));
    const quickValue = (field: string, value: string) => { simple.querySelector<HTMLSelectElement>(`[data-asmr-visual=${field}]`)!.value = value; };
    quickValue('intensity', state.brightness === .3 ? 'soft' : state.brightness === .5 ? 'normal' : state.brightness === .65 ? 'focused' : 'custom');
    quickValue('pace', !state.speed && !state.drift && !state.lightSpeed ? 'still' : state.speed <= .008 && state.drift <= .03 && state.lightSpeed <= .025 ? 'very-slow' : state.speed <= .015 && state.drift <= .06 && state.lightSpeed <= .05 ? 'slow' : 'custom');
    quickValue('position', state.path !== 'manual' ? 'follow' : manualPosition ? 'manual' : state.offsetY === 0 && state.offsetX === -.65 ? 'left' : state.offsetY === 0 && state.offsetX === .65 ? 'right' : state.offsetY === 0 && state.offsetX === 0 ? 'center' : 'manual');
  }
  function customize(): void { cancelPending(); state.preset = 'custom'; sync(); redraw(); changed(); }
  function apply(id: string): void {
    const selected = triggerPresets.find(item => item.id === id); if (!selected) return;
    cancelPending();
    state = structuredClone(selected.settings); basePreset = selected.id; sync(); redraw(); changed();
  }
  function next(direction = 1): void {
    const current = triggerPresets.findIndex(item => item.id === state.preset);
    const index = current < 0 ? (direction > 0 ? 0 : triggerPresets.length - 1) : (current + direction + triggerPresets.length) % triggerPresets.length;
    apply(triggerPresets[index].id);
  }
  panel.addEventListener('focusin', beforeEdit);
  panel.addEventListener('input', event => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement, key = input.dataset.trigger;
    if (!key) return;
    const value = input.type === 'checkbox' ? input.checked : key in triggerRanges ? Number(input.value) : input.value;
    try { state = parseTriggerSettings({ ...state, [key]: value }); customize(); } catch { sync(); }
  });
  panel.addEventListener('change', event => { event.stopPropagation(); if (event.target === preset) apply(preset.value); });
  simple.addEventListener('change', event => {
    const input = event.target as HTMLSelectElement;
    beforeEdit();
    if (input.dataset.asmrVisual === 'intensity') state.brightness = ({ soft: .3, normal: .5, focused: .65 } as Record<string, number>)[input.value];
    if (input.dataset.asmrVisual === 'pace') {
      const pace = ({ still: [0, 0, 0], 'very-slow': [.008, .03, .025], slow: [.015, .06, .05] } as Record<string, number[]>)[input.value];
      [state.speed, state.drift, state.lightSpeed] = pace;
      if (input.value === 'still') state.reaction = 0;
    }
    if (input.dataset.asmrVisual === 'position') {
      manualPosition = input.value === 'manual';
      state.path = input.value === 'follow' ? 'horizontal' : 'manual'; state.reaction = 0;
      if (input.value !== 'manual') { state.offsetX = input.value === 'left' ? -.65 : input.value === 'right' ? .65 : 0; state.offsetY = 0; }
    }
    customize();
  });
  panel.querySelector('[data-trigger-prev]')!.addEventListener('click', () => { beforeEdit(); next(-1); });
  panel.querySelector('[data-trigger-next]')!.addEventListener('click', () => { beforeEdit(); next(); });
  panel.querySelector('[data-trigger-reset]')!.addEventListener('click', () => { beforeEdit(); apply(state.preset === 'custom' ? basePreset : state.preset); });
  panel.querySelectorAll<HTMLButtonElement>('[data-trigger-preset]').forEach(button => button.addEventListener('click', () => { beforeEdit(); apply(button.dataset.triggerPreset!); }));
  panel.querySelectorAll<HTMLButtonElement>('[data-trigger-intensity]').forEach(button => button.addEventListener('click', () => { beforeEdit(); state.brightness = Number(button.dataset.triggerIntensity); customize(); }));
  consent.addEventListener('change', () => { beforeEdit(); cancelPending(); if (!consent.checked) approval.revoke(); redraw(); });
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); dialog.close(); });
  dialog.addEventListener('close', () => { if (returnParent) returnParent.append(panel); details.open = previousOpen; });
  sync();
  return {
    panel, consentBox, enabled: () => consent.checked, timingOffset: timing.offset,
    state: () => structuredClone(state),
    select(mode: string) { panel.hidden = consentBox.hidden = mode !== 'triggers'; },
    next, apply,
    cancelPending,
    disable() { cancelPending(); consent.checked = false; },
    generic() { cancelPending(); if (asmrContext) context(false); },
    approved: () => consent.checked,
    async applyAsmr(id: string, accepted: () => void, approved = false): Promise<boolean> {
      cancelPending();
      const selected = triggerPresets.find(item => item.id === id); if (!selected) return false;
      const current = revision;
      const decision = approved || consent.checked || approval.remembered() ? { allowed: true, remember: false } : await approval.request();
      if (!decision.allowed || current !== revision) return false;
      if (decision.remember) approval.remember();
      state = structuredClone(selected.settings); basePreset = selected.id;
      manualPosition = false; state.brightness = .3; state.speed = Math.min(.015, state.speed);
      state.drift = Math.min(.06, state.drift); state.lightSpeed = Math.min(.05, state.lightSpeed);
      state.reaction = Math.min(.2, state.reaction); state.preset = 'custom';
      consent.checked = true; context(true); sync(); accepted(); return true;
    },
    restore(value: TriggerSettings) { cancelPending(); context(false); state = parseTriggerSettings(value); basePreset = state.preset === 'custom' ? 'prism-lantern' : state.preset; consent.checked = false; sync(); },
    open() { if (panel.hidden || dialog.open) return; returnParent = panel.parentElement!; previousOpen = details.open; details.open = true; dialog.append(panel); dialog.showModal(); },
    position(x: number, y: number) { manualPosition = true; state.offsetX = Math.max(-1, Math.min(1, x)); state.offsetY = Math.max(-1, Math.min(1, y)); customize(); },
  };
}
