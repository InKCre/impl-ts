import { bootstrapExtension } from '@inkcre/ext-dev-utils'
import '@inkcre/ui-web/styles'
import App from './DevApp.vue'
import extensionModule from './index'

void bootstrapExtension({
  rootComponent: App,
  extensionModule,
  routes: [{ path: '/', component: () => import('./CalDAVSetup.vue') }],
}).catch(() => console.error('Unable to start the CalDAV extension playground.'))
