import type { AsmrSettings } from './asmr-state';
import { asmrSpacePresets, defaultAsmrSpace, type AsmrSpaceSettings } from './asmr-space';

export function setupAsmrSpaceControls(host: HTMLElement, options: {
  get(): AsmrSettings;
  edit(change: (value: AsmrSettings) => void): void;
  busy(): boolean;
}) {
  host.innerHTML = `<label for="asmr-listening-space">Listening space</label>
    <select id="asmr-listening-space" aria-describedby="asmr-space-help">${asmrSpacePresets.map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}<option value="custom" disabled>Custom room</option></select>
    <p id="asmr-space-help" class="fine-print">Short, soft reflections for the ASMR mix. Dry keeps sounds close.</p>
    <details id="asmr-room-settings"><summary>Adjust room</summary>
      <label class="range-heading" for="asmr-room-amount">Reflections <output id="asmr-room-amount-value" aria-hidden="true"></output></label><input id="asmr-room-amount" aria-label="Reflections" type="range" min="0" max=".35" step=".01" data-room="amount" />
      <label class="range-heading" for="asmr-room-size">Room size <output id="asmr-room-size-value" aria-hidden="true"></output></label><input id="asmr-room-size" aria-label="Room size" type="range" min=".5" max="1.5" step=".05" data-room="size" />
      <label class="range-heading" for="asmr-room-warmth">Warmth <output id="asmr-room-warmth-value" aria-hidden="true"></output></label><input id="asmr-room-warmth" aria-label="Warmth" type="range" min="0" max="1" step=".01" data-room="warmth" />
    </details>`;
  const choice = host.querySelector<HTMLSelectElement>('#asmr-listening-space')!;
  const controls = [...host.querySelectorAll<HTMLInputElement>('[data-room]')];
  function transport(): void {
    choice.disabled = options.busy();
    for (const input of controls) input.disabled = options.busy() || (input.dataset.room !== 'amount' && !(options.get().space?.amount));
  }
  function refresh(): void {
    const state = options.get().space ?? defaultAsmrSpace();
    choice.value = state.amount === 0 ? 'dry' : asmrSpacePresets.find(preset =>
      (Object.keys(state) as (keyof AsmrSpaceSettings)[]).every(key => state[key] === preset.settings[key]))?.id ?? 'custom';
    for (const input of controls) {
      const field = input.dataset.room as keyof AsmrSpaceSettings, value = state[field];
      const text = field === 'size' ? `${value.toFixed(2)}×` : `${Math.round(value * 100)}%`;
      input.value = String(value); input.setAttribute('aria-valuetext', text);
      host.querySelector(`#${input.id}-value`)!.textContent = text;
    }
    transport();
  }
  host.addEventListener('input', event => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (options.busy() || !input.checkValidity()) { refresh(); return; }
    if (input === choice) {
      const preset = asmrSpacePresets.find(preset => preset.id === input.value);
      if (!preset) return;
      options.edit(value => { if (preset.id === 'dry') delete value.space; else value.space = { ...preset.settings }; });
    } else {
      const field = input.dataset.room as keyof AsmrSpaceSettings | undefined;
      if (!field) return;
      options.edit(value => { value.space = { ...(value.space ?? defaultAsmrSpace()), [field]: Number(input.value) }; });
    }
    refresh();
  });
  refresh();
  return { refresh, transport };
}
