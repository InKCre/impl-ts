import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const app = resolve(root, 'apps/client-web')
const require = createRequire(resolve(app, 'package.json'))

export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@/core', replacement: resolve(root, 'scripts/tests/twitter-rendering/host.ts') },
      { find: '@', replacement: resolve(app, 'src') },
      { find: '@inkcre/core', replacement: resolve(root, 'packages/core/src/index.ts') },
      ...[
        'vue',
        'vue-i18n',
        '@vue-flow/core',
        '@vue-flow/core/dist/style.css',
        '@vue-flow/core/dist/theme-default.css',
        '@inkcre/ui-web',
        '@inkcre/ui-web/styles',
        '@inkcre/ui-web/styles/mixins',
        '@inkcre/ui-web/styles/functions',
      ].map((name) => ({
        find: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
        replacement: require.resolve(name),
      })),
    ],
    dedupe: ['vue'],
  },
  server: { fs: { allow: [root] } },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData:
          '@use "@inkcre/ui-web/styles/mixins" as *; @use "@inkcre/ui-web/styles/functions" as *;',
      },
    },
  },
}
