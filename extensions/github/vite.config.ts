import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import { federation } from '@module-federation/vite'

import mfShared from '../mf-shared'
import extensionPackage from './package.json'
import {
  createUiSourceAliases,
  isPathInside,
  resolveUiSourceForVite,
  uiSourceDedupe,
} from '../../scripts/ui-source.mjs'

const extensionRoot = fileURLToPath(new URL('.', import.meta.url))
const extensionComponents = fileURLToPath(new URL('./src/components', import.meta.url))

export const githubArtifactBase = './'
export const githubBuildTarget = 'es2022'
export const githubBuildOptions = {
  target: githubBuildTarget,
  outDir: 'dist/client-web',
  sourcemap: true,
}
export const githubFederationOptions = {
  name: 'extension.github',
  filename: 'remoteEntry.js',
  manifest: true,
  exposes: { '.': path.resolve(__dirname, './src/index.ts') },
  shared: mfShared(extensionPackage.inkcre.module_federation.host_sdk_version),
}

export default defineConfig(async ({ command }) => {
  const uiSource = await resolveUiSourceForVite(command)
  const uiSourceComponents = uiSource ? path.resolve(uiSource.root, 'src/components') : null

  return {
    plugins: [vue(), federation(githubFederationOptions)],
    resolve: {
      alias: uiSource ? createUiSourceAliases(uiSource) : [],
      ...(uiSource ? { dedupe: uiSourceDedupe } : {}),
    },
    ...(uiSource
      ? {
          optimizeDeps: { exclude: ['@inkcre/ui-web'] },
          server: {
            fs: { allow: [searchForWorkspaceRoot(extensionRoot), uiSource.root] },
          },
        }
      : {}),
    base: githubArtifactBase,
    build: githubBuildOptions,
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: (source: string, file: string) => {
            if (
              isPathInside(extensionComponents, file) ||
              (uiSourceComponents && isPathInside(uiSourceComponents, file))
            ) {
              return `@use "@inkcre/ui-web/styles/mixins" as *;@use "@inkcre/ui-web/styles/functions" as *;${source}`
            }
            return source
          },
        },
      },
    },
  }
})
