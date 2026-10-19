import { listeningModes, type ListeningMode } from './listening-mode';
import './mode-controls.css';

export function setupListeningMode(options: { get: () => ListeningMode; change: (mode: ListeningMode) => void; busy: () => boolean }) {
  const host = document.createElement('div'); host.className = 'listening-modes';
  host.innerHTML = `<div role="group" aria-label="Listening mode">${listeningModes.map(mode => `<button class="secondary-button" data-listening-mode="${mode}" aria-pressed="false">${mode === 'asmr' ? 'ASMR' : mode === 'mixed' ? 'Mixed' : 'Binaural'}</button>`).join('')}</div><p id="mode-description" class="fine-print"></p>`;
  document.querySelector('.transport-controls')!.before(host);
  const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href="#tone-controls"]')];
  host.addEventListener('click', event => {
    const mode = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-listening-mode]')?.dataset.listeningMode as ListeningMode | undefined;
    if (mode && !options.busy()) options.change(mode);
  });
  const descriptions = { binaural: 'Tone layers with optional atmosphere and music. Your ASMR mix is kept for later.', asmr: 'ASMR sounds with optional atmosphere and music. Tone layers are silent and kept for later.', mixed: 'ASMR and tone layers together, with optional atmosphere and music.' };
  return { refresh() {
    const mode = options.get();
    host.querySelectorAll<HTMLButtonElement>('[data-listening-mode]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.listeningMode === mode)); button.disabled = options.busy(); });
    host.querySelector('#mode-description')!.textContent = descriptions[mode];
    document.querySelector<HTMLElement>('#asmr-controls')!.hidden = mode === 'binaural';
    document.querySelector<HTMLElement>('#tone-controls')!.hidden = mode === 'asmr';
    document.querySelector<HTMLElement>('.frequency-panel')!.hidden = mode === 'asmr';
    sectionLinks.forEach(link => {
      link.href = mode === 'asmr' ? '#asmr-controls' : '#tone-controls';
      link.textContent = `${link.closest('.skip-links') ? 'Skip to ' : ''}${mode === 'asmr' ? 'ASMR' : link.closest('.skip-links') ? 'tones' : 'Tones'}`;
    });
    document.body.dataset.listeningMode = mode;
  } };
}
