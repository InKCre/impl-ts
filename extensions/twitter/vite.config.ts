import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { federation } from '@module-federation/vite'
import mfShared from '../mf-shared'
import extensionPackage from './package.json'
import path from 'path'
import {
  createUiSourceAliases,
  isPathInside,
  resolveUiSourceForVite,
  uiSourceDedupe,
} from '../../scripts/ui-source.mjs'

const extensionRoot = fileURLToPath(new URL('.', import.meta.url))
const extensionComponents = fileURLToPath(new URL('./src/components', import.meta.url))

const federationOptions = {
  name: `extension.twitter`,
  filename: 'remoteEntry.js',
  manifest: true,
  exposes: {
    '.': path.resolve(__dirname, './src/index.ts'),
    './components/ContentTweet': path.resolve(
      __dirname,
      './src/components/contentTweet/contentTweet.vue'
    ),
  },
  shared: mfShared(
    extensionPackage.inkcre.module_federation.host_sdk_version,
    extensionPackage.devDependencies['@inkcre/ui-web']
  ),
}

export default defineConfig(async ({ command }) => {
  const uiSource = await resolveUiSourceForVite(command)
  const uiSourceComponents = uiSource ? path.resolve(uiSource.root, 'src/components') : null

  return {
    plugins: [vue(), vueJsx(), federation(federationOptions)],
    resolve: {
      alias: uiSource ? createUiSourceAliases(uiSource) : [],
      ...(uiSource ? { dedupe: uiSourceDedupe } : {}),
    },
    ...(uiSource
      ? {
          optimizeDeps: {
            exclude: ['@inkcre/ui-web'],
          },
          server: {
            fs: {
              allow: [searchForWorkspaceRoot(extensionRoot), uiSource.root],
            },
          },
        }
      : {}),
    base: './',
    build: {
      target: 'es2022',
      outDir: 'dist/web',
      sourcemap: true,
    },
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
