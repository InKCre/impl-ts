import { computed, inject } from 'vue'
import { INK_I18N_KEY } from '@inkcre/ui-web'

export function useText() {
  const i18n = inject(INK_I18N_KEY, undefined)
  const zh = computed(() => i18n?.locale.value.startsWith('zh') ?? false)
  return (en: string, cn: string) => (zh.value ? cn : en)
}
