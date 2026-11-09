import { defineConfig } from 'tsdown'

const common = {
  format: 'esm' as const,
  platform: 'neutral' as const,
  target: 'esnext',
  sourcemap: true,
  treeshake: true,
  deps: { neverBundle: true },
  dts: { generator: 'tsc' as const, resolver: 'tsc' as const, sourcemap: true },
}

// Separate graphs keep the SDK's declarations independent of Vue peer dependencies.
export default defineConfig([
  {
    ...common,
    entry: {
      index: 'src/index.ts',
      'browser-automation-protocol': 'src/browser-automation/protocol.ts',
    },
    outDir: 'dist',
    clean: false,
  },
  { ...common, entry: ['src/sdk.ts'], outDir: 'dist/sdk', clean: false },
])
