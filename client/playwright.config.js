import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 12 * 60 * 1000,
  expect: {
    timeout: 15_000,
  },
  reporter: 'list',
  outputDir: './test-results/phase3',
  use: {
    ...devices['Pixel 7'],
    baseURL: process.env.PHASE3_STAGING_URL,
    viewport: { width: 390, height: 844 },
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
})
