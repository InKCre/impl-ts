import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { federation } from '@module-federation/vite'
import mfShared from '../mf-shared'
import extensionPackage from './package.json'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'local-files-license',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE',
          source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_NOTICES.txt',
          source: readFileSync(new URL('../../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8'),
        })
      },
    },
    federation({
      name: 'extension.localFiles',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: { '.': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      shared: mfShared(
        extensionPackage.inkcre.module_federation.host_sdk_version,
        extensionPackage.devDependencies['@inkcre/ui-web']
      ),
    }),
  ],
  base: './',
  build: { target: 'es2022', outDir: 'dist/client-web', sourcemap: true },
})
