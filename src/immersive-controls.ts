const key = 'binaural.fullscreen.auto-hide';
let preference: boolean | undefined;
function autoHide(): boolean {
  if (preference === undefined) { try { preference = localStorage.getItem(key) !== 'false'; } catch { preference = true; } }
  return preference;
}

export function setupControlsPreference(host: HTMLElement): void {
  const label = document.createElement('label'); label.className = 'visual-toggle';
  label.innerHTML = '<span>Hide fullscreen controls when idle</span><input id="fullscreen-auto-hide" type="checkbox" />';
  const input = label.querySelector('input')!; input.checked = autoHide();
  input.addEventListener('change', () => {
    preference = input.checked;
    try { localStorage.setItem(key, String(preference)); } catch { /* This preference can stay in memory. */ }
    window.dispatchEvent(new Event('binaural:fullscreen-controls'));
  });
  host.append(label);
}

export function setupImmersiveControls(stage: HTMLDialogElement, surface: HTMLElement, toolbar: HTMLElement, open: () => void, close: () => void) {
  stage.classList.add('immersive-controls'); toolbar.classList.add('immersive-toolbar'); stage.tabIndex = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ownsFullscreen = false;
  let entering: Promise<void> | undefined;
  const hide = () => { clearTimeout(timer); stage.classList.remove('controls-awake'); };
  const wake = () => {
    clearTimeout(timer); stage.classList.add('controls-awake');
    if (stage.open) timer = setTimeout(hide, 1600);
  };
  const refresh = () => { stage.classList.toggle('controls-auto-hide', autoHide()); wake(); };
  surface.addEventListener('dblclick', event => {
    if ((event.target as HTMLElement).closest('button, input, select, a')) return;
    event.preventDefault(); stage.open ? close() : open();
  });
  stage.addEventListener('pointermove', wake); stage.addEventListener('pointerdown', wake);
  stage.addEventListener('keydown', wake); stage.addEventListener('pointerleave', hide);
  const lockScroll = () => document.documentElement.classList.toggle('immersive-open', !!document.querySelector('.immersive-controls[open]'));
  stage.addEventListener('close', () => { hide(); lockScroll(); });
  document.addEventListener('fullscreenchange', () => {
    if (ownsFullscreen && !document.fullscreenElement) { ownsFullscreen = false; if (stage.open) close(); }
  });
  window.addEventListener('binaural:fullscreen-controls', refresh);
  refresh();
  return {
    async opened() {
      lockScroll(); stage.focus({ preventScroll: true }); wake();
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      try { entering = document.documentElement.requestFullscreen(); await entering; ownsFullscreen = true; }
      catch { /* The dialog still fills the window when browser fullscreen is unavailable. */ }
      finally { entering = undefined; }
    },
    async exit() {
      try {
        await entering?.catch(() => {});
        const exit = ownsFullscreen && document.fullscreenElement === document.documentElement; ownsFullscreen = false;
        if (exit) await document.exitFullscreen();
      }
      catch { /* Escape may already have exited browser fullscreen. */ }
      finally { ownsFullscreen = false; }
    },
  };
}
