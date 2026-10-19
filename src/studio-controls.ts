interface Actions {
  playPause(): void;
  stop(): void;
  mute(): void;
  fullscreen(): void;
  visual(): void;
  next(direction: number): void;
  undo(): void;
  redo(): void;
  emergency(): void;
}
export function setupStudioControls(actions: Actions) {
  const tools = document.createElement('div'); tools.className = 'studio-tools';
  tools.innerHTML = '<button id="undo-edit" class="secondary-button" disabled>Undo</button><button id="redo-edit" class="secondary-button" disabled>Redo</button><button id="shortcut-help" class="text-button">Keyboard shortcuts</button>';
  document.querySelector('.transport')!.append(tools);
  const bar = document.createElement('div'); bar.className = 'mini-player'; bar.hidden = true;
  bar.innerHTML = '<div class="mini-description"><strong id="mini-title"></strong><span id="mini-clock"></span></div><div class="mini-actions"><button id="mini-play" aria-label="Pause playback">Ⅱ</button><button id="mini-stop" aria-label="Stop playback">■</button><button id="mini-mute" aria-label="Mute tones" aria-pressed="false">Mute</button><button id="mini-visual" aria-label="Open current visualization">Visual</button></div><nav aria-label="Studio sections"><a href="#tone-controls">Tones</a><a href="#atmosphere">Atmosphere</a><a href="#visual-controls">Visuals</a><a href="#preset-name">Save</a></nav>';
  document.body.append(bar);
  const help = document.createElement('dialog'); help.className = 'explorer-dialog shortcuts-dialog'; help.setAttribute('aria-labelledby', 'shortcuts-title');
  help.innerHTML = '<h2 id="shortcuts-title">Keyboard shortcuts</h2><dl><dt>Space</dt><dd>Play or pause</dd><dt>S</dt><dd>Stop audio</dd><dt>M</dt><dd>Mute or unmute tones</dd><dt>V</dt><dd>Toggle visuals</dd><dt>F</dt><dd>Open immersive visual</dd><dt>[ / ]</dt><dd>Previous / next visual</dd><dt>Ctrl/Cmd Z</dt><dd>Undo</dd><dt>Ctrl/Cmd Shift Z or Y</dt><dd>Redo</dd><dt>Escape</dt><dd>Close the current overlay</dd><dt>Shift Escape</dt><dd>Stop audio and visuals</dd><dt>?</dt><dd>This shortcut list</dd></dl><button class="secondary-button">Close shortcuts</button>';
  document.body.append(help);
  const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!;
  button('#undo-edit').onclick = actions.undo; button('#redo-edit').onclick = actions.redo;
  button('#shortcut-help').onclick = () => help.showModal();
  help.querySelector('button')!.onclick = () => help.close();
  button('#mini-play').onclick = actions.playPause; button('#mini-stop').onclick = actions.stop;
  button('#mini-mute').onclick = actions.mute; button('#mini-visual').onclick = actions.fullscreen;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (event.shiftKey) { event.preventDefault(); actions.emergency(); }
      return;
    }
    if (document.querySelector('dialog[open]') || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' || key === 'y') { event.preventDefault(); event.shiftKey || key === 'y' ? actions.redo() : actions.undo(); }
      return;
    }
    if (event.altKey || event.repeat) return;
    if (key === ' ' && (event.target as HTMLElement).closest('button, a, summary')) return;
    const run = ({ ' ': actions.playPause, s: actions.stop, m: actions.mute, v: actions.visual, f: actions.fullscreen,
      '[': () => actions.next(-1), ']': () => actions.next(1), '?': () => help.showModal() } as Record<string, (() => void) | undefined>)[key];
    if (run) { event.preventDefault(); run(); }
  });
  return { update(state: { playing: boolean; paused: boolean; busy: boolean; muted: boolean; clock: string; name: string; undo: boolean; redo: boolean }) {
    bar.hidden = !state.playing; document.body.classList.toggle('has-mini-player', state.playing);
    document.querySelector('#mini-title')!.textContent = state.name; document.querySelector('#mini-clock')!.textContent = state.clock;
    button('#mini-play').textContent = state.paused ? '▶' : 'Ⅱ'; button('#mini-play').setAttribute('aria-label', state.paused ? 'Resume playback' : 'Pause playback');
    for (const id of ['#mini-play', '#mini-stop', '#mini-mute']) button(id).disabled = state.busy;
    button('#mini-mute').setAttribute('aria-pressed', String(state.muted)); button('#mini-mute').textContent = state.muted ? 'Unmute' : 'Mute';
    button('#undo-edit').disabled = !state.undo || state.busy; button('#redo-edit').disabled = !state.redo || state.busy;
  } };
}
