import { z } from 'zod'
import { MetaConfigSchema, readConnectionSettings } from '@inkcre/core'
import { browser, type Browser } from 'wxt/browser'
import { textPart, type SubmitMaterial } from '@inkcre/web-collection'
import { PageCaptureSchema, type PageCapture } from './capture'
import { refreshPeer, peerErrors, databaseURL, materialClient } from './database'
import { fetchMaterial } from './fetch'
import { bookmarkFolders, changeImport, importRuns, importStep, previewImport } from './imports'
import { migrateLegacyStorage, readLegacyValue } from './legacy-storage'
import { siteMatchPattern } from './permissions'
import { coordinate, deliverBatch, queueSubmission } from './outbox'
import {
  ConnectionSchema,
  SettingsSchema,
  allowsAutomatic,
  idbResult,
  transaction,
  connection,
  connections,
  outbox,
  saveConnection,
  setSettings,
  settings,
  updateOutbox,
} from './store'

type Sender = Browser.runtime.MessageSender
const contentTypes = new Set([
  'collection-observe',
  'collection-auto-allowed',
  'collection-observation-error',
])
const pageTypes = new Set([
  'collection-status',
  'collection-wake',
  'collection-connect',
  'collection-check-connection',
  'collection-settings',
  'collection-enable-origin',
  'collection-save',
  'collection-read',
  'collection-retry',
  'collection-folders',
  'collection-preview-import',
  'collection-control-import',
  'collection-save-draft',
])
const tabErrors = new Map<number, string>()
let migrationWarning = ''
let work: Promise<void> | undefined
export function wakeWork(): Promise<void> {
  work ??= (async () => {
    const attempted = new Set<string>()
    while (true) {
      const dispatched = await deliverBatch(attempted)
      const imported = await importStep()
      if (!dispatched && !imported) break
    }
  })().finally(() => {
    work = undefined
  })
  return work
}
export async function refreshPeers(): Promise<void> {
  await Promise.all((await connections()).map(refreshPeer))
}
function httpURL(value: unknown): string {
  const url = z.url().parse(value)
  if (!/^https?:\/\//.test(url)) throw new Error('当前页面不是可采集的在线网页。')
  return url
}
async function activeTab(id?: unknown, expectedURL?: unknown) {
  const tab =
    id === undefined
      ? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : await browser.tabs.get(z.number().int().positive().parse(id))
  if (!tab?.id || !tab.url) throw new Error('未找到当前网页。')
  httpURL(tab.url)
  if (expectedURL !== undefined && tab.url !== expectedURL)
    throw new Error('网页已导航，请重新打开扩展取得内容。')
  return tab as typeof tab & { id: number; url: string }
}
async function sourceTab(sender: Sender) {
  if (sender.id !== browser.runtime.id || !sender.tab?.id || sender.frameId !== 0)
    throw new Error('不接受此页面消息。')
  const tab = await browser.tabs.get(sender.tab.id)
  // Firefox retains the content context's initial sender URL across History API navigation.
  if (!tab.url || !sender.url || new URL(tab.url).origin !== new URL(sender.url).origin)
    throw new Error('网页已导航，请重新取得内容。')
  httpURL(tab.url)
  return tab as typeof tab & { id: number; url: string }
}
async function automaticAllowed(tab: { url: string; incognito?: boolean }) {
  return (
    !tab.incognito &&
    allowsAutomatic(await settings(), tab.url) &&
    (await browser.permissions.contains({ origins: [siteMatchPattern(tab.url)] }))
  )
}
async function getCapture(tabId: number, selection: boolean): Promise<PageCapture> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/content-scripts/collection.js'],
  })
  return PageCaptureSchema.parse(
    await browser.tabs.sendMessage(tabId, { type: 'collection-capture', selection }, { frameId: 0 })
  )
}
async function enqueueCapture(capture: PageCapture, automatic: boolean) {
  const config = await settings()
  if (!config.activeConnectionId) throw new Error('请先加入信息库。')
  const target = await connection(config.activeConnectionId)
  const key = capture.material.url
  const scope = `browser-dom:${config.profileId}`
  const observationKey = `${target.id}:${key}`
  const command: SubmitMaterial = {
    request_id: crypto.randomUUID(),
    mode: automatic ? 'current' : 'fixed',
    source: {
      scope,
      key,
      metadata: {
        url: capture.material.url,
        title: capture.material.title,
        canonical: capture.material.canonical,
      },
    },
    material: capture.material,
    parts: capture.parts,
    storage_id: target.storageId,
  }
  return queueSubmission(target.id, command, {
    automatic,
    observationKey: automatic ? observationKey : undefined,
  })
}
export async function syncAutomaticScripts() {
  const existing = (await browser.scripting.getRegisteredContentScripts()).filter(
    (script) => script.id === 'inkcre-auto-collection'
  )
  if (existing.length)
    await browser.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) })
  const config = await settings()
  const matches = new Set<string>()
  for (const origin of config.origins)
    if (await browser.permissions.contains({ origins: [siteMatchPattern(origin)] }))
      matches.add(siteMatchPattern(origin))
  if (matches.size)
    await browser.scripting.registerContentScripts([
      {
        id: 'inkcre-auto-collection',
        matches: [...matches],
        js: ['content-scripts/collection.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
        allFrames: false,
      },
    ])
}
export async function initializeCollection() {
  await migrateLegacyStorage()
  await settings()
  if (!(await connections()).length) {
    const stored = await readLegacyValue('inkcre_app_config')
    try {
      if (stored !== null) {
        const input = typeof stored === 'string' ? JSON.parse(stored) : stored
        const previous = readConnectionSettings(input, MetaConfigSchema.parse(input))
        const migrated = previous.connections.map(({ id, name, config }) =>
          ConnectionSchema.parse({
            id,
            name,
            url: databaseURL(config.INKCRE_PGREST_URL),
            secret: config.INKCRE_JWT_SECRET,
            peerId: config.INKCRE_PEER_ID,
            storageId: -4,
          })
        )
        // Keep the whole migration atomic and never replace an already configured collection Peer.
        await transaction(['connections', 'settings'], 'readwrite', async (tx) => {
          if (await idbResult(tx.objectStore('connections').count())) return
          const config = SettingsSchema.parse(
            await idbResult(tx.objectStore('settings').get('current'))
          )
          for (const target of migrated)
            await idbResult(tx.objectStore('connections').put(target, target.id))
          await idbResult(
            tx
              .objectStore('settings')
              .put({ ...config, activeConnectionId: previous.activeConnectionId }, 'current')
          )
        })
      }
    } catch {
      migrationWarning = '旧连接配置不能自动转换，原值已保留。请在下方配置新的数据库连接。'
    }
  }
  await syncAutomaticScripts()
  await browser.alarms.create('inkcre-collection', { periodInMinutes: 1 })
}
export async function collectionStatus() {
  const config = await settings()
  const targets = (await connections()).map(({ secret: _secret, ...target }) => target)
  const items = (await outbox())
    .map(({ command: _command, ...item }) => item)
    .reverse()
    .slice(0, 100)
  const imports = (await importRuns()).map(({ remaining, failures, ...run }) => ({
    ...run,
    remainingCount: remaining.length,
    failuresCount: failures.length,
    failures: failures.slice(0, 20),
    sample: remaining.slice(0, 50),
    origins: [...new Set(remaining.map((item) => new URL(item.url).origin))],
  }))
  const raw = await readLegacyValue('tasks')
  let legacyTasks: { id: string; state: string; text: string; url: string }[] = []
  let legacyWarning = ''
  try {
    const tasks = z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          state: z.string(),
          parameters: z.record(z.string(), z.unknown()),
        })
      )
      .parse(typeof raw === 'string' ? JSON.parse(raw) : (raw ?? []))
    legacyTasks = tasks
      .filter((task) => task.type === 'taking-note' && task.state !== 'completed')
      .map((task) => ({
        id: task.id,
        state: task.state,
        text: typeof task.parameters.text === 'string' ? task.parameters.text : '',
        url: typeof task.parameters.url === 'string' ? task.parameters.url : '',
      }))
  } catch {
    legacyWarning = '旧待办格式无法自动读取，原数据仍保留在扩展内。'
  }
  return {
    config,
    connections: targets,
    peerErrors: peerErrors(),
    items,
    imports,
    migrationWarning,
    legacyWarning,
    legacyTasks,
    tabErrors: Object.fromEntries(tabErrors),
  }
}
export type CollectionStatus = Awaited<ReturnType<typeof collectionStatus>>
export function handlesCollectionMessage(message: unknown) {
  const type = (message as { type?: unknown })?.type
  return typeof type === 'string' && (contentTypes.has(type) || pageTypes.has(type))
}
export async function handleCollectionMessage(
  message: Record<string, unknown>,
  sender: Sender
): Promise<unknown> {
  const type = String(message.type)
  if (contentTypes.has(type)) {
    const tab = await sourceTab(sender)
    if (type === 'collection-auto-allowed') return { allowed: await automaticAllowed(tab) }
    if (type === 'collection-observation-error') {
      tabErrors.set(tab.id, z.string().max(1000).parse(message.error))
      return
    }
    if (type === 'collection-observe') {
      if (!(await automaticAllowed(tab))) return false
      const capture = PageCaptureSchema.parse(message.capture)
      if (capture.material.url !== tab.url) throw new Error('材料与实际网页不符。')
      if (typeof capture.material.http_status === 'number' && capture.material.http_status >= 400)
        throw new Error('HTTP 错误页未自动保存。')
      const result = await coordinate(() => enqueueCapture(capture, true))
      void wakeWork()
      return result
    }
    return
  }
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
    throw new Error('只接受扩展自身页面的操作。')
  if (type === 'collection-wake') {
    void wakeWork()
    return
  }
  if (type === 'collection-status') {
    return collectionStatus()
  }
  if (type === 'collection-connect') {
    const connectionId = z.uuid().optional().parse(message.connectionId)
    const existing = connectionId ? await connection(connectionId) : undefined
    const target = ConnectionSchema.parse({
      ...z.record(z.string(), z.unknown()).parse(message.connection),
      id: existing?.id ?? crypto.randomUUID(),
      peerId: existing?.peerId ?? crypto.randomUUID(),
    })
    target.url = databaseURL(target.url)
    await coordinate(() => saveConnection(target))
    if (!existing || target.url !== existing.url || target.secret !== existing.secret)
      void refreshPeer(target)
    void wakeWork()
    return target.id
  }
  if (type === 'collection-check-connection') {
    await refreshPeer(await connection(z.uuid().parse(message.connectionId)))
    return
  }
  if (type === 'collection-settings') {
    await coordinate(() => setSettings(SettingsSchema.parse(message.settings)))
    await syncAutomaticScripts()
    void wakeWork()
    return
  }
  if (type === 'collection-enable-origin') {
    const origin = new URL(httpURL(message.origin)).origin
    if (!(await browser.permissions.contains({ origins: [siteMatchPattern(origin)] })))
      throw new Error('尚未取得站点权限。')
    await coordinate(async () => {
      const config = await settings()
      if (!config.origins.includes(origin)) config.origins.push(origin)
      await setSettings(config)
    })
    await syncAutomaticScripts()
    for (const tab of await browser.tabs.query({ url: siteMatchPattern(origin) }))
      if (tab.id && !tab.incognito && tab.url && new URL(tab.url).origin === origin)
        await browser.scripting
          .executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/collection.js'] })
          .catch(() => undefined)
    return
  }
  if (type === 'collection-read')
    return materialClient(await connection(z.uuid().parse(message.connectionId))).read(
      z.number().int().parse(message.blockId)
    )
  if (type === 'collection-retry') {
    const item = (await outbox()).find((entry) => entry.id === message.id)
    if (!item || item.state === 'confirmed') return
    if (item.importId) await changeImport(item.importId, 'resume')
    else
      await coordinate(async () => {
        const latest = (await outbox()).find((entry) => entry.id === item.id)
        if (latest && latest.state !== 'confirmed')
          await updateOutbox({ ...latest, state: 'pending', error: undefined })
      })
    void wakeWork()
    return
  }
  if (type === 'collection-folders') return bookmarkFolders()
  if (type === 'collection-preview-import')
    return previewImport(
      z
        .object({
          kind: z.enum(['bookmarks', 'history']),
          folder: z.string(),
          since: z.number().nonnegative(),
          until: z.number(),
          site: z.string(),
          minVisits: z.number().nonnegative(),
          fetchContent: z.boolean(),
        })
        .parse(message.options)
    )
  if (type === 'collection-control-import') {
    await changeImport(
      z.uuid().parse(message.id),
      z.enum(['start', 'pause', 'resume', 'retry']).parse(message.action)
    )
    void wakeWork()
    return
  }
  const config = await settings()
  if (!config.activeConnectionId) throw new Error('请先加入信息库。')
  const target = await connection(config.activeConnectionId)
  const note = z
    .string()
    .max(1_048_576)
    .parse(message.note ?? '')
  if (type === 'collection-save-draft') {
    const draft = z
      .object({
        text: z.string().min(1),
        url: z.string(),
        title: z.string(),
        captured_at: z.string(),
        method: z.enum(['selected-text', 'legacy-note-recovery']).optional(),
      })
      .parse(message.draft)
    httpURL(draft.url)
    const id = await coordinate(() =>
      queueSubmission(target.id, {
        request_id: crypto.randomUUID(),
        mode: 'fixed',
        storage_id: target.storageId,
        source: {
          scope: `browser-selection:${target.peerId}`,
          key: crypto.randomUUID(),
          metadata: { url: draft.url, title: draft.title },
        },
        material: {
          url: draft.url,
          title: draft.title,
          captured_at: draft.captured_at,
          method: draft.method ?? 'selected-text',
          coverage: ['用户主动保留的文字。'],
        },
        parts: [textPart('text', draft.text)],
        note,
      })
    )
    void wakeWork()
    return id
  }
  const tab = await activeTab(message.tabId, message.expectedURL)
  const kind = z.enum(['page', 'selection', 'pdf', 'link']).parse(message.kind)
  let command: SubmitMaterial
  if (kind === 'link')
    command = {
      request_id: crypto.randomUUID(),
      mode: 'record',
      source: {
        scope: `browser-link:${target.peerId}`,
        key: crypto.randomUUID(),
        metadata: { url: tab.url, title: tab.title, saved_at: new Date().toISOString() },
      },
      note,
    }
  else {
    const captured =
      kind === 'pdf'
        ? await fetchMaterial(tab.url, true)
        : await getCapture(tab.id, kind === 'selection')
    command = {
      request_id: crypto.randomUUID(),
      mode: 'fixed',
      storage_id: target.storageId,
      source: {
        scope: `browser-save:${target.peerId}`,
        key: crypto.randomUUID(),
        metadata: { url: tab.url, title: tab.title },
      },
      material: captured.material,
      parts: captured.parts,
      note,
    }
  }
  const id = await coordinate(() => queueSubmission(target.id, command))
  void wakeWork()
  return id
}
