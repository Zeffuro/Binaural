import './style.css';
import './experience.css';
import './scrollbar.css';
import './theme.css';
import './studio-controls.css';
import './accessibility.css';
import { setupTheme } from './theme';
import { AudioEngine } from './audio/engine';
import { frequencies, presets } from './catalog';
import { initialSession, makeLayer, MAX_LAYERS, parseSession, type Layer, type Session } from './model';
import { downloadPreset, loadPresets, storePresets } from './storage';
import { builtinView, frequencyView, layerView, layout, savedView } from './views';
import { setupExplorer, frequencyDetail } from './explorer';
import { asmrPresetLight } from './asmr-explorer';
import { setupVisuals } from './visuals';
import { readBwg } from './import-review';
import { setupBackgrounds } from './background-controls';
import { EditHistory } from './edit-history';
import { setupStudioControls } from './studio-controls';
import { chooseSaveAction, copyName, favoritePreset, libraryPreferences, rememberPreset } from './session-library';
import { readSharedSession, sessionLink } from './share';
import { setupAudioExport } from './export-controls';
import { setupVideoExport } from './video-export-controls';
import { setupSessionGuide } from './session-guide';
import { setupOffline } from './offline';
import { favoriteFrequencies, frequencyKey, isFrequencyFavoriteStorage, toggleFrequencyFavorite } from './frequency-favorites';
import { setupTimelineEditor } from './timeline-editor';
import { setupImmersiveAudio } from './immersive-audio';
import { setupAsmr } from './asmr-controls';
import { listeningMode, modeForSources, modeGains, type ListeningMode } from './listening-mode';
import { setupListeningMode } from './mode-controls';
import { defaultAsmr, makeAsmrLayer } from './asmr-state';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
$('#app').innerHTML = layout;
setupTheme();
$('#builtins').innerHTML = builtinView();
$('#frequencies').innerHTML = frequencyView('', favoriteFrequencies());
let session = initialSession();
let saved: Session[] = [];
let busy = false;
let stopping: Promise<void> | undefined;
let transportRevision = 0;
let experienceRevision = 0;
let musicBusy = false;
let backgroundBusy = false;
let videoExport: ReturnType<typeof setupVideoExport> | undefined;
let noticeTimer: ReturnType<typeof setTimeout>;
const engine = new AudioEngine();
const history = new EditHistory<{ session: Session; saved: Session[] }>();
const visual = setupVisuals(timeline => engine.visualFrame(timeline ?? 'output'), () => { session.visual = visual.getState(); session.version = 2; }, () => { experienceRevision++; checkpoint(); });
const controls = setupStudioControls({
  playPause: () => { void playPause().catch(report); }, stop: () => { void stop().catch(report); }, mute: toggleMute,
  visual: () => { experienceRevision++; checkpoint(); visual.toggle(); }, fullscreen: () => { checkpoint(); visual.fullscreen(); }, next: direction => { experienceRevision++; checkpoint(); visual.next(direction); },
  undo: () => { void undoEdit(false); }, redo: () => { void undoEdit(true); },
  emergency: () => { experienceRevision++; visual.stop(); document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close()); void stop().catch(report); },
});
const immersiveAudio = setupImmersiveAudio({ playPause: () => { void playPause().catch(report); }, stop: () => { void stop().catch(report); }, mute: toggleMute, volume: setMaster });
const offline = setupOffline({ isPlaying: () => busy || engine.playing || !!videoExport?.active() });
const timeline = setupTimelineEditor({ session: () => snapshot().session, apply: applyTimeline, isBusy: () => busy || engine.playing || musicBusy || backgroundBusy });
$('#scene-mute-tones').addEventListener('click', toggleMute);
setupAudioExport({ session: () => snapshot().session, music: () => engine.selectedMusicFile, notify: message => notice(message) });
videoExport = setupVideoExport({ visual, session: () => snapshot().session, remaining: () => engine.remaining,
  ensurePlaying: async () => {
    if (!engine.playing || engine.paused) await playPause();
    if (!engine.playing || engine.paused) throw new Error('Start listening before recording a video.');
  }, playPause, captureAudio: () => engine.captureAudio(), busy: () => busy || musicBusy || backgroundBusy,
  notify: message => notice(message) });
const backgrounds = setupBackgrounds({ session: () => session, notify: message => notice(message),
  busy: value => { backgroundBusy = value; renderTransport(); }, source: value => { session.bwgBackgroundSource = value; } });
setupExplorer(async (preset, play) => {
  const revision = ++experienceRevision, current = () => revision === experienceRevision;
  const light = asmrPresetLight(preset.id), approved = visual.asmrApproved();
  await useSession(preset.session, current);
  if (!current()) return;
  if (light) await visual.applyAsmrTrigger(light, approved);
  if (play && current()) await playPause();
});
setupSessionGuide({ load: useSession, start: playPause });
const asmr = setupAsmr({ get: () => session.asmr, beforeEdit: checkpoint, busy: () => busy || musicBusy || backgroundBusy,
  enabled: () => !!modeGains(listeningMode(session)).asmr,
  enable() { session.mode = modeForSources(!!modeGains(listeningMode(session)).tones, true); session.version = 2; engine.update(session); modes.refresh(); },
  update(value, light) {
    const previousMode = listeningMode(session);
    session.asmr = value; session.version = 2;
    session.mode = previousMode;
    engine.update(session);
    if (light) void visual.applyAsmrTrigger(light).then(enabled => { notice(enabled ? 'Sounds and lights ready. Start listening when you want.' : 'Sounds loaded. Your visual is unchanged.'); }).catch(report);
    modes.refresh();
  },
  isolate() { session.mode = 'asmr'; engine.update(session); renderSession(); },
  importedMute: () => session.bwg ? !!session.bwgMuted : undefined,
  muteImported(value) { session.bwgMuted = value; engine.update(session); },
});
const modes = setupListeningMode({ get: () => listeningMode(session), change: setListeningMode, busy: () => busy || musicBusy || backgroundBusy });
function setListeningMode(mode: ListeningMode): void {
  if (busy || musicBusy || backgroundBusy || mode === listeningMode(session)) return;
  checkpoint(); session.mode = mode; session.version = 2;
  if (modeGains(mode).asmr && !session.asmr?.layers.length) session.asmr = { ...(session.asmr ?? defaultAsmr()), layers: [makeAsmrLayer('brush')] };
  engine.update(session); renderSession();
}
$('#frequency-count').textContent = `${frequencies.length} frequencies to explore`;

function notice(message: string, undoable = false): void {
  $('#notice').textContent = message;
  if (undoable) { const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Undo'; button.onclick = () => { void undoEdit(false); }; $('#notice').append(' ', button); }
  $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6500);
}
const report = (error: unknown): void => notice(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
try { saved = loadPresets(); } catch { notice('Saved presets could not be read. You can still import a JSON backup.'); }

function renderSaved(): void {
  $('#saved').innerHTML = savedView(saved, libraryPreferences(), $<HTMLSelectElement>('#saved-filter').value);
  $('#saved-count').textContent = String(saved.length);
}
function renderLayers(): void {
  $('#layers').innerHTML = session.layers.map((layer, i) => layerView(layer, i, session.layers.length === 1)).join('');
  for (const layer of session.layers.filter(item => item.automation || session.bwg)) {
    const container = document.querySelector(`[data-layer="${layer.id}"]`)!;
    container.querySelectorAll<HTMLInputElement>('[data-field=left], [data-field=right], [data-field=route]').forEach(input => {
      input.disabled = true;
      input.title = session.bwg ? 'This value follows the BWGen sequence. Make a static copy to edit its starting tones.' : 'This value follows the tone timeline. Use Edit tone timeline or make a static copy.';
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
    $('#timeline-label').textContent = `${session.bwg ? 'Imported BWGen timeline' : 'Tone timeline'}: ${Number((session.timelineDuration / 60).toFixed(2))} min. Tone values show the start of the sequence.`;
  }
}
function setName(name: string): void {
  session.name = name;
  $('#session-label').textContent = name;
  $('#playing-title').textContent = name;
}
function renderSession(): void {
  setName(session.name);
  $<HTMLInputElement>('#master').max = session.volumeBoost ? '2' : '1';
  $<HTMLInputElement>('#volume-boost').checked = !!session.volumeBoost;
  $<HTMLInputElement>('#preset-name').value = session.name;
  for (const [selector, value] of [
    ['#master', session.master], ['#ambient-level', session.ambientLevel],
    ['#music-level', session.musicLevel], ['#minutes', session.timelineDuration === undefined ? session.minutes : session.timelineDuration / 60], ['#ambient', session.ambient],
  ] as const) $<HTMLInputElement>(selector).value = String(value);
  $('#master-value').textContent = `${Math.round(session.master * 100)}%`;
  $('#ambient-value').textContent = `${Math.round(session.ambientLevel * 100)}%`;
  $('#music-value').textContent = `${Math.round(session.musicLevel * 100)}%`;
  renderLayers();
  renderTransport();
  backgrounds.refresh();
  asmr.refresh();
}
function renderTransport(): void {
  offline.update();
  timeline.update();
  asmr.transport();
  modes.refresh();
  const playing = engine.playing;
  $('#play').innerHTML = `<span aria-hidden="true">${playing ? '■' : '▶'}</span><span>${playing ? 'Stop listening' : 'Start listening'}</span>`;
  $('#play').classList.toggle('is-playing', playing);
  $<HTMLButtonElement>('#play').disabled = busy || musicBusy || backgroundBusy;
  $('#pause').hidden = !playing;
  $('#pause').textContent = engine.paused || engine.state === 'suspended' ? '▶ Resume' : 'Ⅱ Pause';
  $<HTMLButtonElement>('#pause').disabled = busy || musicBusy;
  $<HTMLButtonElement>('#music-button').disabled = busy || musicBusy;
  $<HTMLButtonElement>('#remove-music').disabled = busy || musicBusy;
  $<HTMLInputElement>('#minutes').disabled = playing || busy || session.timelineDuration !== undefined;
  $<HTMLInputElement>('#volume-boost').disabled = busy || musicBusy || backgroundBusy;
  $<HTMLButtonElement>('#make-static').disabled = playing || busy;
  backgrounds.transport(playing || busy || musicBusy);
  $('#status').textContent = engine.paused ? 'Ⅱ Paused' : playing ? (engine.loadingAsmr ? 'Loading ASMR recording…' : engine.state === 'running' ? '● Listening' : 'Audio suspended. Press Resume') : 'Ready when you are';
  $('#status').classList.toggle('active', playing);
  document.body.classList.toggle('listening', playing && !engine.paused);
  visual.transport(playing && !engine.paused && engine.state === 'running');
  const seconds = engine.remaining ?? session.timelineDuration ?? (session.minutes ? session.minutes * 60 : undefined);
  $('#clock').textContent = engine.holding ? '∞ holding final values' : seconds === undefined ? '∞' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  $('#scene-mute-tones').textContent = session.tonesMuted ? 'Unmute tone layers' : 'Mute tone layers';
  $('#scene-mute-tones').setAttribute('aria-pressed', String(!!session.tonesMuted));
  controls.update({ playing, paused: engine.paused || engine.state === 'suspended', busy, muted: !!session.tonesMuted,
    clock: $('#clock').textContent!, name: session.name, undo: history.canUndo, redo: history.canRedo });
  immersiveAudio.update({ playing, paused: engine.paused || engine.state === 'suspended', busy: busy || musicBusy || backgroundBusy,
    muted: !!session.tonesMuted, clock: $('#clock').textContent!, name: session.name, volume: session.master, volumeBoost: !!session.volumeBoost });
}
function setMaster(value: number): void {
  if (busy || musicBusy || backgroundBusy || !Number.isFinite(value)) { $<HTMLInputElement>('#master').value = String(session.master); return; }
  session.master = Math.max(0, Math.min(session.volumeBoost ? 2 : 1, value));
  $<HTMLInputElement>('#master').value = String(session.master); $('#master-value').textContent = `${Math.round(session.master * 100)}%`;
  engine.update(session); renderTransport();
}
function snapshot(): { session: Session; saved: Session[] } { return structuredClone({ session: { ...session, version: 2 as const, visual: visual.getState() }, saved }); }
$('#volume-boost').addEventListener('change', event => {
  if (busy || musicBusy || backgroundBusy) { $<HTMLInputElement>('#volume-boost').checked = !!session.volumeBoost; return; }
  checkpoint(); session.volumeBoost = (event.target as HTMLInputElement).checked;
  session.master = Math.min(session.master, session.volumeBoost ? 2 : 1);
  engine.update(session); renderSession();
});
async function applyTimeline(next: Session): Promise<void> {
  if (busy || engine.playing || musicBusy || backgroundBusy) throw new Error('Stop listening before applying a timeline.');
  const parsed = parseSession(next); checkpoint(); await stop(); session = parsed; renderSession();
  notice('Timeline updated. Start listening when ready.');
}
function checkpoint(): void { history.record(snapshot()); }
function toggleMute(): void {
  if (busy) return; checkpoint(); session.tonesMuted = !session.tonesMuted;
  engine.update(session); renderTransport();
}
async function undoEdit(redo: boolean): Promise<void> {
  if (busy) return;
  const current = snapshot(); const next = redo ? history.redo(current) : history.undo(current); if (!next) return;
  try {
    if (JSON.stringify(saved) !== JSON.stringify(next.saved)) storePresets(next.saved);
    const visualsChanged = JSON.stringify(current.session.visual) !== JSON.stringify(next.session.visual);
    await stop(); session = next.session; saved = next.saved; if (visualsChanged) visual.restore(session.visual); renderSaved(); renderSession(); notice(redo ? 'Edit restored.' : 'Edit undone.');
  } catch (error) { redo ? history.undo(next) : history.redo(next); report(error); }
}
async function playPause(): Promise<void> {
  if (busy || musicBusy || backgroundBusy) return;
  const ticket = ++transportRevision;
  busy = true; renderTransport();
  try {
    if (!engine.playing) { await engine.start(session); rememberPreset(session.name); renderSaved(); }
    else if (engine.paused || engine.state === 'suspended') await engine.resume();
    else await engine.pause();
  } finally { if (ticket === transportRevision) busy = !!stopping; renderTransport(); }
}
function stop(): Promise<void> {
  if (stopping) return stopping;
  ++transportRevision;
  busy = true;
  renderTransport();
  stopping = engine.stop().finally(() => { stopping = undefined; busy = false; renderTransport(); });
  return stopping;
}
async function useSession(next: Session, current: () => boolean = () => true): Promise<void> {
  if (busy) throw new Error('Playback is still changing. Wait a moment, then load this preset again.');
  const parsed = parseSession(next); checkpoint();
  await stop();
  if (!current()) return;
  session = parsed;
  visual.restore(session.visual);
  renderSession();
  notice('Preset loaded. Press Start listening when you’re ready.');
}
function addLayer(layer: Layer): void {
  if (session.layers.length >= MAX_LAYERS) { notice(`Up to ${MAX_LAYERS} layers fit in a session.`); return; }
  checkpoint(); session.layers.push(layer); session.mode = modeForSources(true, !!modeGains(listeningMode(session)).asmr); session.version = 2;
  renderLayers();
  modes.refresh();
  engine.update(session);
}

$('#play').addEventListener('click', async () => {
  if (busy) return;
  if (engine.playing) { await stop(); return; }
  try { await playPause(); } catch (error) { report(error); }
});
$('#pause').addEventListener('click', () => { void playPause().catch(report); });
$('#add-layer').addEventListener('click', () => addLayer(makeLayer()));
$('#make-static').addEventListener('click', () => {
  if (engine.playing || busy) return;
  checkpoint();
  const minutes = session.timelineDuration === undefined ? session.minutes : session.timelineDuration / 60;
  for (const layer of session.layers) delete layer.automation;
  delete session.bwg;
  delete session.bwgBackgroundSource;
  for (const layer of session.layers) {
    layer.left = Math.min(2000, Math.max(20, layer.left));
    layer.right = Math.min(2000, Math.max(20, layer.right));
  }
  delete session.timelineDuration;
  session.minutes = Math.min(180, Math.max(1, Math.round(minutes)));
  renderSession();
  notice('Static copy created from the starting tones. The original timeline is no longer active.');
});
$('#layers').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
  if (!button || session.layers.length === 1) return;
  checkpoint();
  session.layers = session.layers.filter(layer => layer.id !== button.dataset.remove);
  renderLayers();
  engine.update(session);
  notice('Tone layer removed.', true);
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
function renderFrequencies(): void {
  $('#frequencies').innerHTML = frequencyView($<HTMLInputElement>('#frequency-search').value, favoriteFrequencies(), $<HTMLSelectElement>('#frequency-filter').value === 'favorites');
}
$('#frequency-search').addEventListener('input', renderFrequencies);
$('#frequency-filter').addEventListener('change', renderFrequencies);
$('#frequency-detail').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-favorite-frequency]');
  if (!button) return;
  try { button.setAttribute('aria-pressed', String(toggleFrequencyFavorite(Number(button.dataset.favoriteFrequency)))); renderFrequencies(); }
  catch (error) { report(error); }
});
window.addEventListener('storage', event => {
  if (!isFrequencyFavoriteStorage(event.key)) return;
  renderFrequencies();
  const button = document.querySelector<HTMLButtonElement>('[data-favorite-frequency]');
  const frequency = button && frequencies[Number(button.dataset.favoriteFrequency)];
  if (frequency) button!.setAttribute('aria-pressed', String(favoriteFrequencies().has(frequencyKey(frequency))));
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
  const favorite = target.closest<HTMLElement>('[data-favorite]');
  if (favorite) { try { favoritePreset(saved[Number(favorite.dataset.favorite)].name); renderSaved(); } catch (error) { report(error); } return; }
  const duplicate = target.closest<HTMLElement>('[data-duplicate]');
  if (duplicate) {
    try {
      const copy = parseSession(saved[Number(duplicate.dataset.duplicate)]); copy.name = copyName(copy.name, saved);
      const next = [...saved, copy]; storePresets(next); checkpoint(); saved = next; renderSaved(); notice('Preset duplicated.', true);
    } catch (error) { report(error); } return;
  }
  const remove = target.closest<HTMLElement>('[data-delete]');
  if (!remove) return;
  try {
    const next = saved.filter((_, i) => i !== Number(remove.dataset.delete));
    storePresets(next);
    checkpoint();
    saved = next;
    renderSaved();
    notice('Preset removed from this browser.', true);
  } catch (error) { report(error); }
});
$('#saved-filter').addEventListener('change', renderSaved);
document.addEventListener('focusin', event => {
  if ((event.target as HTMLElement).closest('#layers, #master, #ambient, #ambient-level, #music-level, #minutes, #preset-name, #visual-controls, #visual-quick, #visual-dock, .immersive-volume input')) checkpoint();
});
for (const [selector, field, output] of [
  ['#master', 'master', '#master-value'], ['#ambient-level', 'ambientLevel', '#ambient-value'],
  ['#music-level', 'musicLevel', '#music-value'],
] as const) {
  $(selector).addEventListener('input', event => {
    if (field === 'master') { setMaster(Number((event.target as HTMLInputElement).value)); return; }
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
$('#save-preset').addEventListener('click', async () => {
  try {
    const value = parseSession(snapshot().session);
    let index = saved.findIndex(item => item.name === value.name);
    if (index >= 0) {
      const action = await chooseSaveAction(value.name); if (!action) return;
      if (action === 'copy') { value.name = copyName(value.name, saved); index = -1; }
    }
    const next = [...saved];
    if (index < 0) next.push(value); else next[index] = value;
    storePresets(next);
    checkpoint();
    saved = next;
    renderSaved();
    notice(index < 0 ? 'Preset saved in this browser.' : 'Preset updated in this browser.', true);
  } catch (error) { report(error); }
});
$('#export').addEventListener('click', () => downloadPreset(snapshot().session));
$('#share-session').addEventListener('click', () => {
  try {
    const link = sessionLink(snapshot().session);
    const dialog = document.createElement('dialog'); dialog.className = 'explorer-dialog share-dialog'; dialog.setAttribute('aria-label', 'Share session');
    const heading = document.createElement('h2'); heading.textContent = 'Share session';
    const info = document.createElement('p'); info.textContent = 'This link contains tones, ASMR and visual settings. Local audio, photos, videos and flash consent are excluded. Opening it never starts playback.';
    const field = document.createElement('input'); field.readOnly = true; field.value = link; field.setAttribute('aria-label', 'Session link');
    const copy = document.createElement('button'); copy.className = 'secondary-button'; copy.textContent = 'Copy link';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    copy.onclick = () => {
      const manual = () => { field.select(); message.textContent = 'Select and copy the link above.'; };
      if (!navigator.clipboard) { manual(); return; }
      void navigator.clipboard.writeText(link).then(() => { message.textContent = 'Link copied.'; }).catch(manual);
    };
    const close = document.createElement('button'); close.className = 'secondary-button'; close.textContent = 'Close share'; close.onclick = () => dialog.close();
    dialog.append(heading, info, field, copy, close, message); dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
  } catch (error) { report(error); }
});
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
function loadLink(): void {
  try { const shared = readSharedSession(); if (shared) void useSession(shared).then(() => notice('Shared session loaded. Start listening when ready.')).catch(report); }
  catch (error) { report(error); }
}
window.addEventListener('hashchange', loadLink);
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
loadLink();
