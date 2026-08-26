import { defineConfig } from '@playwright/test';
import { devices } from '@playwright/test';

// E2E runs against the local vite dev server. The golden-path suite is
// intentionally network-free: it uses the Study page's built-in sample video
// (bundled transcript, no caption fetching), so it is stable in CI.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: '**/mobile-pwa.spec.ts',
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/mobile-pwa.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-webkit',
      testMatch: '**/mobile-pwa.spec.ts',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
