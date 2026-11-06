import { bootstrapExtension } from '@inkcre/ext-dev-utils'
import '@inkcre/ui-web/styles'
import App from './DevApp.vue'
import extensionModule from './index.ts'

void bootstrapExtension({ rootComponent: App, extensionModule }).catch(() =>
  console.error('无法启动 B 站插件开发页面。')
)
