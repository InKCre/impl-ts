import { createApp, ref } from 'vue'
import { INK_I18N_KEY } from '@inkcre/ui-web'
import { zhCN } from '@inkcre/ui-web/locales'
import '~/styles'
import '~/logic/collection/ui.css'
import Options from './Options.vue'

const app = createApp(Options)
app.provide(INK_I18N_KEY, {
  locale: ref('zh-CN'),
  t: (key) => {
    let value: unknown = zhCN
    for (const part of key.split('.')) {
      if (!value || typeof value !== 'object') return key
      value = (value as Record<string, unknown>)[part]
    }
    return typeof value === 'string' ? value : key
  },
})
app.mount('#app')
