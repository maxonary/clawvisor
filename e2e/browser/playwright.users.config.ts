import { defineConfig } from '@playwright/test'

// Isolated frontend contract tests: every API call is intercepted with synthetic
// fixtures. No production account, email delivery, or server binary is involved.
export default defineConfig({
  testDir: './tests',
  testMatch: 'users.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1280, height: 1100 }, browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm --prefix ../../web run dev -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
})
