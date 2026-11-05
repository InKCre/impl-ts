import { onScopeDispose, shallowRef, watchEffect, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'

export const pageObjectTitle = shallowRef<{ path: string; value: string } | null>(null)

/** Detail pages contribute a saved object name; App owns route labels and document.title. */
export function usePageObjectTitle(title: ComputedRef<string | undefined>): void {
  const route = useRoute()
  let contribution: typeof pageObjectTitle.value = null
  watchEffect(() => {
    contribution = title.value ? { path: route.fullPath, value: title.value } : null
    pageObjectTitle.value = contribution
  })
  onScopeDispose(() => {
    if (pageObjectTitle.value === contribution) pageObjectTitle.value = null
  })
}
