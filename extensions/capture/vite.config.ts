import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { federation } from '@module-federation/vite'
import mfShared from '../mf-shared'
import extensionPackage from './package.json'

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'extension.capture',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: { '.': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      shared: mfShared(extensionPackage.inkcre.module_federation.host_sdk_version),
    }),
  ],
  base: './',
  build: { target: 'es2022', outDir: 'dist/client-web', sourcemap: true },
})
