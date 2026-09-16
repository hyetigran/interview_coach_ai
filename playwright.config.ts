import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec wrangler dev --ip 127.0.0.1 --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 120000 },
});
