import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile('.env.local');
} catch (err) {
  // CI provides the variables directly; only a missing file is tolerated.
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    baseURL: 'http://localhost:3000',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
