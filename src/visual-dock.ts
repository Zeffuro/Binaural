export function setupVisualDock(quick: HTMLElement, fullscreen: () => void) {
  const panel = document.createElement('section'); panel.id = 'visual-dock'; panel.className = 'visual-dock'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Visualization preview');
  panel.innerHTML = `<div class="visual-dock-toolbar"><strong id="visual-dock-title">Visualization</strong><button id="visual-dock-fullscreen" class="secondary-button">Fullscreen visualization</button></div>
    <div id="visual-dock-consent"></div><div id="visual-dock-scenes"></div><div class="visual-dock-light" role="img" aria-label="Ambient light preview" hidden></div>
    <div id="visual-dock-motion"></div><div id="visual-dock-controls"></div><p class="fine-print">Double-click the preview to enter or leave fullscreen.</p><p class="fine-print" id="visual-dock-status" role="status"></p>`;
  quick.after(panel);
  const title = panel.querySelector('#visual-dock-title')!;
  const button = panel.querySelector<HTMLButtonElement>('#visual-dock-fullscreen')!;
  const status = panel.querySelector('#visual-dock-status')!;
  const light = panel.querySelector<HTMLElement>('.visual-dock-light')!;
  const sceneHost = panel.querySelector<HTMLElement>('#visual-dock-scenes')!;
  const motion = panel.querySelector<HTMLElement>('#visual-dock-motion')!;
  let lighting = false, state = { mode: 'off', label: '', allowed: false, running: false, independent: false, reduced: false };
  button.onclick = fullscreen;
  light.ondblclick = fullscreen;
  function update(): void {
    const lightOnly = state.mode === 'off' && lighting;
    panel.hidden = state.mode === 'off' && !lighting;
    light.hidden = !lightOnly; sceneHost.hidden = lightOnly;
    motion.hidden = state.mode === 'off';
    title.textContent = lightOnly ? 'Ambient light' : state.label;
    button.disabled = !lightOnly && !state.allowed;
    const message = lightOnly ? 'Your chosen light color. Movement follows playback.' : !state.allowed ? `Enable ${state.mode === 'triggers' ? 'light triggers' : 'MilkDrop'} to show this scene.`
      : state.reduced ? 'Reduced motion is active. The preview stays still.'
        : state.running ? 'Following your audio. Fullscreen keeps the session playing.'
          : state.independent ? 'Animating without audio.' : 'Preview ready. Start listening or enable Animate without audio.';
    if (status.textContent !== message) status.textContent = message;
  }
  return {
    scenes: sceneHost, consent: panel.querySelector<HTMLElement>('#visual-dock-consent')!, motion, controls: panel.querySelector<HTMLElement>('#visual-dock-controls')!,
    scene(value: typeof state) { state = value; update(); },
    light(enabled: boolean) { lighting = enabled; update(); },
    reveal() { if (!panel.hidden) panel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); },
  };
}

export type VisualDock = ReturnType<typeof setupVisualDock>;
