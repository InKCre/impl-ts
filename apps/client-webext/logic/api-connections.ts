import { computed, ref } from 'vue'
import { storage } from '@wxt-dev/storage'
import { z } from 'zod'

const ConnectionSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  url: z.url().refine((value) => {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  }, '请输入不含凭据、查询参数或片段的 HTTP(S) 地址。'),
})
const SettingsSchema = z
  .object({
    connections: z.array(ConnectionSchema),
    activeId: z.uuid().nullable(),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.connections.map((item) => item.id))
    if (
      ids.size !== value.connections.length ||
      (value.activeId !== null && !ids.has(value.activeId))
    ) {
      context.addIssue({ code: 'custom', message: '保存的连接列表无效。' })
    }
  })
type Settings = z.infer<typeof SettingsSchema>
const key = 'local:inkcreApiConnections' as const
export const apiConnections = ref<Settings>({ connections: [], activeId: null })
export const apiConnectionIssue = ref('')
export const inkcreApi = computed(
  () =>
    apiConnections.value.connections.find((item) => item.id === apiConnections.value.activeId)
      ?.url ?? ''
)

export const apiConnectionsReady = (async () => {
  try {
    const stored = await storage.getItem(key)
    if (stored !== null) {
      apiConnections.value = SettingsSchema.parse(
        typeof stored === 'string' ? JSON.parse(stored) : stored
      )
      return
    }
    const previous = await storage.getItem<string>('local:inkcreApi')
    if (!previous) return
    const id = crypto.randomUUID()
    await saveApiConnections({
      activeId: id,
      connections: [{ id, name: new URL(previous).host, url: previous }],
    })
  } catch {
    apiConnectionIssue.value = '无法读取保存的连接。'
  }
})()

storage.watch(key, (stored) => {
  try {
    apiConnections.value = SettingsSchema.parse(
      typeof stored === 'string' ? JSON.parse(stored) : stored
    )
    apiConnectionIssue.value = ''
  } catch {
    apiConnectionIssue.value = '保存的连接列表无效。'
  }
})

async function saveApiConnections(candidate: Settings) {
  const settings = SettingsSchema.parse(candidate)
  await storage.setItem(key, JSON.stringify(settings))
  apiConnections.value = settings
  apiConnectionIssue.value = ''
}

export async function saveApiConnection(id: string, name: string, url: string) {
  await apiConnectionsReady
  const connection = ConnectionSchema.parse({ id, name: name.trim() || new URL(url).host, url })
  const connections = apiConnections.value.connections.filter((item) => item.id !== id)
  connections.push(connection)
  await saveApiConnections({ connections, activeId: id })
}

export async function selectApiConnection(id: string) {
  await apiConnectionsReady
  await saveApiConnections({ ...apiConnections.value, activeId: id })
}
