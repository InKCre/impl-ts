import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // Node tests use package exports, not consumers' browser-source type aliases.
  tsconfig: './tsconfig.json',
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  globalTimeout: 300_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: 'test-results/playwright',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'web-database',
      testMatch: ['peer-database.spec.ts', 'native-readers.spec.ts', 'native-setup.spec.ts'],
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
      },
    },
    {
      name: 'accessibility',
      testMatch: 'accessibility.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
      },
    },
    {
      name: 'mail-host',
      testMatch: 'mail-info-base.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
      },
    },
    {
      // Explicit cross-Peer acceptance against the prepared Python Mail corpus.
      name: 'mail-info-base',
      testMatch: 'mail-provider.spec.ts',
      retries: 0,
      use: { baseURL: process.env.INKCRE_E2E_WEB_URL, trace: 'off' },
    },
    {
      name: 'browser-extension',
      testMatch: 'browser-extension.spec.ts',
    },
  ],
})
