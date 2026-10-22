import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [vue()],
  server: { fs: { allow: [searchForWorkspaceRoot(root)] } },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData:
          '@use "@inkcre/ui-web/styles/mixins" as *;@use "@inkcre/ui-web/styles/functions" as *;',
      },
    },
  },
})
