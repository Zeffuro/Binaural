import { escapeHtml, parseSession, type AutomationPoint, type LayerAutomation, type Session } from './model';
import { valueAt } from './audio/automation';
import './timeline-editor.css';

const lanes = { left: 'Left frequency', right: 'Right frequency', leftLevel: 'Left ear level', rightLevel: 'Right ear level' };
type Lane = keyof typeof lanes;
const MAX_POINTS = 128;

export function setupTimelineEditor(options: {
  session(): Session; apply(next: Session): Promise<void>; isBusy(): boolean;
}): { update(): void } {
  const opener = document.createElement('button');
  opener.id = 'edit-timeline'; opener.className = 'text-button'; opener.textContent = 'Edit tone timeline';
  document.querySelector('#tone-controls .section-heading')!.append(opener);
  const dialog = document.createElement('dialog');
  dialog.className = 'explorer-dialog timeline-editor'; dialog.setAttribute('aria-labelledby', 'timeline-title');
  dialog.innerHTML = `<h2 id="timeline-title">Tone timeline</h2>
    <p>Shape each layer over time. Ear levels multiply the layer volume and follow its ear routing. The session stops at the timeline duration.</p>
    <p id="timeline-editor-status" role="status"></p>
    <form><fieldset class="timeline-fields"><legend class="sr-only">Timeline settings</legend>
      <div class="timeline-selectors"><label>Duration in seconds<input id="timeline-duration" type="number" min="0.01" max="10800" step="any" required /></label>
      <label>Tone layer<select id="timeline-layer" aria-label="Tone layer"></select></label>
      <label>Automation lane<select id="timeline-lane" aria-label="Automation lane">${Object.entries(lanes).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label></div>
      <div id="timeline-lane-editor"></div>
    </fieldset><div class="timeline-actions"><button type="submit" class="save-button">Apply timeline</button><button type="button" class="secondary-button" id="timeline-cancel">Cancel</button></div></form>`;
  document.body.append(dialog);
  const find = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>('form');
  const fields = find<HTMLFieldSetElement>('fieldset');
  const duration = find<HTMLInputElement>('#timeline-duration');
  const layerSelect = find<HTMLSelectElement>('#timeline-layer');
  const laneSelect = find<HTMLSelectElement>('#timeline-lane');
  const editor = find<HTMLDivElement>('#timeline-lane-editor');
  const status = find<HTMLParagraphElement>('#timeline-editor-status');
  const apply = find<HTMLButtonElement>('button[type=submit]');
  let draft: Session;
  let original = '', pending = false, unavailable = '';
  const layer = () => draft.layers[Number(layerSelect.value)];
  const lane = () => laneSelect.value as Lane;
  const points = () => layer().automation![lane()];
  const order = () => { if (layer().automation) points().sort((a, b) => a.time - b.time); };

  function update(): void {
    opener.title = options.isBusy() ? 'Stop playback before editing the tone timeline.' : '';
    if (!dialog.open) return;
    const stale = original !== JSON.stringify(options.session());
    const locked = pending || options.isBusy() || stale || !!unavailable;
    fields.disabled = locked; apply.disabled = locked;
    if (unavailable) status.textContent = unavailable;
    else if (stale) status.textContent = 'The session changed. Cancel and reopen the timeline to edit the current session.';
    else if (options.isBusy()) status.textContent = 'Stop playback and wait for loading to finish before editing the timeline.';
    else if (!pending && status.textContent?.startsWith('Stop playback')) status.textContent = '';
  }

  function plot(): void {
    const svg = editor.querySelector<SVGSVGElement>('svg');
    if (!svg || !layer().automation) return;
    const sorted = [...points()].sort((a, b) => a.time - b.time);
    if (sorted.some(point => !Number.isFinite(point.time) || !Number.isFinite(point.value))) return;
    const end = Number(duration.value);
    if (!(end > 0)) return;
    const level = lane().endsWith('Level');
    const low = level ? 0 : Math.max(20, Math.min(...sorted.map(point => point.value)) - 10);
    const high = level ? 1 : Math.min(2000, Math.max(...sorted.map(point => point.value)) + 10);
    find<HTMLElement>('#timeline-plot-caption').textContent = `${low} to ${high} ${level ? 'level' : 'Hz'}, 0 to ${end} seconds`;
    const x = (time: number) => 36 + Math.min(1, time / end) * 504;
    const y = (value: number) => 146 - (value - low) / (high - low) * 124;
    let path = `M${x(0)},${y(sorted[0].value)}`;
    for (const point of sorted.slice(1)) path += `${point.curve === 'step' ? `H${x(point.time)}V${y(point.value)}` : `L${x(point.time)},${y(point.value)}`}`;
    path += `H${x(end)}`;
    svg.innerHTML = `<title>${escapeHtml(lanes[lane()])} over ${end} seconds</title><path class="timeline-axis" d="M36,18V146H540"/><path class="timeline-curve" d="${path}"/>
      ${sorted.map(point => `<circle cx="${x(point.time)}" cy="${y(point.value)}" r="3"/>`).join('')}
      <text x="36" y="169">0 s</text><text x="540" y="169" text-anchor="end">${end} s</text><text x="36" y="12">${high} ${level ? 'level' : 'Hz'}</text><text x="36" y="139">${low}</text>`;
  }

  function renderLane(): void {
    if (unavailable) { editor.replaceChildren(); return; }
    if (!layer().automation) {
      editor.innerHTML = '<p>This layer uses constant tones. Add automation to create editable start and end points for its four lanes.</p><button type="button" class="secondary-button" id="timeline-enable">Add automation to this layer</button>';
      find<HTMLButtonElement>('#timeline-enable').onclick = () => {
        const voice = layer();
        voice.automation = Object.fromEntries(Object.keys(lanes).map(key => {
          const value = key === 'left' ? voice.left : key === 'right' ? voice.right : 1;
          return [key, [{ time: 0, value, curve: 'step' }, { time: Number(duration.value) || 60, value, curve: 'linear' }]];
        })) as unknown as LayerAutomation;
        renderLane(); find<HTMLInputElement>('[data-point="1"][data-field=value]').focus();
      };
      return;
    }
    const level = lane().endsWith('Level');
    editor.innerHTML = `<svg class="timeline-plot" viewBox="0 0 560 180" role="img" aria-label="${lanes[lane()]} curve"></svg><p id="timeline-plot-caption" class="fine-print"></p>
      <p class="fine-print">Times are seconds. Linear ramps to that point; Step holds the previous value until that point. The first point stays at zero. Values hold after the final point.</p>
      <div class="timeline-keyframes">${points().map((point, index) => `<div class="timeline-point">
        <span class="timeline-point-name">Point ${index + 1}</span>
        <label>Time (s)<input aria-label="Point ${index + 1} time in seconds" type="number" min="0" max="10800" step="any" required value="${point.time}" data-point="${index}" data-field="time" ${index === 0 ? 'readonly' : ''}/></label>
        <label>${level ? 'Level (0–1)' : 'Frequency (Hz)'}<input aria-label="Point ${index + 1} ${level ? 'level' : 'frequency in Hz'}" type="number" min="${level ? 0 : 20}" max="${level ? 1 : 2000}" step="any" required value="${point.value}" data-point="${index}" data-field="value"/></label>
        <label>Curve into point<select aria-label="Point ${index + 1} curve" data-point="${index}" data-field="curve"><option value="linear" ${point.curve === 'linear' ? 'selected' : ''}>Linear</option><option value="step" ${point.curve === 'step' ? 'selected' : ''}>Step</option></select></label>
        <button type="button" class="text-button" data-remove="${index}" aria-label="Remove point ${index + 1}" ${index === 0 ? 'disabled' : ''}>Remove</button></div>`).join('')}</div>
      <div class="timeline-add"><label>New keyframe time (s)<input id="timeline-new-time" type="number" min="0" max="10800" step="any" value="${Number(duration.value)}" /></label><button type="button" class="secondary-button" id="timeline-add">Add keyframe</button><span class="fine-print">${points().length} / ${MAX_POINTS} points in this lane</span></div>`;
    find<HTMLButtonElement>('#timeline-add').disabled = points().length >= MAX_POINTS;
    editor.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.remove); if (index === 0) return;
        points().splice(index, 1); renderLane();
        const target = Math.min(index, points().length - 1);
        find<HTMLInputElement>(`[data-point="${target}"][data-field=value]`).focus();
      };
    });
    find<HTMLButtonElement>('#timeline-add').onclick = () => {
      const input = find<HTMLInputElement>('#timeline-new-time');
      const time = input.valueAsNumber;
      if (!input.reportValidity() || !Number.isFinite(time) || time > Number(duration.value)) {
        status.textContent = 'Choose a keyframe time within the timeline duration.'; return;
      }
      if (points().length >= MAX_POINTS) return;
      const sorted = [...points()].sort((a, b) => a.time - b.time);
      const point: AutomationPoint = { time, value: valueAt(sorted, time), curve: 'linear' };
      points().push(point); order(); const index = points().indexOf(point);
      renderLane(); find<HTMLInputElement>(`[data-point="${index}"][data-field=value]`).focus(); status.textContent = '';
    };
    plot();
  }

  opener.onclick = () => {
    if (pending) return;
    const current = options.session(); original = JSON.stringify(current); draft = structuredClone(current);
    unavailable = current.bwg ? 'BWGen sequences remain read-only. Cancel, then use Make an editable static copy in Tone layers to author a new timeline from its starting tones. That action discards the sequence in the copy.' : '';
    if (!unavailable && current.layers.some(voice => voice.automation && Object.values(voice.automation).some(list => list.length > MAX_POINTS))) {
      unavailable = `This timeline has more than ${MAX_POINTS} points in a lane. The editor cannot edit it; the full timeline is preserved for playback, saving and export.`;
    }
    status.textContent = ''; layerSelect.innerHTML = draft.layers.map((voice, index) => `<option value="${index}">${index + 1}. ${escapeHtml(voice.name)}</option>`).join('');
    layerSelect.value = '0'; laneSelect.value = 'left';
    duration.value = String(draft.timelineDuration ?? (draft.minutes > 0 ? draft.minutes * 60 : 60));
    renderLane(); dialog.showModal(); update();
  };
  layerSelect.onchange = renderLane;
  laneSelect.onchange = renderLane;
  duration.oninput = plot;
  editor.addEventListener('input', event => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (!input.dataset.field || input.dataset.point === undefined) return;
    const point = points()[Number(input.dataset.point)];
    if (input.dataset.field === 'curve') point.curve = input.value as AutomationPoint['curve'];
    else {
      point[input.dataset.field as 'time' | 'value'] = input.value === '' ? NaN : Number(input.value);
      const selected = lane();
      if (input.dataset.point === '0' && input.dataset.field === 'value' && (selected === 'left' || selected === 'right')) layer()[selected] = point.value;
    }
    plot();
  });
  find<HTMLButtonElement>('#timeline-cancel').onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  form.onsubmit = event => {
    event.preventDefault(); update(); if (apply.disabled || !form.reportValidity()) return;
    try {
      draft.timelineDuration = duration.valueAsNumber;
      for (const voice of draft.layers) {
        if (!voice.automation) continue;
        for (const values of Object.values(voice.automation) as AutomationPoint[][]) values.sort((a, b) => a.time - b.time);
      }
      const next = parseSession(draft);
      pending = true; status.textContent = 'Applying timeline…'; update();
      void options.apply(next).then(() => dialog.close()).catch(error => {
        status.textContent = error instanceof Error ? error.message : 'The timeline could not be applied.';
      }).finally(() => { pending = false; update(); });
    } catch (error) {
      status.textContent = error instanceof Error && error.message.includes('automation')
        ? 'Every lane needs a point at zero, valid values and times within the duration. Extend the duration or edit later points; points are never removed automatically.'
        : error instanceof Error ? error.message : 'Check the timeline values.';
    }
  };
  return { update };
}
