import { readonly, ref } from 'vue'

const open = ref(false)

export const recallSearchOpen = readonly(open)
export function openRecallSearch(): void {
  open.value = true
}
export function closeRecallSearch(): void {
  open.value = false
}
