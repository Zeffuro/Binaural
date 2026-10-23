export const lightTimingKey = 'binaural.light-timing.v1';

export function parseLightTiming(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value / 10) && value >= -250 && value <= 500 ? value : 0;
}

export function setupLightTiming(host: HTMLElement, redraw: () => void) {
  const read = () => { try { return parseLightTiming(JSON.parse(localStorage.getItem(lightTimingKey) ?? '0')); } catch { return 0; } };
  let offset = read();
  const field = document.createElement('fieldset'); field.className = 'light-timing';
  field.innerHTML = `<legend>Headphone timing</legend>
    <label class="trigger-range" for="light-timing-offset">Light timing adjustment<output id="light-timing-value" for="light-timing-offset" aria-hidden="true"></output>
      <input id="light-timing-offset" type="range" min="-250" max="500" step="10" aria-describedby="light-timing-help" /></label>
    <button type="button" class="text-button" id="light-timing-reset">Use automatic timing</button>
    <p id="light-timing-help" class="fine-print">If lights feel early, add delay. Earlier movement is limited by available audio. Saved only in this browser; shared presets and video exports keep their own timing.</p>
    <p class="fine-print" role="status" hidden>Applied for this tab. Browser storage is unavailable.</p>`;
  host.append(field);
  const input = field.querySelector('input')!, output = field.querySelector('output')!;
  function sync(): void {
    input.value = String(offset);
    const text = offset ? `${Math.abs(offset)} ms ${offset > 0 ? 'later' : 'earlier'}` : 'Automatic';
    output.textContent = text; input.setAttribute('aria-valuetext', text);
  }
  function set(value: number): void {
    offset = parseLightTiming(value); sync();
    const status = field.querySelector<HTMLElement>('[role=status]')!;
    try { localStorage.setItem(lightTimingKey, JSON.stringify(offset)); status.hidden = true; } catch { status.hidden = false; }
    redraw();
  }
  field.addEventListener('focusin', event => event.stopPropagation());
  field.addEventListener('input', event => { event.stopPropagation(); if (event.target === input) set(Number(input.value)); });
  field.addEventListener('change', event => event.stopPropagation());
  field.querySelector('button')!.addEventListener('click', () => set(0));
  window.addEventListener('storage', event => { if (event.key === lightTimingKey || event.key === null) { offset = read(); sync(); redraw(); } });
  sync();
  return { offset: () => offset, enabled(value: boolean) { field.hidden = !value; } };
}
