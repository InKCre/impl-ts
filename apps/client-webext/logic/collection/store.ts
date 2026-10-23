import { z } from 'zod'
import { MaterialReceiptSchema, SubmitMaterialSchema } from '@inkcre/web-collection'

export const ConnectionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.url(),
  secret: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength >= 32,
      '密钥至少需要 32 UTF-8 bytes'
    ),
  peerId: z.uuid(),
  storageId: z.number().int(),
})
export type Connection = z.infer<typeof ConnectionSchema>
export const SettingsSchema = z.object({
  profileId: z.uuid().default(() => crypto.randomUUID()),
  activeConnectionId: z.uuid().nullable().default(null),
  paused: z.boolean().default(false),
  origins: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([]),
})
export type CollectionSettings = z.infer<typeof SettingsSchema>
export const OutboxItemSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  createdAt: z.number(),
  automatic: z.boolean(),
  url: z.string(),
  importId: z.uuid().optional(),
  observationKey: z.string().optional(),
  state: z.enum(['pending', 'sending', 'blocked', 'confirmed']),
  command: SubmitMaterialSchema.optional(),
  receipt: MaterialReceiptSchema.optional(),
  error: z.string().optional(),
})
export type OutboxItem = z.infer<typeof OutboxItemSchema>

let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('inkcre-webext-collection', 1)
    request.onupgradeneeded = () => {
      for (const name of ['settings', 'connections', 'outbox', 'imports', 'legacy'])
        request.result.createObjectStore(name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('请关闭旧的扩展设置页面后重试。'))
  })
  return database
}
export function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const tx = (await openDatabase()).transaction(stores, mode)
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('本机保存事务已取消。'))
    tx.onerror = () => reject(tx.error)
  })
  try {
    const result = await action(tx)
    await completed
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* The transaction may already have aborted. */
    }
    await completed.catch(() => undefined)
    throw error
  }
}
export async function settings(): Promise<CollectionSettings> {
  const current = await transaction(['settings'], 'readonly', (tx) =>
    idbResult(tx.objectStore('settings').get('current'))
  )
  if (current) return SettingsSchema.parse(current)
  return transaction(['settings'], 'readwrite', async (tx) => {
    const parsed = SettingsSchema.parse(
      (await idbResult(tx.objectStore('settings').get('current'))) ?? {}
    )
    await idbResult(tx.objectStore('settings').put(parsed, 'current'))
    return parsed
  })
}
export async function setSettings(value: CollectionSettings): Promise<void> {
  const parsed = SettingsSchema.parse(value)
  await transaction(['settings'], 'readwrite', async (tx) => {
    await idbResult(tx.objectStore('settings').put(parsed, 'current'))
  })
}
export async function connections(): Promise<Connection[]> {
  return transaction(['connections'], 'readonly', async (tx) =>
    z.array(ConnectionSchema).parse(await idbResult(tx.objectStore('connections').getAll()))
  )
}
export async function connection(id: string): Promise<Connection> {
  return transaction(['connections'], 'readonly', async (tx) => {
    const raw = await idbResult(tx.objectStore('connections').get(id))
    if (!raw) throw new Error('原信息库的凭据不可用；待发送材料仍留在本机。')
    return ConnectionSchema.parse(raw)
  })
}
export async function saveConnection(value: Connection): Promise<void> {
  const parsed = ConnectionSchema.parse(value)
  await transaction(['connections', 'settings'], 'readwrite', async (tx) => {
    const previous = await idbResult(tx.objectStore('connections').get(parsed.id))
    if (previous && previous.peerId !== parsed.peerId)
      throw new Error('修改连接不能更换本 Peer 身份。')
    await idbResult(tx.objectStore('connections').put(parsed, parsed.id))
    const config = SettingsSchema.parse(
      (await idbResult(tx.objectStore('settings').get('current'))) ?? {}
    )
    await idbResult(
      tx.objectStore('settings').put({ ...config, activeConnectionId: parsed.id }, 'current')
    )
  })
}
export async function outbox(): Promise<OutboxItem[]> {
  return transaction(['outbox'], 'readonly', async (tx) =>
    z
      .array(OutboxItemSchema)
      .parse(await idbResult(tx.objectStore('outbox').getAll()))
      .sort((a, b) => a.createdAt - b.createdAt)
  )
}
export async function updateOutbox(item: OutboxItem): Promise<void> {
  const parsed = OutboxItemSchema.parse(item)
  await transaction(['outbox'], 'readwrite', async (tx) => {
    await idbResult(tx.objectStore('outbox').put(parsed, parsed.id))
  })
}
export async function importRunning(id: string): Promise<boolean> {
  return transaction(['imports'], 'readonly', async (tx) => {
    const value = await idbResult(tx.objectStore('imports').get(id))
    return value?.state === 'running'
  })
}
export function allowsAutomatic(config: CollectionSettings, url: string): boolean {
  const origin = new URL(url).origin
  return (
    !config.paused &&
    config.origins.includes(origin) &&
    !config.excluded.some((rule) => url === rule || origin === rule)
  )
}

export async function enqueue(item: OutboxItem, importCheckpoint?: { id: string }): Promise<void> {
  const parsed = OutboxItemSchema.parse(item)
  await transaction(['outbox', 'settings', 'connections', 'imports'], 'readwrite', async (tx) => {
    const config = SettingsSchema.parse(
      (await idbResult(tx.objectStore('settings').get('current'))) ?? {}
    )
    if (parsed.automatic && !allowsAutomatic(config, parsed.url))
      throw new Error('此页面的自动采集已暂停或排除。')
    if (!(await idbResult(tx.objectStore('connections').get(parsed.connectionId))))
      throw new Error('请先加入信息库。')
    const existing = z
      .array(OutboxItemSchema)
      .parse(await idbResult(tx.objectStore('outbox').getAll()))
    const replaced =
      parsed.automatic && parsed.observationKey
        ? existing.filter(
            (entry) => entry.observationKey === parsed.observationKey && entry.state === 'pending'
          )
        : []
    const pending = existing.filter(
      (entry) => entry.state !== 'confirmed' && !replaced.includes(entry)
    )
    const bytes = new TextEncoder().encode(JSON.stringify([...pending, parsed])).byteLength
    if (pending.length >= 200 || bytes > 128 * 1024 * 1024)
      throw new Error('本机待发送队列已满。已排队材料保留，请恢复发送后再保存。')
    if (existing.some((entry) => entry.id === parsed.id)) throw new Error('提交已经存在。')
    await idbResult(tx.objectStore('outbox').add(parsed, parsed.id))
    for (const entry of replaced) await idbResult(tx.objectStore('outbox').delete(entry.id))
    if (parsed.observationKey)
      for (const entry of existing)
        if (entry.state === 'confirmed' && entry.observationKey === parsed.observationKey)
          await idbResult(tx.objectStore('outbox').delete(entry.id))
    if (importCheckpoint)
      await idbResult(tx.objectStore('imports').put(importCheckpoint, importCheckpoint.id))
  })
}
