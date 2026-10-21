import type { VisualFrame } from './audio/visual-analysis';
import { libraryControls, libraryOptions, setupSceneLibrary } from './scene-library';
import { type VisualSettings, visualBudget, visualRatio } from './visual-state';
import type { VisualDock } from './visual-dock';
import { setupImmersiveControls } from './immersive-controls';
import { setupTriggerControls } from './trigger-controls';
import { TriggerRenderer } from './trigger-renderer';
import { captureSurface, type VisualCapture } from './visual-capture';

export function setupVisualizer(host: HTMLElement, audio: () => VisualFrame | undefined, changed: () => void, dock?: VisualDock, beforeEdit: () => void = () => {}, reduced = matchMedia('(prefers-reduced-motion: reduce)')) {
  host.innerHTML = `<div class="scene-heading"><h3>Visualizations</h3><span class="small-muted">For music or a quiet moment</span></div>
    <label for="scene-mode">Scene</label><select id="scene-mode"><option value="off">Off</option><optgroup label="Music patterns"><option value="spectrum">Spectrum</option><option value="scope">Oscilloscope</option><option value="orbits">Orbital trails</option></optgroup><optgroup label="Moodscapes"><option value="aurora">Aurora</option><option value="water">Quiet water</option><option value="local">Your photo or video</option></optgroup><optgroup label="Light triggers"><option value="triggers">Kaleidoscope and light triggers</option></optgroup>${libraryOptions}</select>
    <div id="scene-preview"><div class="scene-viewport" hidden><div class="scene-media"></div><canvas class="scene-drawing" aria-label="Music visualization"></canvas></div></div>${libraryControls}
    <label class="visual-toggle" for="scene-independent"><span>Animate without audio</span><input id="scene-independent" type="checkbox" /></label>
    <div class="scene-actions"><button id="scene-fullscreen" class="secondary-button" disabled>Open visualization ↗</button><button id="scene-export" class="text-button">Save PNG still</button><button id="scene-file-button" class="text-button">Choose photo or video</button><input id="scene-file" type="file" accept="image/*,video/*" hidden /><button id="scene-clear" class="text-button" hidden>Remove file</button><button id="scene-mute-tones" class="text-button">Mute tone layers</button></div>
    <p id="scene-status" class="fine-print" role="status">Files stay on your device. Motion follows playback.</p>`;
  const mode = host.querySelector<HTMLSelectElement>('#scene-mode')!;
  const independent = host.querySelector<HTMLInputElement>('#scene-independent')!;
  const viewport = host.querySelector<HTMLElement>('.scene-viewport')!;
  const media = host.querySelector<HTMLElement>('.scene-media')!;
  const preview = host.querySelector<HTMLElement>('#scene-preview')!;
  const canvas = host.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const open = host.querySelector<HTMLButtonElement>('#scene-fullscreen')!;
  const fileInput = host.querySelector<HTMLInputElement>('#scene-file')!;
  const status = host.querySelector<HTMLElement>('#scene-status')!;
  const clear = host.querySelector<HTMLButtonElement>('#scene-clear')!;
  const stage = document.createElement('dialog');
  stage.className = 'scene-stage';
  stage.setAttribute('aria-label', 'Immersive visualization');
  stage.innerHTML = '<div class="scene-stage-tools"><button class="secondary-button scene-previous" aria-label="Previous visual">← Previous</button><button class="secondary-button scene-next" aria-label="Next visual">Next →</button><button class="secondary-button scene-trigger-settings" hidden>Light settings</button><button class="secondary-button scene-close">Close visualization (Esc)</button></div>';
  document.body.append(stage);
  const immersive = setupImmersiveControls(stage, viewport, stage.querySelector('.scene-stage-tools')!, () => { void fullscreen(); }, () => { void close(); });
  let running = false, raf = 0, previous = 0, elapsed = 0, energy = 0, onscreen = true, closing = false;
  let previousTick = 0, nextDraw = 0;
  let url: string | undefined;
  let video: HTMLVideoElement | undefined;
  let lastFrame: VisualFrame | undefined;
  let loading = 0;
  const captures = new Set<{ width: number; height: number; update(): void }>();
  const bands = new Float32Array(48);
  const library = setupSceneLibrary(host, refresh, message => { status.textContent = message; }, changed);
  const consent = host.querySelector<HTMLInputElement>('#milkdrop-enable')!;
  const triggers = setupTriggerControls(host, refresh, changed, beforeEdit);
  const triggerRenderer = new TriggerRenderer();
  let glassPhase = 0, lightPhase = 0, triggerPreset = '', pan = 0;
  const allowed = () => (mode.value !== 'milkdrop' || consent.checked) && (mode.value !== 'triggers' || triggers.enabled());
  stage.querySelector('.scene-trigger-settings')!.addEventListener('click', () => triggers.open());
  if (dock) {
    dock.scenes.append(preview);
    dock.consent.append(host.querySelector('#milkdrop-consent')!);
    dock.motion.append(independent.closest('label')!);
    dock.consent.append(triggers.consentBox); dock.controls.append(triggers.panel);
    const reveal = document.createElement('button'); reveal.className = 'text-button'; reveal.textContent = 'Show visualization preview ↑';
    reveal.addEventListener('click', () => dock.reveal()); host.querySelector('.scene-heading')!.append(reveal);
  }
  function release(element: HTMLImageElement | HTMLVideoElement, source: string): void {
    if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
    else element.removeAttribute('src');
    URL.revokeObjectURL(source);
  }

  const active = () => mode.value !== 'off' && allowed() && (running || independent.checked) && !reduced.matches && !document.hidden && (onscreen || stage.open || captures.size > 0);
  const captureSize = () => [...captures].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  function captureSource(): HTMLCanvasElement | HTMLImageElement | HTMLVideoElement {
    if (mode.value === 'off') throw new Error('Choose a visual or enable ambient light before recording.');
    if (!allowed()) throw new Error(mode.value === 'milkdrop' ? 'Enable MilkDrop visuals before recording.' : 'Enable light triggers before recording.');
    if (mode.value === 'milkdrop' || mode.value.startsWith('nature:')) {
      if (!library.captureReady()) throw new Error('Wait for this scene to load before recording. If graphics were interrupted, choose another scene.');
      const source = library.flat() ?? library.canvas();
      if (source instanceof HTMLImageElement && (!source.complete || !source.naturalWidth)) throw new Error('Wait for this nature photo to load before recording.');
      return source;
    }
    if (mode.value === 'local') {
      const source = media.firstElementChild;
      if (source instanceof HTMLImageElement && source.complete && source.naturalWidth) return source;
      if (source instanceof HTMLVideoElement && source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !source.error && source.videoWidth) return source;
      throw new Error('Choose a ready local photo or video before recording.');
    }
    return canvas;
  }
  function render(timestamp = 0): void {
    const cadence = timestamp && previousTick ? timestamp - previousTick : 0;
    previousTick = timestamp;
    const effectiveQuality = library.effectiveQuality(), interval = 1000 / visualBudget(effectiveQuality).fps;
    if (timestamp && nextDraw && timestamp < nextDraw - .1 && active()) { raf = requestAnimationFrame(render); return; }
    const drawing = active(), drawInterval = previous && timestamp ? timestamp - previous : 0;
    if (video && (!drawing || mode.value !== 'local')) video.pause();
    const measuring = drawing && library.quality() === 'auto' && library.qualityReady(mode.value);
    const started = measuring ? performance.now() : 0;
    if (timestamp) nextDraw = nextDraw ? nextDraw + (Math.floor(Math.max(0, timestamp - nextDraw) / interval) + 1) * interval : timestamp + interval;
    const delta = previous && drawing ? Math.min(drawInterval / 1000, 0.05) : 0;
    elapsed += delta;
    previous = timestamp;
    const bounds = captureSize() ?? viewport.getBoundingClientRect();
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
    const ratio = visualRatio(width, effectiveQuality);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (running && drawing) lastFrame = audio();
    const frame = lastFrame;
    library.render(mode.value, frame, delta, elapsed, captureSize(), drawing);
    const waveform = frame?.waveform;
    const rms = waveform ? Math.sqrt(waveform.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / waveform.length) : 0;
    if (drawing) energy += (Math.min(1, rms * 4) - energy) * 0.08;
    ctx.fillStyle = '#081714'; ctx.fillRect(0, 0, width, height);
    const cssHue = getComputedStyle(document.documentElement).getPropertyValue('--light-hue').trim();
    const hue = cssHue ? Number(cssHue) : 140;
    ctx.lineCap = 'round';
    if (mode.value === 'triggers' && triggers.enabled()) {
      const settings = triggers.state();
      if (triggerPreset !== settings.preset && settings.preset !== 'custom') { triggerPreset = settings.preset; glassPhase = lightPhase = 0; triggerRenderer.reset(); }
      glassPhase += delta * settings.speed; lightPhase += delta * settings.lightSpeed * Math.PI * 2;
      const rms = (samples?: Uint8Array) => samples ? Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) : 0;
      const left = rms(frame?.left), right = rms(frame?.right);
      if (drawing) pan += ((right - left) / Math.max(.05, left + right) - pan) * .06;
      triggerRenderer.render(ctx, width, height, settings, { glass: glassPhase, light: lightPhase, energy, pan });
      canvas.dataset.glass = glassPhase.toFixed(4); canvas.dataset.light = lightPhase.toFixed(4);
    } else if (mode.value === 'spectrum') {
      const gap = width / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const bin = Math.min(511, Math.floor(Math.pow(i / (bands.length - 1), 2) * 450) + 1);
        const value = (frame?.frequency[bin] ?? 0) / 255;
        if (drawing) bands[i] += (value - bands[i]) * 0.18;
        const bar = 2 + bands[i] * height * 0.78;
        ctx.fillStyle = `hsl(${hue + i * 1.8} 55% ${42 + bands[i] * 18}%)`;
        ctx.fillRect(i * gap + 1, height - 12 - bar, Math.max(1, gap - 3), bar);
      }
    } else if (mode.value === 'scope') {
      ctx.lineWidth = 2; ctx.strokeStyle = `hsl(${hue} 65% 70%)`; ctx.beginPath();
      for (let i = 0; i < 512; i++) {
        const x = i / 511 * width, y = height / 2 + ((waveform?.[i * 2] ?? 128) - 128) / 128 * height * 0.4;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (mode.value === 'orbits') {
      for (let i = 0; i < 12; i++) {
        const angle = elapsed * 0.12 + i * Math.PI / 6;
        ctx.strokeStyle = `hsla(${hue + i * 10} 50% 65% / ${0.22 + energy * 0.3})`;
        ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.ellipse(width / 2, height / 2, width * (0.16 + i * 0.018), height * (0.1 + energy * 0.12), angle, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (mode.value === 'aurora') {
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#080f24'); sky.addColorStop(1, '#163a35'); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
      for (let layer = 0; layer < 6; layer++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
          const y = height * (0.35 + layer * 0.045) + Math.sin(x / width * 5 + elapsed * 0.13 + layer * 0.5) * height * 0.16;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${145 + layer * 16} 55% 63% / ${0.12 + energy * 0.08})`;
        ctx.lineWidth = height * 0.06; ctx.stroke();
      }
    } else if (mode.value === 'water') {
      const sea = ctx.createLinearGradient(0, 0, 0, height);
      sea.addColorStop(0, '#234751'); sea.addColorStop(0.42, '#41747b'); sea.addColorStop(0.43, '#183b46'); sea.addColorStop(1, '#081d2b');
      ctx.fillStyle = sea; ctx.fillRect(0, 0, width, height);
      for (let line = 0; line < 22; line++) {
        const depth = line / 22;
        ctx.strokeStyle = `hsla(184 35% ${55 - depth * 20}% / ${0.12 + depth * 0.22})`; ctx.lineWidth = 1 + depth; ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
          const y = height * (0.45 + depth * 0.55) + Math.sin(x / width * (10 - depth * 5) + elapsed * 0.3 + line) * (2 + depth * 7 + energy * 3);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    canvas.dataset.frame = elapsed.toFixed(3);
    canvas.dataset.energy = energy.toFixed(4);
    // WebGL buffers must be copied in the same task as their freshly rendered frame.
    for (const capture of captures) capture.update();
    if (measuring && drawInterval && cadence) library.sampleQuality(performance.now() - started, cadence, drawInterval);
    if (active()) raf = requestAnimationFrame(render);
  }
  function refresh(): void {
    cancelAnimationFrame(raf); previous = previousTick = nextDraw = 0;
    if (!active()) library.pauseQuality();
    viewport.hidden = mode.value === 'off' || !allowed(); open.disabled = viewport.hidden;
    canvas.hidden = mode.value === 'local' || mode.value === 'milkdrop' || mode.value.startsWith('nature:'); media.hidden = mode.value !== 'local';
    library.select(mode.value);
    library.effectiveQuality();
    triggers.select(mode.value);
    stage.querySelector<HTMLElement>('.scene-trigger-settings')!.hidden = mode.value !== 'triggers';
    viewport.classList.toggle('trigger-manual', mode.value === 'triggers' && triggers.state().path === 'manual');
    if (mode.value === 'triggers') status.textContent = triggers.enabled() ? 'Light settings are below the preview. Glass and backlight move independently.' : 'Enable light triggers beside the preview to display this scene.';
    dock?.scene({ mode: mode.value, label: mode.selectedOptions[0].text, allowed: !open.disabled, running, independent: independent.checked, reduced: reduced.matches });
    if (video) {
      const currentVideo = video;
      if (active() && mode.value === 'local') void currentVideo.play().catch(error => {
        if (currentVideo === video && active() && mode.value === 'local' && error.name !== 'AbortError') status.textContent = 'Video could not play. Try another file.';
      });
      else video.pause();
    }
    if (!viewport.hidden) render();
  }
  mode.addEventListener('change', () => { triggers.generic(); refresh(); }); independent.addEventListener('change', () => { triggers.cancelPending(); refresh(); changed(); });
  host.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (target === fileInput) return;
    triggers.cancelPending();
    if (target.type === 'number') target.value = String(Math.min(Number(target.max), Math.max(Number(target.min), Number(target.value) || Number(target.min))));
    refresh(); changed();
  });
  reduced.addEventListener('change', refresh); document.addEventListener('visibilitychange', refresh);
  new ResizeObserver(() => { if (!active()) refresh(); }).observe(preview);
  new IntersectionObserver(entries => { const visible = entries[0].isIntersecting; if (visible !== onscreen) { onscreen = visible; refresh(); } }).observe(preview);
  host.querySelector('#scene-file-button')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    triggers.generic(); const ticket = ++loading;
    if (!/^(image|video)\//.test(file.type) || file.size > 128 * 1024 * 1024) { status.textContent = 'Choose an image or video under 128 MB.'; return; }
    const nextUrl = URL.createObjectURL(file);
    const element = file.type.startsWith('video/') ? document.createElement('video') : new Image();
    if (element instanceof HTMLVideoElement) { element.muted = true; element.loop = true; element.playsInline = true; element.preload = 'auto'; }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => done(false), 10000);
        const done = (ok: boolean) => { clearTimeout(timer); element.onload = element.onerror = null; if (element instanceof HTMLVideoElement) element.onloadeddata = null; ok ? resolve() : reject(new Error('This file could not be opened.')); };
        element.onerror = () => done(false);
        if (element instanceof HTMLVideoElement) element.onloadeddata = () => done(true); else element.onload = () => done(true);
        element.src = nextUrl;
      });
      if (ticket !== loading) { release(element, nextUrl); return; }
      const old = media.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
      if (old && url) release(old, url);
      url = nextUrl; video = element instanceof HTMLVideoElement ? element : undefined;
      triggers.generic(); media.replaceChildren(element); mode.value = 'local'; clear.hidden = false;
      status.textContent = `${file.name}. Local files are not saved with presets. Use still images if you prefer less motion.`; refresh(); changed();
    } catch (error) { release(element, nextUrl); if (ticket === loading) status.textContent = (error as Error).message; }
  });
  clear.addEventListener('click', () => {
    triggers.generic();
    loading++; const old = media.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
    if (old && url) release(old, url);
    video = undefined; media.replaceChildren(); url = undefined; clear.hidden = true;
    status.textContent = 'File removed.'; mode.value = 'off'; refresh(); changed();
  });
  async function fullscreen(): Promise<void> {
    if (mode.value === 'off' || stage.open || closing || !allowed()) return;
    stage.append(viewport); stage.showModal(); refresh(); await immersive.opened();
  }
  open.addEventListener('click', () => { void fullscreen(); });
  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    try { await immersive.exit(); }
    finally { preview.append(viewport); stage.close(); closing = false; refresh(); }
  }
  stage.querySelector('.scene-close')!.addEventListener('click', () => { void close(); });
  function next(direction = 1): void {
    beforeEdit();
    triggers.cancelPending();
    if (mode.value === 'milkdrop') library.next(direction);
    else if (mode.value === 'triggers') triggers.next(direction);
    else {
      triggers.generic();
      const options = [...mode.options].filter(option => !['off', 'local', 'milkdrop', 'triggers'].includes(option.value));
      const index = options.findIndex(option => option.value === mode.value);
      const target = index < 0 ? (direction > 0 ? 0 : options.length - 1) : (index + direction + options.length) % options.length;
      mode.value = options[target].value; refresh(); changed();
    }
  }
  stage.querySelector('.scene-previous')!.addEventListener('click', () => next(-1));
  stage.querySelector('.scene-next')!.addEventListener('click', () => next());
  stage.addEventListener('keydown', event => {
    if (!['[', ']'].includes(event.key) || (event.target as HTMLElement).closest('input, select, textarea')) return;
    event.preventDefault(); event.stopPropagation(); next(event.key === '[' ? -1 : 1);
  });
  let swipe: { id: number; x: number; y: number } | undefined;
  viewport.addEventListener('pointerdown', event => {
    if (!stage.open || mode.value.startsWith('nature:') || (mode.value === 'triggers' && triggers.state().path === 'manual') || event.pointerType === 'mouse') return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  viewport.addEventListener('pointerup', event => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y; swipe = undefined;
    if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 2) next(dx < 0 ? 1 : -1);
  });
  viewport.addEventListener('pointercancel', () => { swipe = undefined; });
  let placing: number | undefined;
  const place = (event: PointerEvent) => { const box = viewport.getBoundingClientRect(); triggers.position((event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1); };
  viewport.addEventListener('pointerdown', event => {
    if (mode.value !== 'triggers' || !triggers.enabled() || triggers.state().path !== 'manual' || event.button !== 0) return;
    beforeEdit(); placing = event.pointerId; viewport.setPointerCapture(event.pointerId); place(event);
  });
  viewport.addEventListener('pointermove', event => { if (placing === event.pointerId) place(event); });
  for (const type of ['pointerup', 'pointercancel']) viewport.addEventListener(type, () => { placing = undefined; });
  stage.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); void close(); });
  host.querySelector('#scene-export')!.addEventListener('click', () => {
    if (mode.value === 'off') { status.textContent = 'Choose a scene before saving a still.'; return; }
    if (mode.value === 'triggers' && !triggers.enabled()) { status.textContent = 'Enable light triggers before saving this scene.'; return; }
    if ((mode.value === 'milkdrop' || mode.value.startsWith('nature:')) && !library.captureReady()) { status.textContent = 'Wait for this scene to load. MilkDrop also requires your flashing-light consent.'; return; }
    try {
      cancelAnimationFrame(raf); previous = previousTick = nextDraw = 0; render();
      const image = document.createElement('canvas');
      const source = captureSource();
      image.width = canvas.width; image.height = canvas.height;
      image.getContext('2d')!.drawImage(source, 0, 0, image.width, image.height);
      image.toBlob(blob => {
        if (!blob) { status.textContent = 'This browser could not capture the scene. Try a music pattern or photo.'; return; }
        const link = document.createElement('a'), sourceUrl = URL.createObjectURL(blob);
        link.href = sourceUrl; link.download = 'binaural-scene.png'; link.click(); setTimeout(() => URL.revokeObjectURL(sourceUrl), 1000);
        status.textContent = 'PNG still saved.';
      }, 'image/png');
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'This scene cannot be captured. Try a music pattern or photo.'; }
  });
  refresh();
  return { transport(value: boolean) { if (value !== running) { running = value; refresh(); } },
    createCapture(width: number, height: number, fps = 30): VisualCapture {
      captureSource();
      const surface = captureSurface(width, height, fps);
      let disposed = false, failure: unknown;
      const capture = { width, height, update() {
        if (failure) return;
        try { surface.paint(captureSource()); } catch (error) { failure = error; }
      } };
      const lease: VisualCapture = { canvas: surface.canvas,
        draw() {
          if (disposed) throw new Error('This video capture has been disposed.');
          captureSource();
          if (failure) throw failure;
          if (mode.value === 'local') surface.paint(captureSource());
        },
        dispose() {
          if (disposed) return;
          disposed = true; captures.delete(capture); surface.canvas.width = surface.canvas.height = 1; refresh();
        },
      };
      captures.add(capture);
      try { refresh(); lease.draw(); } catch (error) { try { lease.dispose(); } catch { /* Preserve the capture failure. */ } throw error; }
      return lease;
    },
    getState() { return { scene: mode.value, ...library.getState(), triggers: triggers.state() }; },
    restore(state: VisualSettings) {
      loading++; const old = media.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
      if (old && url) release(old, url);
      video = undefined; media.replaceChildren(); url = undefined; clear.hidden = true;
      mode.value = state.scene; independent.checked = false; elapsed = 0; lastFrame = undefined; library.restore(state);
      triggers.restore(state.triggers); glassPhase = lightPhase = pan = 0; triggerPreset = ''; triggerRenderer.reset(); refresh();
      if (mode.value === 'local' && !url) status.textContent = 'Choose your local photo or video again. Local files are excluded from saved experiences.';
    },
    choose(scene: string) { triggers.generic(); mode.value = scene; refresh(); },
    applyTrigger(id: string) { triggers.generic(); mode.value = 'triggers'; triggers.apply(id); refresh(); },
    applyAsmrTrigger(id: string, accepted: () => void) { return triggers.applyAsmr(id, () => { mode.value = 'triggers'; accepted(); refresh(); }); },
    cancelPending: triggers.cancelPending,
    fullscreen() { void fullscreen(); },
    next,
    toggleIndependent() { triggers.cancelPending(); independent.checked = !independent.checked; refresh(); changed(); },
    stop() { triggers.cancelPending(); running = false; independent.checked = false; refresh(); if (stage.open) void close(); } };
}
