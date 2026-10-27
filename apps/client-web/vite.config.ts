import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import type { ViteDevServer } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import vueJsx from '@vitejs/plugin-vue-jsx'
import {
  createUiSourceAliases,
  isPathInside,
  resolveUiSourceForVite,
  uiSourceDedupe,
} from '../../scripts/ui-source.mjs'
import { useExtensionDevServer } from './vite-plugins/joint-dev-extension'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const clientScssRoots = ['components', 'views', 'extensions'].map((directory) =>
  fileURLToPath(new URL(`./src/${directory}`, import.meta.url))
)

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devInstance = process.env.INKCRE_DEV_INSTANCE
  const devTarget = process.env.INKCRE_DEV_TARGET ?? 'web'
  const devPort = Number.parseInt(process.env.PORT ?? '', 10)
  const portlessUrl = process.env.PORTLESS_URL
  const uiSource = await resolveUiSourceForVite(command)
  const uiSourceComponents = uiSource ? resolve(uiSource.root, 'src/components') : null

  const toDebugExtensions = env.DEBUG_EXTENSIONS
    ? env.DEBUG_EXTENSIONS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const { plugin: extensionDevPlugin } = await useExtensionDevServer({
    active: toDebugExtensions,
    dir: '../../extensions',
  })

  return {
    plugins: [
      {
        name: 'inkcre-dev-identity',
        configureServer(server: ViteDevServer) {
          server.middlewares.use((request, response, next) => {
            if (!devInstance || request.url !== `/__inkcre/dev/${devInstance}`) {
              next()
              return
            }

            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json')
            response.setHeader('Cache-Control', 'no-store')
            response.end(
              JSON.stringify({
                instance: devInstance,
                target: devTarget,
                ...(uiSource ? { uiSource: uiSource.identity } : {}),
              })
            )
          })
        },
      },
      {
        name: 'content-reading-notices',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'THIRD_PARTY_NOTICES.txt',
            source: readFileSync(new URL('../../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8'),
          })
        },
      },
      extensionDevPlugin,
      vue(),
      vueJsx(),
      vueDevTools(),
      UnoCSS(),
    ],
    resolve: {
      alias: [
        ...(uiSource ? createUiSourceAliases(uiSource) : []),
        {
          find: '@',
          replacement: fileURLToPath(new URL('./src', import.meta.url)),
        },
        {
          find: '@inkcre/core',
          replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
        },
      ],
      ...(uiSource ? { dedupe: uiSourceDedupe } : {}),
    },
    optimizeDeps: {
      exclude: ['@inkcre/extension-runtime-client-web', ...(uiSource ? ['@inkcre/ui-web'] : [])],
    },
    server: {
      host: '127.0.0.1',
      ...(Number.isInteger(devPort)
        ? {
            port: devPort,
            strictPort: true,
          }
        : {}),
      ...(portlessUrl ? { origin: portlessUrl } : {}),
      ...(uiSource
        ? {
            fs: {
              allow: [searchForWorkspaceRoot(appRoot), uiSource.root],
            },
          }
        : {}),
    },
    build: {
      target: 'esnext',
      sourcemap: true,
    },
    css: {
      devSourcemap: true,
      preprocessorOptions: {
        scss: {
          additionalData: (source: string, file: string) => {
            if (clientScssRoots.some((root) => isPathInside(root, file))) {
              return `@use "@inkcre/ui-web/styles/mixins" as *;@use "@inkcre/ui-web/styles/functions" as *;@use "@/styles/index.scss" as *;${source}`
            }
            if (uiSourceComponents && isPathInside(uiSourceComponents, file)) {
              return `@use "@inkcre/ui-web/styles/mixins" as *;@use "@inkcre/ui-web/styles/functions" as *;${source}`
            }
            return source
          },
        },
      },
    },
  }
})
