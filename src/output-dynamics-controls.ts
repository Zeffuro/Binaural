import { outputDynamicsProfiles, type OutputDynamicsProfile } from './output-dynamics';

export function setupOutputDynamicsControls(host: HTMLElement, options: {
  get(): OutputDynamicsProfile | undefined;
  edit(profile: OutputDynamicsProfile | undefined): void;
  busy(): boolean;
}) {
  const details = document.createElement('details'); details.className = 'sound-settings';
  details.innerHTML = `<summary>Sound settings</summary><label for="output-dynamics">Sound dynamics</label>
    <select id="output-dynamics" aria-describedby="output-dynamics-help">${outputDynamicsProfiles.map(profile => `<option value="${profile.id}">${profile.name}</option>`).join('')}</select>
    <p id="output-dynamics-help" class="fine-print"></p>
    <p class="fine-print">Applies to playback, sound previews and exports. Changing dynamics can change overall volume.</p>`;
  host.querySelector('#visual-quick')!.before(details);
  const select = details.querySelector('select')!;
  function transport(): void { select.disabled = options.busy(); }
  function refresh(): void {
    select.value = options.get() ?? 'balanced';
    details.querySelector('#output-dynamics-help')!.textContent = outputDynamicsProfiles.find(profile => profile.id === select.value)!.description;
    transport();
  }
  select.addEventListener('change', () => {
    const profile = outputDynamicsProfiles.find(profile => profile.id === select.value);
    if (options.busy() || !profile) { refresh(); return; }
    options.edit(profile.id === 'balanced' ? undefined : profile.id);
    refresh();
  });
  refresh(); return { refresh, transport };
}
