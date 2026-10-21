import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: new URL('../../../test-results/mail-newsletter', import.meta.url).pathname,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179' },
  webServer: {
    command:
      'pnpm --filter @inkcre/ext-mail exec vite --config tests/vite.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    cwd: new URL('../../..', import.meta.url).pathname,
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
  },
})
