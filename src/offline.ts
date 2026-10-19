import './offline.css';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupOffline(options: { isPlaying: () => boolean }): { update: () => void } {
  if (!import.meta.env.PROD) return { update() {} };
  const panel = document.createElement('section');
  panel.className = 'offline-tools';
  panel.setAttribute('aria-label', 'Offline and installation');
  panel.innerHTML = `<details><summary>Offline and install</summary>
    <p id="offline-status" role="status" aria-live="polite">Preparing the app for offline use…</p>
    <p>The app, built-in sounds, visual presets and nature photos are saved on this device. Temporary local music, photos and videos are not included; choose them again after reopening. Browser storage may be cleared or evicted.</p>
    <p id="offline-install-help">To install, use your browser's Install app or Add to Home Screen menu if available. On iPhone or iPad, use Safari's Share menu, then Add to Home Screen. You can also keep a bookmark.</p>
    <div class="offline-actions"><button type="button" class="secondary-button" id="offline-install" hidden>Install app</button><button type="button" class="secondary-button" id="offline-update" hidden>Update and reload</button><button type="button" class="secondary-button" id="offline-check" hidden>Check for updates</button></div></details>`;
  const footer = document.querySelector('.page-footer');
  if (footer) footer.before(panel); else document.querySelector('main')?.append(panel);
  const status = panel.querySelector<HTMLElement>('#offline-status')!;
  const updateButton = panel.querySelector<HTMLButtonElement>('#offline-update')!;
  const installButton = panel.querySelector<HTMLButtonElement>('#offline-install')!;
  const checkButton = panel.querySelector<HTMLButtonElement>('#offline-check')!;
  let registration: ServiceWorkerRegistration | undefined;
  let prompt: InstallPrompt | undefined;
  let applying = false;
  let reloadReady = false;
  let ready = false;
  let failure = '';
  function update(): void {
    const waiting = !!registration?.waiting;
    updateButton.hidden = !waiting && !reloadReady;
    updateButton.disabled = options.isPlaying() || applying;
    updateButton.textContent = options.isPlaying() ? 'Update after listening' : reloadReady ? 'Reload updated app' : 'Update and reload';
    const message = failure || (waiting || reloadReady ? 'An update is ready. Reload when you have finished listening.' :
      ready ? 'Ready offline. Reopen this address or the installed app, even without a connection.' : 'Preparing the app for offline use…');
    if (status.textContent !== message) status.textContent = message;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPrompt; installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => { prompt = undefined; installButton.hidden = true; });
  installButton.addEventListener('click', () => {
    const current = prompt;
    if (!current) return;
    prompt = undefined; installButton.hidden = true;
    void current.prompt().then(() => current.userChoice).catch(() => {
      status.textContent = 'Use your browser menu to install or bookmark this app.';
    });
  });
  updateButton.addEventListener('click', () => {
    if (options.isPlaying() || applying) return;
    if (reloadReady) { location.reload(); return; }
    if (!registration?.waiting) return;
    applying = true; update();
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    failure = 'Offline use needs HTTPS and a browser with service worker support. You can still use the app while connected.';
    update(); return { update };
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    ready = !!navigator.serviceWorker.controller;
    if (applying) {
      applying = false; reloadReady = true;
      if (!options.isPlaying()) { location.reload(); return; }
    }
    update();
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'CHECK_UPDATE_SAFETY') event.ports[0]?.postMessage({
      safe: !options.isPlaying(),
    });
    if (event.data?.type === 'UPDATE_BLOCKED') {
      applying = false; failure = 'Finish listening in all open Binaural tabs, then try the update again.'; update();
    }
  });
  checkButton.addEventListener('click', () => {
    if (!registration) return;
    checkButton.disabled = true; failure = '';
    void registration.update().catch(() => {
      failure = ready ? 'The saved app is ready offline. Connect to check for updates.' : 'Could not prepare offline use. Reconnect and try again.';
    }).finally(() => { checkButton.disabled = false; update(); });
  });
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  void navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname, updateViaCache: 'none' }).then(result => {
    registration = result; ready = !!result.active; checkButton.hidden = false;
    const watch = (worker: ServiceWorker): void => worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') ready = true;
      if (worker.state === 'redundant') failure = ready ? 'The update could not be saved. Your previous offline app is still available.' : 'Offline setup failed. Reconnect and check for updates to try again.';
      update();
    });
    if (result.installing) watch(result.installing);
    result.addEventListener('updatefound', () => { failure = ''; if (result.installing) watch(result.installing); update(); });
    update();
  }).catch(() => { failure = 'Offline setup was unavailable. Reconnect and reload to try again.'; update(); });
  return { update };
}
