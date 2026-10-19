import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from './scripts/browser-options.mjs';

const mode = process.env.BINAURAL_TEST_MODE ?? 'quick';
const full = mode === 'full' || mode === 'headed';
const options = (name: string) => full ? browserLaunchOptions(name, process.env, process.platform, mode === 'headed') : { headless: true };

export default defineConfig({
  testDir: './tests',
  ...(!full ? { testMatch: ['bwg-curves.spec.ts', 'bwg-library.spec.ts', 'pe-resources.spec.ts', 'timeline.spec.ts'] } : {}),
  fullyParallel: true,
  workers: 1,
  reporter: full ? 'list' : 'dot',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: options('chromium') } },
    ...(full ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: options('firefox') } }] : []),
  ],
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
