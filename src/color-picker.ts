import { fromHex, toHex, type LightColor } from './visual-color';

export function setupColorPicker(host: HTMLElement, changed: (color: LightColor) => void, options?: { prefix: string; label: string }) {
  host.innerHTML = `<label for="visual-color">${options?.label ?? 'Ambient light color'}</label>
    <div class="light-color-control"><button id="color-toggle" class="color-swatch" aria-label="Choose ambient color" aria-expanded="false" aria-controls="color-palette"></button><input id="visual-color" type="text" value="#367d4e" maxlength="7" spellcheck="false" aria-describedby="color-format" /><output id="color-value" class="sr-only" for="visual-color"></output></div>
    <div id="color-palette" class="color-palette" hidden>
      <div id="color-plane" class="color-plane" aria-hidden="true"><span></span></div>
      <p id="color-format" class="fine-print">Choose a shade or enter a hex color, such as #367D4E.</p>
      <div class="color-presets">${['#367d4e', '#0ba875', '#338dcc', '#7854bb', '#cc3399', '#e6ad51', '#808080', '#000000', '#ffffff'].map(hex => `<button type="button" data-color="${hex}" aria-label="Use ${hex}" style="--swatch:${hex}"></button>`).join('')}</div>
      ${options ? '<label for="color-hue">Hue</label><input id="color-hue" type="range" min="0" max="360" step="any" />' : ''}
      <label class="range-heading" for="color-saturation">Saturation <output id="saturation-value"></output></label><input id="color-saturation" type="range" min="0" max="100" step="any" />
    </div>`;
  if (options) {
    host.innerHTML = host.innerHTML.replace(/(id|for|aria-controls|aria-describedby)="([\w-]+)"/g, (_, attr, id) => `${attr}="${options.prefix}-${id}"`);
  }
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(options && selector.startsWith('#') ? `#${options.prefix}-${selector.slice(1)}` : selector)!;
  const field = find<HTMLInputElement>('#visual-color');
  const toggle = find<HTMLButtonElement>('#color-toggle');
  if (options) toggle.setAttribute('aria-label', `Choose ${options.label.toLowerCase()}`);
  const palette = find('#color-palette');
  const plane = find('#color-plane');
  const saturation = find<HTMLInputElement>('#color-saturation');
  if (options) {
    find<HTMLInputElement>('#color-hue').setAttribute('aria-label', `${options.label} hue`);
    saturation.setAttribute('aria-label', `${options.label} saturation`);
  }
  let current: LightColor = { hue: 140, saturation: 40, level: 35 };

  function update(color: LightColor): void {
    current = { ...color };
    const hex = toHex(color);
    field.value = hex;
    field.removeAttribute('aria-invalid');
    find('#color-value').textContent = hex.toUpperCase();
    toggle.style.setProperty('--swatch', hex);
    saturation.value = String(color.saturation);
    find('#saturation-value').textContent = `${Math.round(color.saturation)}%`;
    if (options) find<HTMLInputElement>('#color-hue').value = String(color.hue);
    const light = color.level / 100;
    const value = light + color.saturation / 100 * Math.min(light, 1 - light);
    const sat = value ? 2 * (1 - light / value) : 0;
    plane.style.setProperty('--picker-hue', String(color.hue));
    plane.style.setProperty('--picker-x', `${sat * 100}%`);
    plane.style.setProperty('--picker-y', `${(1 - value) * 100}%`);
  }
  function choose(color: LightColor): void { update(color); changed(color); }
  toggle.addEventListener('click', () => {
    palette.hidden = !palette.hidden;
    toggle.setAttribute('aria-expanded', String(!palette.hidden));
  });
  field.addEventListener('input', () => {
    if (/^#[\da-f]{6}$/i.test(field.value)) choose(fromHex(field.value, current.hue));
    else field.setAttribute('aria-invalid', 'true');
  });
  field.addEventListener('blur', () => update(current));
  saturation.addEventListener('input', () => choose({ ...current, saturation: Number(saturation.value) }));
  if (options) find<HTMLInputElement>('#color-hue').addEventListener('input', event => choose({ ...current, hue: Number((event.target as HTMLInputElement).value) }));
  host.querySelector('.color-presets')!.addEventListener('click', event => {
    const hex = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color]')?.dataset.color;
    if (hex) choose(fromHex(hex, current.hue));
  });
  function point(event: PointerEvent): void {
    const bounds = plane.getBoundingClientRect();
    const sat = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const value = 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const level = value * (1 - sat / 2);
    choose({ hue: current.hue, level: level * 100,
      saturation: level > 0 && level < 1 ? (value - level) / Math.min(level, 1 - level) * 100 : 0 });
  }
  plane.addEventListener('pointerdown', event => { plane.setPointerCapture(event.pointerId); point(event); });
  plane.addEventListener('pointermove', event => { if (plane.hasPointerCapture(event.pointerId)) point(event); });
  update(current);
  return { update };
}
