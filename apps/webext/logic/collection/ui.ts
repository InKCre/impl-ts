import { ref, onMounted, onUnmounted } from 'vue'
import { collectionMessage } from './messages'
import type { CollectionStatus } from './runtime'
import type { CollectionSettings } from './store'

export function useCollectionStatus() {
  const status = ref<CollectionStatus>()
  const error = ref('')
  const feedback = ref('')
  const busy = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  async function refresh() {
    status.value = await collectionMessage<CollectionStatus>({ type: 'collection-status' })
  }
  async function action(work: () => Promise<unknown>, result = '') {
    if (busy.value) return
    busy.value = true
    error.value = ''
    feedback.value = ''
    try {
      await work()
      feedback.value = result
      await refresh()
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure)
    } finally {
      busy.value = false
    }
  }
  async function updateSettings(config: CollectionSettings) {
    await collectionMessage({ type: 'collection-settings', settings: config })
    await refresh()
  }
  onMounted(() => {
    void refresh().catch((failure: unknown) => {
      error.value = String(failure)
    })
    timer = setInterval(() => {
      void refresh().catch((failure: unknown) => {
        error.value = String(failure)
      })
    }, 3000)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })
  return { status, error, feedback, busy, refresh, action, updateSettings }
}
export const deliveryLabels = {
  pending: '已在本机等待发送',
  sending: '正在发送或核对结果',
  blocked: '需要处理',
  confirmed: '已保存到信息库',
}
