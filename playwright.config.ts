import { defineConfig } from '@playwright/test';
const remoteOrigin = process.env.E2E_PREVIEW_ORIGIN;
if (remoteOrigin && !/^https:\/\/interview-coach-preview\.[a-z0-9-]+\.workers\.dev$/.test(remoteOrigin)) {
  throw new Error('E2E_PREVIEW_ORIGIN must point to the HTTPS preview Worker.');
}
export default defineConfig({
  timeout: remoteOrigin ? 90000 : process.env.E2E_DEV === '1' ? 60000 : 30000,
  expect: {timeout: remoteOrigin ? 30000 : 5000},
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { actionTimeout: remoteOrigin ? 30000 : 0, baseURL: remoteOrigin ?? 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: remoteOrigin ? undefined : { command: process.env.E2E_DEV === '1' ? 'pnpm dev' : 'node scripts/dev.mjs --worker', url: 'http://127.0.0.1:3000', reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }, timeout: 120000 },
});
