import type { VisualFrame } from './audio/visual-analysis';
import { libraryControls, libraryOptions, setupSceneLibrary } from './scene-library';

export function setupVisualizer(host: HTMLElement, audio: () => VisualFrame | undefined) {
  host.innerHTML = `<div class="scene-heading"><h3>Visualizations</h3><span class="small-muted">For music or a quiet moment</span></div>
    <label for="scene-mode">Scene</label><select id="scene-mode"><option value="off">Off</option><optgroup label="Music patterns"><option value="spectrum">Spectrum</option><option value="scope">Oscilloscope</option><option value="orbits">Orbital trails</option></optgroup><optgroup label="Moodscapes"><option value="aurora">Aurora</option><option value="water">Quiet water</option><option value="local">Your photo or video</option></optgroup>${libraryOptions}</select>
    <div id="scene-preview"><div class="scene-viewport" hidden><div class="scene-media"></div><canvas class="scene-drawing" aria-label="Music visualization"></canvas></div></div>${libraryControls}
    <label class="visual-toggle" for="scene-independent"><span>Animate without audio</span><input id="scene-independent" type="checkbox" /></label>
    <div class="scene-actions"><button id="scene-fullscreen" class="secondary-button" disabled>Open visualization ↗</button><button id="scene-file-button" class="text-button">Choose photo or video</button><input id="scene-file" type="file" accept="image/*,video/*" hidden /><button id="scene-clear" class="text-button" hidden>Remove file</button><button id="scene-mute-tones" class="text-button">Mute tone layers</button></div>
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
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stage = document.createElement('dialog');
  stage.className = 'scene-stage';
  stage.setAttribute('aria-label', 'Immersive visualization');
  stage.innerHTML = '<button class="secondary-button scene-close">Close visualization (Esc)</button>';
  document.body.append(stage);
  let running = false, raf = 0, previous = 0, elapsed = 0, energy = 0;
  let url: string | undefined;
  let video: HTMLVideoElement | undefined;
  let lastFrame: VisualFrame | undefined;
  let loading = 0;
  const bands = new Float32Array(48);
  const library = setupSceneLibrary(host, refresh, message => { status.textContent = message; });
  function release(element: HTMLImageElement | HTMLVideoElement, source: string): void {
    if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
    else element.removeAttribute('src');
    URL.revokeObjectURL(source);
  }

  const active = () => mode.value !== 'off' && (running || independent.checked) && !reduced.matches && !document.hidden;
  function render(timestamp = 0): void {
    const delta = previous && active() ? Math.min((timestamp - previous) / 1000, 0.05) : 0;
    elapsed += delta;
    previous = timestamp;
    const bounds = viewport.getBoundingClientRect();
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (running && !reduced.matches) lastFrame = audio();
    const frame = reduced.matches ? undefined : lastFrame;
    library.render(mode.value, frame, delta || 1 / 30, elapsed);
    const waveform = frame?.waveform;
    const rms = waveform ? Math.sqrt(waveform.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / waveform.length) : 0;
    energy += (Math.min(1, rms * 4) - energy) * 0.08;
    ctx.fillStyle = '#081714'; ctx.fillRect(0, 0, width, height);
    const cssHue = getComputedStyle(document.documentElement).getPropertyValue('--light-hue').trim();
    const hue = cssHue ? Number(cssHue) : 140;
    ctx.lineCap = 'round';
    if (mode.value === 'spectrum') {
      const gap = width / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const bin = Math.min(511, Math.floor(Math.pow(i / (bands.length - 1), 2) * 450) + 1);
        const value = (frame?.frequency[bin] ?? 0) / 255;
        bands[i] += (value - bands[i]) * 0.18;
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
    if (active()) raf = requestAnimationFrame(render);
  }
  function refresh(): void {
    cancelAnimationFrame(raf); previous = 0;
    viewport.hidden = mode.value === 'off'; open.disabled = viewport.hidden;
    canvas.hidden = mode.value === 'local' || mode.value === 'milkdrop' || mode.value.startsWith('nature:'); media.hidden = mode.value !== 'local';
    library.select(mode.value);
    if (video) {
      const currentVideo = video;
      if (active() && mode.value === 'local') void currentVideo.play().catch(error => {
        if (currentVideo === video && active() && mode.value === 'local' && error.name !== 'AbortError') status.textContent = 'Video could not play. Try another file.';
      });
      else video.pause();
    }
    if (!viewport.hidden) render();
  }
  mode.addEventListener('change', refresh); independent.addEventListener('change', refresh);
  reduced.addEventListener('change', refresh); document.addEventListener('visibilitychange', refresh);
  new ResizeObserver(() => { if (!active()) refresh(); }).observe(preview);
  host.querySelector('#scene-file-button')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    const ticket = ++loading;
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
      media.replaceChildren(element); mode.value = 'local'; clear.hidden = false;
      status.textContent = `${file.name}. Local files are not saved with presets. Use still images if you prefer less motion.`; refresh();
    } catch (error) { release(element, nextUrl); if (ticket === loading) status.textContent = (error as Error).message; }
  });
  clear.addEventListener('click', () => {
    loading++; const old = media.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
    if (old && url) release(old, url);
    video = undefined; media.replaceChildren(); url = undefined; clear.hidden = true;
    status.textContent = 'File removed.'; mode.value = 'off'; refresh();
  });
  open.addEventListener('click', async () => {
    stage.append(viewport); stage.showModal(); refresh();
    try { await stage.requestFullscreen?.(); } catch { /* The dialog also works without fullscreen. */ }
  });
  async function close(): Promise<void> {
    try { if (document.fullscreenElement === stage) await document.exitFullscreen(); } catch { /* Escape may have already exited fullscreen. */ }
    preview.append(viewport); stage.close(); refresh();
  }
  stage.querySelector('button')!.addEventListener('click', () => { void close(); });
  stage.addEventListener('cancel', event => { event.preventDefault(); void close(); });
  refresh();
  return { transport(value: boolean) { if (value !== running) { running = value; refresh(); } },
    stop() { running = false; independent.checked = false; refresh(); if (stage.open) void close(); } };
}
