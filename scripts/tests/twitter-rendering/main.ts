import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import '@inkcre/ui-web/styles'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import en from '../../../apps/client-web/src/locales/messages/en.json'
import App from './specimens.vue'

createApp(App)
  .use(
    createI18n({
      legacy: false,
      locale: 'en',
      messages: { en },
    })
  )
  .mount('#app')
