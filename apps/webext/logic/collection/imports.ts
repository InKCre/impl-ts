import { z } from 'zod'
import { browser, type Browser } from 'wxt/browser'
import { materialClient } from './database'
import { fetchMaterial } from './fetch'
import { coordinate, queueSubmission } from './outbox'
import { connection, idbResult, outbox, settings, transaction, updateOutbox } from './store'

const ItemSchema = z.object({
  key: z.string(),
  url: z.string(),
  title: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  recordAccepted: z.boolean().default(false),
})
export const ImportSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  kind: z.enum(['bookmarks', 'history']),
  scope: z.string(),
  state: z.enum(['preview', 'running', 'paused', 'completed']),
  fetchContent: z.boolean(),
  remaining: z.array(ItemSchema),
  failures: z.array(z.object({ item: ItemSchema, error: z.string() })),
  counts: z.object({
    total: z.number(),
    records: z.number(),
    content: z.number(),
    existing: z.number(),
  }),
  stage: z.enum(['record', 'record-wait', 'fetch', 'content-wait']).default('record'),
  requestId: z.uuid().optional(),
  sourceId: z.number().int().optional(),
  error: z.string().optional(),
})
export type ImportRun = z.infer<typeof ImportSchema>
type ImportItem = z.infer<typeof ItemSchema>
type BookmarkNode = Browser.bookmarks.BookmarkTreeNode
export async function importRuns(): Promise<ImportRun[]> {
  return transaction(['imports'], 'readonly', async (tx) =>
    z.array(ImportSchema).parse(await idbResult(tx.objectStore('imports').getAll()))
  )
}
async function saveRun(run: ImportRun) {
  await transaction(['imports'], 'readwrite', async (tx) => {
    await idbResult(tx.objectStore('imports').put(ImportSchema.parse(run), run.id))
  })
}
export async function bookmarkFolders() {
  const folders: { label: string; value: string }[] = [{ label: '全部书签', value: '' }]
  function visit(nodes: BookmarkNode[], path: string) {
    for (const node of nodes) {
      const label = [path, node.title].filter(Boolean).join(' / ')
      if (node.children) {
        folders.push({ label: label || '根目录', value: node.id })
        visit(node.children, label)
      }
    }
  }
  visit(await browser.bookmarks.getTree(), '')
  return folders
}
export async function previewImport(options: {
  kind: 'bookmarks' | 'history'
  folder: string
  since: number
  until: number
  site: string
  minVisits: number
  fetchContent: boolean
}): Promise<ImportRun> {
  const config = await settings()
  if (!config.activeConnectionId) throw new Error('请先加入信息库。')
  const items: ImportItem[] = []
  if (options.kind === 'bookmarks') {
    const roots = options.folder
      ? await browser.bookmarks.getSubTree(options.folder)
      : await browser.bookmarks.getTree()
    function visit(nodes: BookmarkNode[], path: string[]) {
      for (const node of nodes) {
        if (node.url && /^https?:\/\//.test(node.url))
          items.push({
            key: node.id,
            url: node.url,
            title: node.title,
            recordAccepted: false,
            metadata: {
              url: node.url,
              title: node.title,
              native_id: node.id,
              folder: path,
              added_at: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
            },
          })
        if (node.children) visit(node.children, [...path, node.title].filter(Boolean))
      }
    }
    visit(roots, [])
  } else {
    const history = await browser.history.search({
      text: '',
      startTime: options.since,
      endTime: options.until,
      maxResults: 10_000,
    })
    if (history.length >= 10_000)
      throw new Error('此范围达到 10,000 条预览上限，请缩小日期范围后分别导入。')
    for (const item of history)
      if (item.url && /^https?:\/\//.test(item.url) && (item.visitCount ?? 0) >= options.minVisits)
        items.push({
          key: item.id,
          url: item.url,
          title: item.title ?? '',
          recordAccepted: false,
          metadata: {
            url: item.url,
            title: item.title,
            native_id: item.id,
            last_visited_at: item.lastVisitTime
              ? new Date(item.lastVisitTime).toISOString()
              : undefined,
            visit_count: item.visitCount,
            typed_count: item.typedCount,
          },
        })
  }
  const selected = items.filter(
    (item) => !options.site || new URL(item.url).hostname === options.site
  )
  if (selected.length > 10_000) throw new Error('请选择更小的书签目录；一次最多预览 10,000 条。')
  const run = ImportSchema.parse({
    id: crypto.randomUUID(),
    connectionId: config.activeConnectionId,
    kind: options.kind,
    scope: `browser-${options.kind}:${config.profileId}`,
    state: 'preview',
    fetchContent: options.fetchContent,
    remaining: selected,
    failures: [],
    counts: { total: selected.length, records: 0, content: 0, existing: 0 },
  })
  await saveRun(run)
  return run
}
export async function changeImport(id: string, action: 'start' | 'pause' | 'resume' | 'retry') {
  await coordinate(async () => {
    const run = (await importRuns()).find((entry) => entry.id === id)
    if (!run) throw new Error('导入任务不存在。')
    if (action === 'pause') run.state = 'paused'
    else {
      const pending = (await outbox()).find((item) => item.id === run.requestId)
      if (pending?.state === 'blocked')
        await updateOutbox({ ...pending, state: 'pending', error: undefined })
      if (action === 'retry') {
        run.remaining.push(...run.failures.map((failure) => failure.item))
        run.failures = []
      }
      run.state = 'running'
      delete run.error
    }
    await saveRun(run)
  })
}
export async function importStep(): Promise<boolean> {
  const run = (await importRuns()).find((entry) => entry.state === 'running')
  if (!run) return false
  const item = run.remaining[0]
  if (!item) {
    run.state = 'completed'
    await saveRun(run)
    return true
  }
  try {
    if (run.stage === 'record') {
      return await coordinate(async () => {
        const latest = (await importRuns()).find((entry) => entry.id === run.id)!
        if (latest.state !== 'running') return false
        run.requestId = crypto.randomUUID()
        run.stage = 'record-wait'
        await queueSubmission(
          run.connectionId,
          {
            request_id: run.requestId,
            mode: 'record',
            source: { scope: run.scope, key: item.key, metadata: item.metadata },
          },
          { importCheckpoint: run }
        )
        return true
      })
    }
    if (run.stage === 'record-wait' || run.stage === 'content-wait') {
      const pending = (await outbox()).find((entry) => entry.id === run.requestId)
      if (!pending) throw new Error('本机提交记录缺失，请保留任务并检查存储。')
      if (pending.state === 'blocked') {
        // Keep the accepted payload and checkpoint; retry must not fetch the source again.
        run.state = 'paused'
        run.error = pending.error ?? '提交需要处理，材料仍保存在本机。'
        await persistProgress(run)
        return true
      }
      if (pending.state !== 'confirmed') return false
      if (run.stage === 'record-wait') {
        run.sourceId = pending.receipt!.source_id
        if (!item.recordAccepted) run.counts.records++
        item.recordAccepted = true
        if (run.fetchContent) run.stage = 'fetch'
        else completeItem(run)
      } else {
        run.counts.content++
        completeItem(run)
      }
      await persistProgress(run)
      return true
    }
    const target = await connection(run.connectionId)
    if (await materialClient(target).hasMaterial(run.sourceId!)) {
      run.counts.existing++
      completeItem(run)
      await persistProgress(run)
      return true
    }
    const fetched = await fetchMaterial(item.url)
    return await coordinate(async () => {
      const latest = (await importRuns()).find((entry) => entry.id === run.id)!
      if (latest.state !== 'running') return false
      run.requestId = crypto.randomUUID()
      run.stage = 'content-wait'
      await queueSubmission(
        run.connectionId,
        {
          request_id: run.requestId,
          mode: 'fixed',
          source: { scope: run.scope, key: item.key, metadata: item.metadata },
          storage_id: target.storageId,
          material: fetched.material,
          parts: fetched.parts,
        },
        { importCheckpoint: run }
      )
      return true
    })
  } catch (error) {
    run.failures.push({ item, error: error instanceof Error ? error.message : String(error) })
    completeItem(run)
    await persistProgress(run)
    return true
  }
}
function completeItem(run: ImportRun) {
  run.remaining.shift()
  run.stage = 'record'
  delete run.requestId
  delete run.sourceId
  if (!run.remaining.length) run.state = 'completed'
}
async function persistProgress(run: ImportRun) {
  await coordinate(async () => {
    const latest = (await importRuns()).find((entry) => entry.id === run.id)!
    if (latest.state === 'paused') run.state = 'paused'
    await saveRun(run)
  })
}
