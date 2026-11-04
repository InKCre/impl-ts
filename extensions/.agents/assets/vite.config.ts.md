# Example of `extensions/*/vite.config.ts`

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { federation } from "@module-federation/vite";
import mfShared from "../mf-shared";
import path from "path";

export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    federation({
      name: 'extension.extension_id',
      filename: "remoteEntry.js",
      exposes: {
        ".": path.resolve(__dirname, "./src/index.ts"),
        "./components/ContentComp": path.resolve(
          __dirname,
          "./src/components/ContentComp.vue"
        ),
        ...
      },
      shared: mfShared,
    }),
  ],
  base: "/{extension_id}/web/",
  build: {
    target: "esnext",
    outDir: "dist/web",
    sourcemap: true
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: (source: string, file: string) => {
          if (file.includes("src/components/")) {
            return `@use "@inkcre/ui-web/styles/mixins" as *;@use "@inkcre/ui-web/styles/functions" as *;${source}`;
          }
          return source;
        },
      },
    },
  },
});

```
