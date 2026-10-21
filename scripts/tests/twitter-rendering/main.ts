import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import '@inkcre/ui-web/styles'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import App from './specimens.vue'

createApp(App)
  .use(
    createI18n({
      legacy: false,
      locale: 'en',
      messages: {
        en: {
          common: { refresh: 'Refresh', close: 'Close' },
          infoBase: { solvedContent: { title: 'Post', missing: 'Post not found' } },
        },
      },
    })
  )
  .mount('#app')
