import { defineConfig } from '@playwright/test';

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    browserName: 'chromium',
    timezoneId: 'Asia/Singapore',
    launchOptions: {
      args: ['--enable-features=WebAuthentication'],
    },
  },
  webServer: {
    command: `npm run dev -- --hostname localhost --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_PATH: 'auth-e2e.db',
      SESSION_SECRET: 'playwright-only-session-secret-replace-before-use',
      RP_NAME: 'Todo App Tests',
      RP_ID: 'localhost',
      RP_ORIGIN: baseURL,
    },
  },
});
