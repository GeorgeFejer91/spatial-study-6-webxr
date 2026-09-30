import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  preserveOutput: 'never',
  reporter: 'line',
  timeout: 120_000,
  expect: {
    timeout: 90_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4174/spatial-study-6-webxr/',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/spatial-study-6-webxr/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
