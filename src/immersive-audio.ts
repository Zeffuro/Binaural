interface AudioState {
  playing: boolean; paused: boolean; busy: boolean; muted: boolean;
  clock: string; name: string; volume: number;
}

export function setupImmersiveAudio(actions: { playPause(): void; stop(): void; mute(): void; volume(value: number): void }) {
  const rows = [...document.querySelectorAll<HTMLDialogElement>('.scene-stage, .light-stage')].map(stage => {
    const bar = document.createElement('div'); bar.className = 'immersive-audio immersive-toolbar';
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Audio controls');
    bar.innerHTML = `<div class="immersive-track"><strong></strong><span class="immersive-clock"></span></div>
      <div class="immersive-playback"><button class="secondary-button immersive-play">Play audio</button><button class="secondary-button immersive-stop">Stop audio</button><button class="secondary-button immersive-mute" aria-pressed="false">Mute tones</button></div>
      <label class="immersive-volume">Volume<input type="range" aria-label="Volume" min="0" max="1" step="0.01" /><output></output></label>`;
    stage.append(bar);
    const play = bar.querySelector<HTMLButtonElement>('.immersive-play')!;
    const stop = bar.querySelector<HTMLButtonElement>('.immersive-stop')!;
    const mute = bar.querySelector<HTMLButtonElement>('.immersive-mute')!;
    const volume = bar.querySelector('input')!;
    play.onclick = actions.playPause; stop.onclick = actions.stop; mute.onclick = actions.mute;
    volume.addEventListener('input', () => actions.volume(Number(volume.value)));
    return { bar, play, stop, mute, volume };
  });
  return { update(state: AudioState) {
    for (const { bar, play, stop, mute, volume } of rows) {
      bar.querySelector('strong')!.textContent = state.name;
      bar.querySelector('.immersive-clock')!.textContent = state.clock;
      play.textContent = !state.playing ? 'Play audio' : state.paused ? 'Resume audio' : 'Pause audio';
      play.disabled = state.busy; stop.disabled = state.busy || !state.playing; mute.disabled = state.busy;
      volume.disabled = state.busy;
      mute.textContent = state.muted ? 'Unmute tones' : 'Mute tones'; mute.setAttribute('aria-pressed', String(state.muted));
      volume.value = String(state.volume); bar.querySelector('output')!.textContent = `${Math.round(state.volume * 100)}%`;
      volume.setAttribute('aria-valuetext', `${Math.round(state.volume * 100)}%`);
    }
  } };
}
