// Shared dependencies for Module Federation remote (extensions).

import packageJson from '../apps/client-web/package.json'
export default function mfShared(hostSdkVersion: string, uiVersion: string) {
  return {
    '@inkcre/ui-web': {
      singleton: true,
      requiredVersion: uiVersion,
    },
    vue: { singleton: true, requiredVersion: packageJson.dependencies.vue },
    pinia: { singleton: true, requiredVersion: packageJson.dependencies.pinia },
    'vue-router': {
      singleton: true,
      requiredVersion: packageJson.dependencies['vue-router'],
    },
    '@vueuse/core': {
      singleton: true,
      requiredVersion: packageJson.dependencies['@vueuse/core'],
    },
    zod: { singleton: true, requiredVersion: packageJson.dependencies.zod },
    '@inkcre/core': {
      singleton: true,
      requiredVersion: hostSdkVersion,
      import: false,
    },
  } as const
}
