import { MAX_EXPORT_SECONDS, MAX_FILE_EXPORT_SECONDS, renderAudio, writeAudio, wavBytes, type AudioExportFormat, type WavProgress, type WavWriter } from './audio/export';
import { parseSession, type Session } from './model';

interface FilePicker {
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WavWriter> }>;
}

export function setupAudioExport(options: {
  session: () => Session;
  music?: () => File | undefined;
  notify: (message: string) => void;
}): void {
  const button = document.querySelector<HTMLButtonElement>('#render-audio');
  if (!button) return;
  let active = false;
  button.addEventListener('click', () => {
    if (active) return;
    const music = options.music?.();
    let session: Session;
    try { session = parseSession(options.session()); }
    catch (error) { options.notify(error instanceof Error ? error.message : 'This session cannot be exported.'); return; }
    active = true;
    const picker = (window as Window & FilePicker).showSaveFilePicker;
    const duration = session.timelineDuration ?? session.minutes * 60;
    const name = session.name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'binaural';
    const dialog = document.createElement('dialog'); dialog.className = 'explorer-dialog import-dialog';
    dialog.setAttribute('aria-label', 'Export audio');
    dialog.innerHTML = `<h2>Export audio</h2>
      <p>Stereo audio, 16-bit, 44.1 kHz. Includes tones, BWGen sequences, ASMR and background sounds. FLAC compresses the same audio without losing quality.</p>
      <p>Starts at the beginning and follows the session timer fade. Shorter exports are cropped. BWGen presets that hold their final values continue for the duration you choose.</p>
      <form id="audio-export-form"><label for="export-format">File format</label>
        <select id="export-format"><option value="wav">WAV</option><option value="flac">FLAC (lossless)</option></select>
        <label class="visual-toggle" ${music ? '' : 'hidden'}><span>Include local music</span><input id="export-music" type="checkbox" checked /></label>
        <p id="export-music-info" class="fine-print" ${music ? '' : 'hidden'}></p>
        <label for="export-seconds">Duration in seconds</label>
        <input id="export-seconds" type="number" min="0.05" max="${MAX_EXPORT_SECONDS}" step="any" required />
        <div class="asmr-actions"><button class="secondary-button" type="button" data-export-time="60">1 minute</button><button class="secondary-button" type="button" data-export-time="300">5 minutes</button><button class="secondary-button" type="button" data-export-time="1200">20 minutes</button><button class="secondary-button" type="button" data-export-time="session">Full session</button></div>
        <label class="visual-toggle" ${picker ? '' : 'hidden'}><span>Save directly to a file</span><input id="export-direct" type="checkbox" /></label>
        <p id="export-estimate" class="fine-print"></p>
        <p class="fine-print">Everything is rendered on this device in sections. Downloads support up to 60 minutes.${picker ? ' Direct saves support up to 3 hours without keeping the finished file in memory.' : ''}</p>
        <progress id="audio-export-progress" max="1" value="0" aria-label="Audio export progress" hidden></progress>
        <p id="audio-export-status" role="status" aria-live="polite"></p>
        <div class="import-actions"><button class="save-button" id="start-audio-export" type="submit">Render WAV</button>
          <button class="secondary-button" id="cancel-audio-export" type="button">Cancel</button></div></form>`;
    const input = dialog.querySelector<HTMLInputElement>('#export-seconds')!, direct = dialog.querySelector<HTMLInputElement>('#export-direct')!;
    const format = dialog.querySelector<HTMLSelectElement>('#export-format')!, includeMusic = dialog.querySelector<HTMLInputElement>('#export-music')!;
    if (music) dialog.querySelector('#export-music-info')!.textContent = `${music.name} starts from the beginning and loops at the music level. The file stays on this device. Music export supports files up to 64 MiB and about 12 minutes of decoded stereo audio.`;
    direct.checked = !!picker && duration > MAX_EXPORT_SECONDS;
    const maximum = () => direct.checked ? MAX_FILE_EXPORT_SECONDS : MAX_EXPORT_SECONDS;
    input.value = String(Math.max(.05, Math.min(maximum(), duration || 60)));
    const start = dialog.querySelector<HTMLButtonElement>('#start-audio-export')!, cancel = dialog.querySelector<HTMLButtonElement>('#cancel-audio-export')!;
    const status = dialog.querySelector<HTMLElement>('#audio-export-status')!, meter = dialog.querySelector<HTMLProgressElement>('#audio-export-progress')!;
    const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,select,[data-export-time]')];
    let controller: AbortController | undefined, finalizing = false;
    function estimate(): void {
      input.max = String(maximum());
      let text = '';
      try {
        const size = (wavBytes(Number(input.value)) / 1024 ** 2).toFixed(1);
        text = `${format.value === 'flac' ? `Uncompressed audio: ${size} MiB. FLAC size depends on the sounds.` : `File size: about ${size} MiB.`} ${direct.checked ? 'Written to your chosen file as it renders.' : 'The finished download is held in browser memory.'}`;
      } catch { text = `Choose a duration up to ${maximum()} seconds.`; }
      start.textContent = `Render ${format.value.toUpperCase()}`;
      dialog.querySelector('#export-estimate')!.textContent = text;
      dialog.querySelector<HTMLButtonElement>('[data-export-time=session]')!.disabled = !duration || duration > maximum() || !!controller;
    }
    input.addEventListener('input', estimate);
    format.addEventListener('change', estimate);
    direct.addEventListener('change', () => { if (Number(input.value) > maximum()) input.value = String(maximum()); estimate(); });
    dialog.querySelectorAll<HTMLButtonElement>('[data-export-time]').forEach(choice => choice.addEventListener('click', () => {
      if (controller) return;
      input.value = String(choice.dataset.exportTime === 'session' ? duration : Number(choice.dataset.exportTime)); estimate();
    }));
    estimate();
    const dismiss = (): void => {
      if (finalizing) return;
      if (!controller) dialog.close();
      else {
        controller.abort(); cancel.disabled = true;
        status.textContent = 'Cancelling. The current render section may finish before this window closes.';
      }
    };
    cancel.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('close', () => {
      if (!finalizing) controller?.abort();
      if (!controller) active = false;
      dialog.remove(); button.focus();
    }, { once: true });
    dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault(); if (controller || !input.reportValidity()) return;
      controller = new AbortController(); finalizing = false;
      const signal = controller.signal, selectedFormat = format.value as AudioExportFormat;
      const filename = `${name}.${selectedFormat}`, mime = `audio/${selectedFormat}`;
      start.disabled = true; controls.forEach(control => { control.disabled = true; });
      cancel.textContent = 'Discard export'; meter.hidden = false; meter.value = 0;
      status.textContent = 'Preparing audio…'; dialog.setAttribute('aria-busy', 'true');
      const progress = (value: WavProgress) => {
        if (!dialog.open || signal.aborted) return;
        meter.value = value.fraction;
        status.textContent = value.stage === 'preparing' ? 'Preparing audio…' : value.stage === 'finishing' ? 'Finishing the audio file…' : `Rendered ${Math.floor(value.completedFrames / 44100)} of ${Math.ceil(value.totalFrames / 44100)} seconds (${Math.floor(value.fraction * 100)}%).`;
        if (value.stage === 'saving') { finalizing = true; cancel.disabled = true; status.textContent = 'Finishing the saved file…'; }
      };
      const exportOptions = { signal, onProgress: progress, format: selectedFormat, music: includeMusic.checked ? music : undefined };
      void (async () => {
        if (direct.checked && picker) {
          const handle = await picker.call(window, { suggestedName: filename, types: [{ description: `${selectedFormat.toUpperCase()} audio`, accept: { [mime]: [`.${selectedFormat}`] } }] });
          signal.throwIfAborted();
          const writer = await handle.createWritable();
          await writeAudio(session, Number(input.value), writer, exportOptions);
        } else {
          const blob = await renderAudio(session, Number(input.value), exportOptions);
          if (signal.aborted || !dialog.open) return;
          const url = URL.createObjectURL(blob), anchor = document.createElement('a');
          anchor.href = url; anchor.download = filename; anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
        if (signal.aborted || !dialog.open) return;
        options.notify(`${selectedFormat.toUpperCase()} ${direct.checked ? 'file saved.' : 'export ready.'}`); dialog.close();
      })().catch(error => {
        if (signal.aborted) { dialog.close(); return; }
        status.textContent = error instanceof Error ? error.message : 'Audio export failed.';
      }).finally(() => {
        controller = undefined; finalizing = false;
        if (!dialog.open) active = false;
        start.disabled = cancel.disabled = false; controls.forEach(control => { control.disabled = false; });
        cancel.textContent = 'Cancel'; dialog.removeAttribute('aria-busy'); estimate();
      });
    });
    document.body.append(dialog); dialog.showModal();
  });
}
