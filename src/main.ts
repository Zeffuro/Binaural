import './style.css';
import './experience.css';
import './scrollbar.css';
import './theme.css';
import { setupTheme } from './theme';
import { AudioEngine } from './audio/engine';
import { frequencies, presets } from './catalog';
import { initialSession, makeLayer, MAX_LAYERS, parseSession, type Layer, type Session } from './model';
import { downloadPreset, loadPresets, storePresets } from './storage';
import { builtinView, frequencyView, layerView, layout, savedView } from './views';
import { setupExplorer, frequencyDetail } from './explorer';
import { setupVisuals } from './visuals';
import { readBwg } from './import-review';
import { setupBackgrounds } from './background-controls';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
$('#app').innerHTML = layout;
setupTheme();
$('#builtins').innerHTML = builtinView();
$('#frequencies').innerHTML = frequencyView();
let session = initialSession();
let saved: Session[] = [];
let busy = false;
let musicBusy = false;
let backgroundBusy = false;
let noticeTimer: ReturnType<typeof setTimeout>;
const engine = new AudioEngine();
const visual = setupVisuals(() => engine.visualFrame());
$('#scene-mute-tones').addEventListener('click', () => {
  session.layers.forEach(layer => { layer.level = 0; });
  engine.update(session);
  renderLayers();
  notice('Tone layers muted. Background sounds and your soundtrack keep their own levels.');
});
const backgrounds = setupBackgrounds({ session: () => session, notify: message => notice(message),
  busy: value => { backgroundBusy = value; renderTransport(); }, source: value => { session.bwgBackgroundSource = value; } });
setupExplorer(async preset => { await useSession(preset.session); });
$('#frequency-count').textContent = `${frequencies.length} frequencies to explore`;

function notice(message: string): void {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6500);
}
const report = (error: unknown): void => notice(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
try { saved = loadPresets(); } catch { notice('Saved presets could not be read. You can still import a JSON backup.'); }

function renderSaved(): void {
  $('#saved').innerHTML = savedView(saved);
  $('#saved-count').textContent = String(saved.length);
}
function renderLayers(): void {
  $('#layers').innerHTML = session.layers.map((layer, i) => layerView(layer, i, session.layers.length === 1)).join('');
  for (const layer of session.layers.filter(item => item.automation || session.bwg)) {
    const container = document.querySelector(`[data-layer="${layer.id}"]`)!;
    container.querySelectorAll<HTMLInputElement>('[data-field=left], [data-field=right], [data-field=route]').forEach(input => {
      input.disabled = true;
      input.title = 'This value follows the imported timeline. Make a static copy to edit it.';
    });
  }
  $('#layer-count').textContent = `${session.layers.length} / ${MAX_LAYERS}`;
  $<HTMLButtonElement>('#add-layer').disabled = session.layers.length >= MAX_LAYERS;
  if (session.bwg) {
    $<HTMLButtonElement>('#add-layer').disabled = true;
    document.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => { button.disabled = true; });
  }
  $('#timeline-info').hidden = !session.timelineDuration;
  if (session.timelineDuration) {
    $('#timeline-label').textContent = `Imported timeline: ${Number((session.timelineDuration / 60).toFixed(2))} min. Tone values show the start of the sequence.`;
  }
}
function setName(name: string): void {
  session.name = name;
  $('#session-label').textContent = name;
  $('#playing-title').textContent = name;
}
function renderSession(): void {
  setName(session.name);
  $<HTMLInputElement>('#preset-name').value = session.name;
  for (const [selector, value] of [
    ['#master', session.master], ['#ambient-level', session.ambientLevel],
    ['#music-level', session.musicLevel], ['#minutes', session.minutes], ['#ambient', session.ambient],
  ] as const) $<HTMLInputElement>(selector).value = String(value);
  $('#master-value').textContent = `${Math.round(session.master * 100)}%`;
  $('#ambient-value').textContent = `${Math.round(session.ambientLevel * 100)}%`;
  $('#music-value').textContent = `${Math.round(session.musicLevel * 100)}%`;
  renderLayers();
  renderTransport();
  backgrounds.refresh();
}
function renderTransport(): void {
  const playing = engine.playing;
  $('#play').innerHTML = playing ? '■ <span>Stop listening</span>' : '▶ <span>Start listening</span>';
  $('#play').classList.toggle('is-playing', playing);
  $<HTMLButtonElement>('#play').disabled = busy || musicBusy || backgroundBusy;
  $('#pause').hidden = !playing;
  $('#pause').textContent = engine.paused || engine.state === 'suspended' ? '▶ Resume' : 'Ⅱ Pause';
  $<HTMLButtonElement>('#pause').disabled = busy || musicBusy;
  $<HTMLButtonElement>('#music-button').disabled = busy || musicBusy;
  $<HTMLButtonElement>('#remove-music').disabled = busy || musicBusy;
  $<HTMLInputElement>('#minutes').disabled = playing || busy || session.timelineDuration !== undefined;
  $<HTMLButtonElement>('#make-static').disabled = playing || busy;
  backgrounds.transport(playing || busy || musicBusy);
  $('#status').textContent = engine.paused ? 'Ⅱ Paused' : playing ? (engine.state === 'running' ? '● Listening' : 'Audio suspended. Press Resume') : 'Ready when you are';
  $('#status').classList.toggle('active', playing);
  document.body.classList.toggle('listening', playing && !engine.paused);
  visual.transport(playing && !engine.paused && engine.state === 'running');
  const seconds = engine.remaining ?? session.timelineDuration ?? (session.minutes ? session.minutes * 60 : undefined);
  $('#clock').textContent = engine.holding ? '∞ holding final values' : seconds === undefined ? '∞' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
async function stop(): Promise<void> {
  busy = true;
  renderTransport();
  try { await engine.stop(); } finally { busy = false; renderTransport(); }
}
async function useSession(next: Session): Promise<void> {
  if (busy) throw new Error('Playback is still changing. Wait a moment, then load this preset again.');
  await stop();
  session = parseSession(next);
  renderSession();
  notice('Preset loaded. Press Start listening when you’re ready.');
}
function addLayer(layer: Layer): void {
  if (session.layers.length >= MAX_LAYERS) { notice(`Up to ${MAX_LAYERS} layers fit in a session.`); return; }
  session.layers.push(layer);
  renderLayers();
  engine.update(session);
}

$('#play').addEventListener('click', async () => {
  if (busy) return;
  if (engine.playing) { await stop(); return; }
  busy = true;
  renderTransport();
  try { await engine.start(session); } catch (error) { report(error); }
  finally { busy = false; renderTransport(); }
});
$('#pause').addEventListener('click', async () => {
  if (busy || musicBusy) return;
  busy = true;
  renderTransport();
  try {
    if (engine.paused || engine.state === 'suspended') await engine.resume();
    else await engine.pause();
  } catch (error) { report(error); }
  finally { busy = false; renderTransport(); }
});
$('#add-layer').addEventListener('click', () => addLayer(makeLayer()));
$('#make-static').addEventListener('click', () => {
  if (engine.playing || busy) return;
  for (const layer of session.layers) delete layer.automation;
  delete session.bwg;
  delete session.bwgBackgroundSource;
  for (const layer of session.layers) {
    layer.left = Math.min(2000, Math.max(20, layer.left));
    layer.right = Math.min(2000, Math.max(20, layer.right));
  }
  delete session.timelineDuration;
  session.minutes = Math.min(180, Math.max(1, Math.round(session.minutes)));
  renderSession();
  notice('Static copy created from the starting tones. The original timeline is no longer active.');
});
$('#layers').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
  if (!button || session.layers.length === 1) return;
  session.layers = session.layers.filter(layer => layer.id !== button.dataset.remove);
  renderLayers();
  engine.update(session);
});
$('#layers').addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  const container = input.closest<HTMLElement>('[data-layer]');
  const layer = session.layers.find(item => item.id === container?.dataset.layer);
  if (!layer || !input.dataset.field || !input.checkValidity() || input.value === '') return;
  const field = input.dataset.field;
  if (field === 'left' || field === 'right' || field === 'level') layer[field] = Number(input.value);
  else if (field === 'name') layer.name = input.value.trim() || 'Custom tone';
  else if (field === 'route') layer.route = input.value as Layer['route'];
  container!.querySelector('[data-beat]')!.textContent = Math.abs(layer.right - layer.left).toFixed(1);
  container!.querySelector('output')!.textContent = `${Math.round(layer.level * 100)}%`;
  engine.update(session);
});
$('#layers').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity() || input.value === '') {
    notice('Tone frequencies must be 20–2000 Hz. The previous value is still in use.');
    renderLayers();
  }
});
$('#frequencies').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-frequency]');
  if (!button) return;
  const frequency = frequencies[Number(button.dataset.frequency)];
  const layer = frequency.kind === 'beat'
    ? makeLayer(200, 200 + frequency.hz, `${frequency.label}: ${frequency.hz} Hz beat`)
    : { ...makeLayer(frequency.hz, frequency.hz, `${frequency.label}: ${frequency.hz} Hz`), route: 'mixed' as const };
  addLayer(layer);
  $('#frequency-detail').innerHTML = frequencyDetail(Number(button.dataset.frequency));
  $('#frequency-detail').hidden = false;
  if (frequency.kind === 'carrier') notice(`${frequency.hz} Hz carrier added equally to both ears. Edit Left / Right to add a beat difference.`);
});
$('#frequency-search').addEventListener('input', event => {
  $('#frequencies').innerHTML = frequencyView((event.target as HTMLInputElement).value);
});
$('#builtins').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-preset]');
  const preset = presets.find(item => item.id === button?.dataset.preset);
  if (!preset || busy) return;
  document.querySelectorAll('.preset-card').forEach(item => item.classList.toggle('selected', item === button));
  void useSession(preset.session).catch(report);
});
$('#saved').addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const load = target.closest<HTMLElement>('[data-saved]');
  if (load) { void useSession(saved[Number(load.dataset.saved)]).catch(report); return; }
  const remove = target.closest<HTMLElement>('[data-delete]');
  if (!remove) return;
  try {
    const next = saved.filter((_, i) => i !== Number(remove.dataset.delete));
    storePresets(next);
    saved = next;
    renderSaved();
    notice('Preset removed from this browser.');
  } catch (error) { report(error); }
});
for (const [selector, field, output] of [
  ['#master', 'master', '#master-value'], ['#ambient-level', 'ambientLevel', '#ambient-value'],
  ['#music-level', 'musicLevel', '#music-value'],
] as const) {
  $(selector).addEventListener('input', event => {
    session[field] = Number((event.target as HTMLInputElement).value);
    $(output).textContent = `${Math.round(session[field] * 100)}%`;
    engine.update(session);
  });
}
$('#ambient').addEventListener('change', event => {
  session.ambient = (event.target as HTMLSelectElement).value as Session['ambient'];
  engine.update(session);
});
$('#minutes').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.value === '' || !input.checkValidity()) { input.value = String(session.minutes); return; }
  session.minutes = Number(input.value);
  renderTransport();
});
$('#preset-name').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  setName(input.value.trim() || 'Untitled session');
  input.value = session.name;
});
$('#save-preset').addEventListener('click', () => {
  try {
    const snapshot = parseSession(session);
    const index = saved.findIndex(item => item.name === snapshot.name);
    const next = [...saved];
    if (index < 0) next.push(snapshot); else next[index] = snapshot;
    storePresets(next);
    saved = next;
    renderSaved();
    notice(index < 0 ? 'Preset saved in this browser. Export JSON for a portable backup.' : 'Preset updated in this browser.');
  } catch (error) { report(error); }
});
$('#export').addEventListener('click', () => downloadPreset(session));
$('#import-button').addEventListener('click', () => $<HTMLInputElement>('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith('.bwg')) { await readBwg(file, useSession); return; }
    if (file.size > 12 * 1024 * 1024) throw new Error('JSON preset files must be smaller than 12 MB.');
    const next = parseSession(JSON.parse(await file.text()));
    await useSession(next);
  } catch (error) { report(error); }
  finally { input.value = ''; }
});
$('#music-button').addEventListener('click', () => $<HTMLInputElement>('#music-file').click());
$('#music-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || busy || musicBusy) return;
  musicBusy = true;
  input.disabled = true;
  renderTransport();
  try {
    await engine.setMusic(file);
    $('#music-name').textContent = file.name;
    $('#remove-music').hidden = false;
    notice('Local soundtrack selected. It will loop during playback.');
  } catch {
    $('#music-name').textContent = 'Bring a little of your world.';
    $('#remove-music').hidden = true;
    notice('This audio file could not be played. Try WAV, MP3, or Ogg supported by your browser.');
  } finally { input.value = ''; input.disabled = false; musicBusy = false; renderTransport(); }
});
$('#remove-music').addEventListener('click', async () => {
  await engine.setMusic();
  $('#music-name').textContent = 'Bring a little of your world.';
  $('#remove-music').hidden = true;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    visual.stop();
    void stop().catch(report);
  }
});
setInterval(() => {
  if (busy) return;
  if (engine.playing && engine.failure) {
    const message = engine.failure;
    void stop().then(() => notice(message)).catch(report);
    return;
  }
  if (engine.playing && engine.remaining === 0 && !engine.holding) {
    void stop().then(() => notice('Session complete. Take your time.')).catch(report);
  } else renderTransport();
}, 500);
renderSaved();
renderSession();
