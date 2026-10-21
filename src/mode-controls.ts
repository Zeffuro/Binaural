import { modeForSources, modeGains, type ListeningMode } from './listening-mode';
import './mode-controls.css';

export function setupListeningMode(options: { get: () => ListeningMode; change: (mode: ListeningMode) => void; busy: () => boolean }) {
  const host = document.createElement('div'); host.className = 'listening-modes';
  host.innerHTML = `<div role="group" aria-label="Sound sources">${['tones', 'asmr'].map(source => `<button class="secondary-button" data-source="${source}" aria-label="${source === 'tones' ? 'Tones' : 'ASMR'}" aria-pressed="false"><span>${source === 'tones' ? 'Tones' : 'ASMR'}</span><span data-source-status></span></button>`).join('')}</div><p id="mode-description" class="fine-print"></p>`;
  document.querySelector('.transport-controls')!.before(host);
  const tones = document.querySelector<HTMLElement>('#tone-controls')!;
  const add = tones.querySelector<HTMLButtonElement>('#add-layer')!;
  const toneSettings = document.createElement('details'); toneSettings.id = 'tone-settings'; toneSettings.className = 'source-settings';
  toneSettings.innerHTML = '<summary>Tone settings</summary>';
  toneSettings.append(tones.querySelector('#timeline-info')!, tones.querySelector('#layers')!); tones.append(toneSettings);
  const off = document.createElement('p'); off.className = 'fine-print source-off';
  off.textContent = 'Tones are off. Your settings are kept.'; tones.querySelector('.section-heading')!.after(off);
  const frequency = document.querySelector<HTMLElement>('.frequency-panel')!;
  const frequencySettings = document.createElement('details'); frequencySettings.id = 'frequency-browser'; frequencySettings.className = 'source-settings';
  frequencySettings.innerHTML = '<summary>Browse frequencies</summary>';
  while (frequency.children.length > 1) frequencySettings.append(frequency.children[1]);
  frequency.append(frequencySettings);
  let previousTones: boolean | undefined;
  host.addEventListener('click', event => {
    const source = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-source]')?.dataset.source;
    if (!source || options.busy()) return;
    const gains = modeGains(options.get());
    options.change(modeForSources(source === 'tones' ? !gains.tones : !!gains.tones, source === 'asmr' ? !gains.asmr : !!gains.asmr));
  });
  const descriptions = { binaural: 'Add ASMR sounds without changing your tones.', asmr: 'ASMR on its own. Your tone settings are kept.', mixed: 'Tones and ASMR together.', ambient: 'Just atmosphere, music or visuals. Your sound settings are kept.' };
  return { refresh() {
    const mode = options.get(), gains = modeGains(mode), enabled = !!gains.tones;
    host.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button => {
      const on = button.dataset.source === 'tones' ? enabled : !!gains.asmr;
      button.setAttribute('aria-pressed', String(on)); button.disabled = options.busy();
      button.querySelector('[data-source-status]')!.textContent = on ? 'On' : 'Off';
    });
    host.querySelector('#mode-description')!.textContent = descriptions[mode];
    off.hidden = enabled; add.hidden = !enabled;
    if (previousTones !== enabled) { toneSettings.open = frequencySettings.open = enabled; previousTones = enabled; }
    document.body.dataset.listeningMode = mode;
  } };
}
