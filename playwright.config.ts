import { defineConfig, devices } from '@playwright/test';

const live = process.argv.includes('--live');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: live ? 'https://www.upstateipvoice.com' : 'http://127.0.0.1:4173',
    trace: 'off'
  },
  webServer: live ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173/planner/',
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
