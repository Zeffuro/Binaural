import { createServer } from 'node:http';
import { chromium, firefox } from '@playwright/test';
import { browserLaunchOptions } from './browser-options.mjs';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Browser runtime check</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const [name, launcher] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await launcher.launch(browserLaunchOptions(name));
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator(), analyser = context.createAnalyser();
        oscillator.connect(analyser).connect(context.destination);
        oscillator.start();
        const resumed = await Promise.race([
          context.resume().then(() => true),
          new Promise(resolve => setTimeout(() => resolve(false), 3000)),
        ]);
        await new Promise(resolve => setTimeout(resolve, 200));
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        const audio = { resumed, state: context.state, seconds: context.currentTime,
          rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) };
        oscillator.stop();
        await Promise.race([context.close(), new Promise(resolve => setTimeout(resolve, 500))]);
        const gl = document.createElement('canvas').getContext('webgl2');
        let graphics = null;
        if (gl) {
          gl.clearColor(0.25, 0.5, 0.75, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const pixel = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          graphics = { pixel: [...pixel], renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), error: gl.getError() };
        }
        return { audio, graphics };
      });
      console.log(`${name}: ${JSON.stringify(result)}`);
      if (!result.audio.resumed || result.audio.state !== 'running' || result.audio.seconds <= 0 || result.audio.rms < 0.1) {
        throw new Error(`${name}: live Web Audio needs an active output device or a running virtual audio sink on this runner.`);
      }
      if (!result.graphics || result.graphics.error !== 0 || result.graphics.pixel.some((value, index) => Math.abs(value - [64, 128, 191, 255][index]) > 1)) {
        throw new Error(`${name}: this runner must provide a working WebGL 2 renderer.`);
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
