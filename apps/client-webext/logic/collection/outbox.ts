import { validateSubmission, type SubmitMaterial } from '@inkcre/web-collection'
import { browser } from 'wxt/browser'
import { DatabaseFailure, materialClient } from './database'
import { siteMatchPattern } from './permissions'
import {
  allowsAutomatic,
  connection,
  enqueue,
  importRunning,
  outbox,
  settings,
  updateOutbox,
} from './store'

// All background mutations share one order, including pause/exclusion and dispatch.
let coordination = Promise.resolve()
export function coordinate<T>(action: () => Promise<T>): Promise<T> {
  const work = coordination.then(action)
  coordination = work.then(
    () => undefined,
    () => undefined
  )
  return work
}
export async function queueSubmission(
  targetId: string,
  value: SubmitMaterial,
  options: { automatic?: boolean; importCheckpoint?: { id: string }; observationKey?: string } = {}
): Promise<string> {
  const command = validateSubmission(value)
  await enqueue(
    {
      id: command.request_id,
      connectionId: targetId,
      createdAt: Date.now(),
      state: 'pending',
      automatic: options.automatic ?? false,
      importId: options.importCheckpoint?.id,
      observationKey: options.observationKey,
      url:
        command.material?.url ??
        (typeof command.source.metadata.url === 'string' ? command.source.metadata.url : ''),
      command,
    },
    options.importCheckpoint
  )
  return command.request_id
}
export async function deliverBatch(attempted: Set<string>): Promise<number> {
  const candidates = (await outbox())
    .filter((item) => ['pending', 'sending'].includes(item.state) && !attempted.has(item.id))
    .sort(
      (a, b) =>
        Number(a.automatic) * 2 +
          Number(!!a.importId) -
          Number(b.automatic) * 2 -
          Number(!!b.importId) || a.createdAt - b.createdAt
    )
  let dispatched = 0
  for (const original of candidates) {
    if (dispatched >= 3) break
    const item = { ...original }
    const shouldSend = await coordinate(async () => {
      if (item.automatic) {
        if (!allowsAutomatic(await settings(), item.url)) return false
        if (!(await browser.permissions.contains({ origins: [siteMatchPattern(item.url)] })))
          return false
      }
      if (item.importId && !(await importRunning(item.importId))) return false
      if (!item.command) throw new Error('待发送材料缺失，请保留本机数据并检查迁移结果。')
      item.state = 'sending'
      await updateOutbox(item)
      return true
    })
    if (!shouldSend) continue
    dispatched++
    attempted.add(item.id)
    try {
      const target = await connection(item.connectionId)
      const receipt = await materialClient(target).submit(item.command!)
      await coordinate(() =>
        updateOutbox({ ...item, state: 'confirmed', receipt, command: undefined, error: undefined })
      )
    } catch (error) {
      // Keep the captured command and target; graph-level recovery is best effort.
      const blocked = error instanceof DatabaseFailure && error.status >= 400 && error.status < 500
      await coordinate(() =>
        updateOutbox({
          ...item,
          state: blocked ? 'blocked' : 'sending',
          error:
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error),
        })
      )
    }
  }
  return dispatched
}
