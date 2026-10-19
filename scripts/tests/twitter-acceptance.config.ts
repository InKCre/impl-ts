import { defineConfig } from '@playwright/test'
import baseConfig from '../../playwright.config'

export default defineConfig({
  ...baseConfig,
  testDir: '.',
  outputDir: '../../test-results/twitter-acceptance',
  projects: [
    {
      name: 'twitter-info-base',
      testMatch: 'twitter-info-base.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
        // The explicit form POST carries a Peer JWT; traces persist request bodies.
        trace: 'off',
      },
    },
  ],
})
