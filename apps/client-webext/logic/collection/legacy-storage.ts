import { browser } from 'wxt/browser'
import { idbResult, transaction } from './store'

const protectedKeys = ['inkcre_app_config', 'llmProviders', 'tasks'] as const
function assertExtensionOrigin() {
  if (!['chrome-extension:', 'moz-extension:'].includes(location.protocol))
    throw new Error('连接和旧配置仅允许扩展自身页面读取。')
}
export async function readLegacyValue(key: (typeof protectedKeys)[number]): Promise<unknown> {
  assertExtensionOrigin()
  const existing = await transaction(['legacy'], 'readonly', (tx) =>
    idbResult(tx.objectStore('legacy').get(key))
  )
  if (existing !== undefined) return existing
  const previous = (await browser.storage.local.get(key))[key]
  if (previous === undefined) return null
  const value = await transaction(['legacy'], 'readwrite', async (tx) => {
    const current = await idbResult(tx.objectStore('legacy').get(key))
    if (current !== undefined) return current
    await idbResult(tx.objectStore('legacy').put(previous, key))
    return previous
  })
  await browser.storage.local.remove(key)
  return value
}
export async function migrateLegacyStorage() {
  assertExtensionOrigin()
  for (const key of protectedKeys) {
    await readLegacyValue(key)
    // A previous run may have stopped after the IDB copy, before removing the old key.
    await browser.storage.local.remove(key)
  }
}
