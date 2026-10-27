import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'wxt'
import { key as chromiumKey } from './chromium-key.json'

const require = createRequire(import.meta.url)
const devInstance = process.env.INKCRE_DEV_INSTANCE
const devPort = Number.parseInt(process.env.PORT ?? '', 10)
const portlessUrl = process.env.PORTLESS_URL
const chromiumProfile = process.env.INKCRE_WXT_PROFILE_DIR
const chromiumBinary = process.env.INKCRE_CHROMIUM_BINARY

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  hooks: {
    'build:publicAssets'(_wxt, files) {
      files.push({
        absoluteSrc: fileURLToPath(new URL('../../THIRD_PARTY_NOTICES.txt', import.meta.url)),
        relativeDest: 'THIRD_PARTY_NOTICES.txt',
      })
      for (const [relativeDest, asset] of [
        ['icon/16.png', 'png/original-white/inkcre-original-white-16.png'],
        ['icon/32.png', 'png/original-white/inkcre-original-white-32.png'],
        ['icon/48.png', 'png/original-white/inkcre-original-white-48.png'],
        ['icon/96.png', 'png/2x/original-white/inkcre-original-white-48px@2x.png'],
        ['icon/128.png', 'png/original-white/inkcre-original-white-128.png'],
        ['toolbar/16.png', 'png/original-transparent/inkcre-original-transparent-16.png'],
        ['toolbar/32.png', 'png/2x/original-transparent/inkcre-original-transparent-16px@2x.png'],
        ['toolbar/48.png', 'png/3x/original-transparent/inkcre-original-transparent-16px@3x.png'],
        ['toolbar/reverse-16.png', 'png/reverse-transparent/inkcre-reverse-transparent-16.png'],
        [
          'toolbar/reverse-32.png',
          'png/2x/reverse-transparent/inkcre-reverse-transparent-16px@2x.png',
        ],
        [
          'toolbar/reverse-48.png',
          'png/3x/reverse-transparent/inkcre-reverse-transparent-16px@3x.png',
        ],
        ['toolbar/canvas-16.png', 'png/original-white/inkcre-original-white-16.png'],
        ['toolbar/canvas-32.png', 'png/2x/original-white/inkcre-original-white-16px@2x.png'],
        ['toolbar/canvas-48.png', 'png/3x/original-white/inkcre-original-white-16px@3x.png'],
      ]) {
        files.push({
          absoluteSrc: require.resolve(`@inkcre/ui-web/logo/${asset}`),
          relativeDest,
        })
      }
    },
  },
  manifestVersion: 3,
  manifest: ({ browser, mode }) => ({
    name: 'InKCre WebExt',
    ...(browser !== 'firefox' && mode !== 'migration' ? { key: chromiumKey } : {}),
    action: {
      // A 16-DIP toolbar mark needs optical geometry at every pixel density.
      default_icon: {
        16: 'toolbar/canvas-16.png',
        32: 'toolbar/canvas-32.png',
        48: 'toolbar/canvas-48.png',
      },
      ...(browser === 'firefox'
        ? {
            theme_icons: [16, 32, 48].map((size) => ({
              size,
              light: `toolbar/reverse-${size}.png`,
              dark: `toolbar/${size}.png`,
            })),
          }
        : {}),
    },
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'alarms',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    optional_permissions: ['bookmarks', 'history'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    ...(browser === 'firefox' ? {} : { minimum_chrome_version: '116' }),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'webext@inkcre.org', strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
  zip: {
    artifactTemplate: 'inkcre-webext-{{version}}-{{browser}}-{{mode}}.zip',
    // AMO needs the workspace and its private dependency sources, not an app-only ZIP.
    zipSources: false,
  },
  dev: Number.isInteger(devPort)
    ? {
        server: {
          host: '127.0.0.1',
          port: devPort,
          origin: portlessUrl,
          strictPort: true,
        },
      }
    : undefined,
  vite: () => ({
    resolve: {
      alias: {
        '@inkcre/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    },
    plugins: [
      {
        name: 'inkcre-webext-dev-identity',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!devInstance || request.url !== `/__inkcre/dev/${devInstance}`) {
              next()
              return
            }

            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json')
            response.setHeader('Cache-Control', 'no-store')
            response.end(JSON.stringify({ instance: devInstance, target: 'webext' }))
          })
        },
      },
    ],
    build: {
      sourcemap: 'inline',
    },
  }),
  webExt:
    chromiumBinary && chromiumProfile
      ? {
          binaries: {
            chrome: chromiumBinary,
          },
          chromiumProfile,
          keepProfileChanges: true,
        }
      : {
          disabled: true,
        },
})
