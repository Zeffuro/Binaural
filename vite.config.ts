import { defineConfig } from 'vite';
import { offlineBuild } from './scripts/build-offline.mjs';

export default defineConfig({
  base: './',
  plugins: [offlineBuild()],
});
