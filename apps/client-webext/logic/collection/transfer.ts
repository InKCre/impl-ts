import { z } from 'zod'
import { ImportSchema } from './imports'
import { ConnectionSchema, OutboxItemSchema, SettingsSchema, idbResult, transaction } from './store'

const stores = ['settings', 'connections', 'outbox', 'imports', 'legacy']
const TransferSchema = z.object({
  format: z.literal('inkcre-webext-local-v1'),
  settings: SettingsSchema,
  connections: z.array(ConnectionSchema),
  outbox: z.array(OutboxItemSchema),
  imports: z.array(ImportSchema),
  legacy: z.array(z.tuple([z.string(), z.unknown()])),
})

export async function exportLocalData() {
  return transaction(stores, 'readonly', async (tx) => {
    const [settings, connections, outbox, imports, keys, values] = await Promise.all([
      idbResult(tx.objectStore('settings').get('current')),
      idbResult(tx.objectStore('connections').getAll()),
      idbResult(tx.objectStore('outbox').getAll()),
      idbResult(tx.objectStore('imports').getAll()),
      idbResult(tx.objectStore('legacy').getAllKeys()),
      idbResult(tx.objectStore('legacy').getAll()),
    ])
    return TransferSchema.parse({
      format: 'inkcre-webext-local-v1',
      settings,
      connections,
      outbox,
      imports,
      legacy: keys.map((key, index) => [key, values[index]]),
    })
  })
}

export async function importLocalData(raw: unknown) {
  const data = TransferSchema.parse(raw)
  const ids = new Set(data.connections.map((connection) => connection.id))
  if (data.settings.activeConnectionId && !ids.has(data.settings.activeConnectionId))
    throw new Error('文件缺少当前信息库连接。')
  for (const item of [...data.outbox, ...data.imports])
    if (!ids.has(item.connectionId)) throw new Error('文件中的待办缺少原信息库连接。')
  for (const records of [data.connections, data.outbox, data.imports])
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error('文件包含重复记录。')
  await transaction(stores, 'readwrite', async (tx) => {
    const counts = await Promise.all(
      stores.slice(1).map((name) => idbResult(tx.objectStore(name).count()))
    )
    if (counts.some(Boolean)) throw new Error('仅能迁入空的扩展实例；现有数据未修改。')
    await idbResult(tx.objectStore('settings').put(data.settings, 'current'))
    for (const name of ['connections', 'outbox', 'imports'] as const)
      for (const record of data[name]) await idbResult(tx.objectStore(name).add(record, record.id))
    for (const [key, value] of data.legacy)
      await idbResult(tx.objectStore('legacy').add(value, key))
  })
}
