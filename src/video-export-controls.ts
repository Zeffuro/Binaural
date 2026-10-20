import type { Session } from './model';
import type { AudioCaptureLease } from './audio/engine';
import type { WavWriter } from './audio/export-types';
import { recordVideo, supportedVideoFormats, videoBitrates, maxVideoSeconds,
  type VideoProgress } from './video-recording';
import './video-export.css';

interface Capture { canvas: HTMLCanvasElement; draw(): void; dispose(): void }
interface PickerWindow {
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
    Promise<{ createWritable(): Promise<WavWriter> }>;
}
interface Options {
  visual: { createCapture(width: number, height: number, fps?: number): Capture };
  session(): Session;
  remaining(): number | undefined;
  ensurePlaying(): Promise<void>;
  playPause(): Promise<void>;
  captureAudio(): AudioCaptureLease;
  busy(): boolean;
  notify(message: string): void;
}

export function setupVideoExport(options: Options): { active(): boolean } {
  const button = document.querySelector<HTMLButtonElement>('#record-video');
  let active = false;
  button?.addEventListener('click', () => {
    if (active) return;
    active = true;
    const formats = supportedVideoFormats(), picker = (window as Window & PickerWindow).showSaveFilePicker;
    const session = options.session(), duration = options.remaining() ?? session.timelineDuration ?? session.minutes * 60;
    const name = session.name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'binaural';
    const dialog = document.createElement('dialog'); dialog.className = 'explorer-dialog import-dialog video-export-dialog';
    dialog.setAttribute('aria-label', 'Export video');
    dialog.innerHTML = `<h2>Export video</h2>
      <p>Record your selected visual and the audio you hear, including local music. Recording starts or resumes listening and follows the current playhead. Pausing listening pauses the recording.</p>
      <p class="fine-print">This records in real time. Keep this tab visible. Finishing or discarding a video leaves listening running. Local video scenes contribute their picture; their soundtrack stays muted.</p>
      <div id="video-export-preview" aria-label="Video preview"></div>
      <form id="video-export-form">
        <label for="video-export-format">Video format</label><select id="video-export-format"></select>
        <div class="video-export-grid"><div><label for="video-export-size">Resolution</label><select id="video-export-size"><option value="854x480">480p</option><option value="1280x720" selected>720p</option><option value="1920x1080">1080p</option></select></div>
        <div><label for="video-export-fps">Frame rate</label><select id="video-export-fps"><option value="24">24 FPS</option><option value="30" selected>30 FPS</option></select></div></div>
        <label for="video-export-seconds">Maximum recording seconds</label><input id="video-export-seconds" type="number" min="1" max="${maxVideoSeconds}" step="any" required />
        <div class="asmr-actions"><button type="button" class="secondary-button" data-video-time="60">1 minute</button><button type="button" class="secondary-button" data-video-time="300">5 minutes</button><button type="button" class="secondary-button" data-video-time="remaining">Remaining session</button></div>
        <label class="visual-toggle" ${picker ? '' : 'hidden'}><span>Save directly to a video file</span><input id="video-export-direct" type="checkbox" /></label>
        <p id="video-export-estimate" class="fine-print"></p>
        <p class="fine-print">Up to one hour. Downloads stop near 512 MiB; direct saves stop near 2 GiB. Hiding this tab or stopping listening finishes a shorter video. Actual resolution detail follows visual quality.</p>
        <div class="asmr-actions"><button id="video-export-refresh" type="button" class="secondary-button">Refresh preview</button><button id="video-export-choose" type="button" class="secondary-button">Choose a visual</button></div>
        <progress id="video-export-progress" aria-label="Video recording progress" max="1" value="0" hidden></progress>
        <p id="video-export-status" role="status" aria-live="polite"></p>
        <div class="import-actions"><button id="video-export-start" class="save-button" type="submit">Start recording</button><button id="video-export-finish" class="secondary-button" type="button" hidden>Finish video</button><button id="video-export-pause" class="secondary-button" type="button" hidden>Pause listening</button><button id="video-export-cancel" class="secondary-button" type="button">Cancel</button></div>
      </form>`;
    const field = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#video-export-${id}`)!;
    const size = field<HTMLSelectElement>('size'), fps = field<HTMLSelectElement>('fps'), format = field<HTMLSelectElement>('format');
    const seconds = field<HTMLInputElement>('seconds'), direct = field<HTMLInputElement>('direct');
    const start = field<HTMLButtonElement>('start'), finish = field<HTMLButtonElement>('finish'), pause = field<HTMLButtonElement>('pause');
    const cancel = field<HTMLButtonElement>('cancel'), status = field<HTMLElement>('status'), progress = field<HTMLProgressElement>('progress');
    const formControls = [...dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,[data-video-time],#video-export-refresh,#video-export-choose')];
    format.replaceChildren(...formats.map(item => new Option(item.label, item.mimeType)));
    seconds.value = String(Math.max(1, Math.min(60, duration || 60)));
    let capture: Capture | undefined, controller: AbortController | undefined, job: ReturnType<typeof recordVideo> | undefined;
    let audio: AudioCaptureLease | undefined, committing = false, previewRaf = 0, lastPreview = 0;
    let returnFocus: HTMLElement | null | undefined = button;
    const dimensions = () => size.value.split('x').map(Number);
    function estimate(): void {
      const [width, height] = dimensions(), rate = videoBitrates(width, height, Number(fps.value) as 24 | 30);
      const bytes = Number(seconds.value) * (rate.videoBitsPerSecond + rate.audioBitsPerSecond) / 8;
      field('estimate').textContent = `Estimated file size: ${(bytes / 1024 ** 2).toFixed(1)} MiB. ${direct.checked ? 'Written to your chosen file while recording.' : 'The finished video is held in browser memory.'}`;
      dialog.querySelector<HTMLButtonElement>('[data-video-time=remaining]')!.disabled = !duration || duration > maxVideoSeconds || !!controller;
    }
    function preparePreview(): void {
      capture?.dispose(); capture = undefined; field('preview').replaceChildren();
      if (!formats.length) { start.disabled = true; status.textContent = 'Video recording is unavailable in this browser. Audio export is still available.'; return; }
      try {
        const [width, height] = dimensions(); capture = options.visual.createCapture(width, height, Number(fps.value));
        capture.canvas.setAttribute('aria-label', 'Selected visual for video export');
        field('preview').append(capture.canvas); capture.draw(); start.disabled = false;
        status.textContent = 'Ready. Start recording when you want this part of the session.';
      } catch (error) { capture?.dispose(); capture = undefined; start.disabled = true; status.textContent = error instanceof Error ? error.message : 'Choose a visual before recording.'; }
    }
    function preview(time: number): void {
      if (!dialog.open) return;
      if (!controller && capture && time - lastPreview >= 1000 / Number(fps.value)) {
        lastPreview = time;
        try { capture.draw(); }
        catch (error) { capture.dispose(); capture = undefined; start.disabled = true; status.textContent = (error as Error).message; }
      }
      if (job && !committing) pause.textContent = audio?.state() === 'paused' ? 'Resume listening' : 'Pause listening';
      previewRaf = requestAnimationFrame(preview);
    }
    function dismiss(): void {
      if (committing) return;
      if (controller) { controller.abort(); cancel.disabled = true; status.textContent = 'Discarding the recording…'; }
      else dialog.close();
    }
    field<HTMLButtonElement>('refresh').onclick = preparePreview;
    field<HTMLButtonElement>('choose').onclick = () => {
      returnFocus = document.querySelector<HTMLElement>('#scene-mode'); dialog.close();
    };
    size.onchange = fps.onchange = () => { preparePreview(); estimate(); };
    seconds.oninput = direct.onchange = estimate;
    dialog.querySelectorAll<HTMLButtonElement>('[data-video-time]').forEach(choice => choice.onclick = () => {
      seconds.value = String(choice.dataset.videoTime === 'remaining' ? duration : Number(choice.dataset.videoTime)); estimate();
    });
    cancel.onclick = dismiss; finish.onclick = () => { finish.disabled = true; job?.finish(); };
    pause.onclick = () => {
      pause.disabled = true;
      void options.playPause().catch(error => { status.textContent = (error as Error).message; }).finally(() => { pause.disabled = false; });
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('close', () => {
      if (!committing) controller?.abort();
      cancelAnimationFrame(previewRaf); capture?.dispose(); capture = undefined; dialog.remove();
      if (!controller) active = false;
      if (returnFocus !== button) returnFocus?.scrollIntoView({ block: 'center' });
      returnFocus?.focus();
    }, { once: true });
    field<HTMLFormElement>('form').onsubmit = event => {
      event.preventDefault(); if (controller || !capture || !seconds.reportValidity()) return;
      if (options.busy()) { status.textContent = 'Wait for the current audio operation to finish.'; return; }
      const selected = formats.find(item => item.mimeType === format.value);
      if (!selected) return;
      controller = new AbortController(); const signal = controller.signal;
      start.disabled = true; formControls.forEach(control => { control.disabled = true; });
      cancel.textContent = 'Discard recording'; progress.hidden = false; progress.value = 0;
      dialog.setAttribute('aria-busy', 'true'); status.textContent = 'Preparing the recording…';
      let writer: WavWriter | undefined;
      const update = (value: VideoProgress) => {
        if (!dialog.open || signal.aborted) return;
        progress.value = value.fraction;
        if (value.stage === 'saving') { committing = true; cancel.disabled = true; status.textContent = 'Finishing the saved video…'; }
        else if (value.stage === 'finishing') { finish.disabled = pause.disabled = true; status.textContent = 'Finishing the video…'; }
        else status.textContent = audio?.state() === 'paused' ? 'Recording paused with listening.' : `Recorded ${value.seconds.toFixed(1)} of ${seconds.value} seconds, ${(value.bytes / 1024 ** 2).toFixed(1)} MiB.`;
      };
      void (async () => {
        if (direct.checked && picker) {
          const handle = await picker.call(window, { suggestedName: `${name}.${selected.extension}`, types: [{ description: selected.label, accept: { [selected.mimeType.split(';')[0]]: [`.${selected.extension}`] } }] });
          signal.throwIfAborted(); writer = await handle.createWritable();
        }
        signal.throwIfAborted(); capture!.draw(); await options.ensurePlaying(); signal.throwIfAborted();
        audio = options.captureAudio();
        job = recordVideo({ canvas: capture!.canvas, draw: () => capture!.draw(), audio, seconds: Number(seconds.value),
          fps: Number(fps.value) as 24 | 30, mimeType: selected.mimeType, writer, signal, onProgress: update });
        finish.hidden = pause.hidden = false; finish.disabled = pause.disabled = false;
        const result = await job.done;
        if (signal.aborted || !dialog.open) return;
        if (result.blob) {
          const url = URL.createObjectURL(result.blob), link = document.createElement('a');
          link.href = url; link.download = `${name}.${result.extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
        const ending = ({ hidden: ' Tab hidden.', 'audio-stopped': ' Listening stopped.', 'track-ended': ' Capture ended.', 'size-limit': ' File size limit reached.' } as Record<string, string>)[result.reason] ?? '';
        options.notify(`Video ${direct.checked ? 'saved' : 'ready'} (${result.seconds.toFixed(1)} seconds).${ending}`); dialog.close();
      })().catch(async error => {
        if (!job) { audio?.dispose(); if (writer) try { await writer.abort(error); } catch { /* Keep the original recording error. */ } }
        if (signal.aborted) { if (dialog.open) dialog.close(); return; }
        status.textContent = error instanceof Error ? error.message : 'Video recording failed.';
      }).finally(() => {
        controller = undefined; job = undefined; audio = undefined; committing = false;
        if (!dialog.open) active = false;
        else {
          dialog.removeAttribute('aria-busy'); formControls.forEach(control => { control.disabled = false; });
          finish.hidden = pause.hidden = true; cancel.disabled = false; cancel.textContent = 'Cancel'; estimate();
          try { capture?.draw(); start.disabled = !capture; } catch { start.disabled = true; }
        }
      });
    };
    document.body.append(dialog); dialog.showModal(); estimate(); preparePreview(); previewRaf = requestAnimationFrame(preview);
  });
  return { active: () => active };
}
