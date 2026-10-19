import { MAX_EXPORT_SECONDS, renderWav } from './audio/export';
import { parseSession, type Session } from './model';
import { listeningMode, modeGains } from './listening-mode';

export function setupAudioExport(options: {
  session: () => Session;
  hasMusic: () => boolean;
  notify: (message: string) => void;
}): void {
  const button = document.querySelector<HTMLButtonElement>('#render-audio');
  if (!button) return;
  let active = false;
  button.addEventListener('click', () => {
    if (active) return;
    if (options.hasMusic()) {
      options.notify('Remove the local music file before WAV export. Local music export is not available yet.');
      return;
    }
    const current = options.session();
    if (current.bwg && modeGains(listeningMode(current)).tones && !current.bwgMuted) {
      options.notify('WAV export currently supports ordinary tone and background sessions. BWGen export is not available yet.');
      return;
    }
    let session: Session;
    try { session = parseSession(current); }
    catch (error) { options.notify(error instanceof Error ? error.message : 'This session cannot be exported.'); return; }
    active = true;
    const dialog = document.createElement('dialog');
    dialog.className = 'explorer-dialog import-dialog';
    dialog.setAttribute('aria-label', 'Export audio');
    dialog.innerHTML = `<h2>Export audio</h2>
      <p>Stereo WAV, 16-bit, 44.1 kHz. Includes tone layers, ASMR and background sounds.</p>
      <p>Starts at the beginning and follows the session timer fade. Shorter exports are cropped.</p>
      <form id="audio-export-form"><label for="export-seconds">Duration in seconds (up to ${MAX_EXPORT_SECONDS})</label>
        <input id="export-seconds" type="number" min="0.05" max="${MAX_EXPORT_SECONDS}" step="any" required />
        <p class="fine-print">Rendering stays on this device. The limit keeps memory use bounded; a full export can use around 100 MB.</p>
        <p id="audio-export-status" role="status" aria-live="polite"></p>
        <div class="import-actions"><button class="save-button" id="start-audio-export" type="submit">Render WAV</button>
          <button class="secondary-button" id="cancel-audio-export" type="button">Cancel</button></div></form>`;
    const input = dialog.querySelector<HTMLInputElement>('#export-seconds')!;
    const duration = session.timelineDuration ?? session.minutes * 60;
    input.value = String(Math.max(0.05, Math.min(60, duration || 60)));
    const start = dialog.querySelector<HTMLButtonElement>('#start-audio-export')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('#cancel-audio-export')!;
    const status = dialog.querySelector<HTMLElement>('#audio-export-status')!;
    let controller: AbortController | undefined;
    const dismiss = (): void => {
      if (!controller) dialog.close();
      else {
        controller.abort();
        cancel.disabled = true;
        status.textContent = 'Export discarded. The browser may finish processing before this window closes.';
      }
    };
    cancel.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('close', () => {
      controller?.abort();
      if (!controller) active = false;
      dialog.remove();
      button.focus();
    }, { once: true });
    dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      if (controller || !input.reportValidity()) return;
      controller = new AbortController();
      start.disabled = input.disabled = true;
      cancel.textContent = 'Discard export';
      status.textContent = 'Rendering locally. Discard prevents downloading; processing may still finish.';
      dialog.setAttribute('aria-busy', 'true');
      void renderWav(session, Number(input.value), controller.signal).then(blob => {
        if (controller!.signal.aborted || !dialog.open) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${session.name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'binaural'}.wav`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        options.notify('WAV export ready.');
        dialog.close();
      }).catch(error => {
        if (controller!.signal.aborted) { dialog.close(); return; }
        status.textContent = error instanceof Error ? error.message : 'Audio export failed.';
      }).finally(() => {
        controller = undefined;
        if (!dialog.open) active = false;
        start.disabled = input.disabled = cancel.disabled = false;
        cancel.textContent = 'Cancel';
        dialog.removeAttribute('aria-busy');
      });
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
