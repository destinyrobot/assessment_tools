import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the built static site with a mocked backend, so it verifies
 * routing, responsive layout and the share-link deep link under real browsers
 * without needing a live Supabase project.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    locale: 'zh-CN',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Same engine, phone viewport: exercises the responsive layout and the
    // mobile save/share code paths without needing webkit.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    // Real iOS rendering. Not installed in CI by default; run it manually
    // (`npx playwright install webkit && npx playwright test --project=mobile-safari`)
    // before shipping, because Safari is where long-image export is riskiest.
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});