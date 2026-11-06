import { z } from 'zod'
import { SourceConfigSchema, type BilibiliSourceConfig } from './schema.ts'
import type { FavoritePage } from './normalize.ts'

const CursorSchema = z.strictObject({
  next_page: z.number().int().positive(),
  head_ids: z.array(z.string()).max(20),
  boundary_ids: z.array(z.string()).max(20),
  reported_count: z.number().int().nonnegative().optional(),
  complete: z.boolean(),
  rows: z.number().int().nonnegative(),
  items: z.number().int().nonnegative().default(0),
  unavailable: z.number().int().nonnegative().default(0),
  unsupported: z.number().int().nonnegative().default(0),
  unresolved: z.number().int().nonnegative().default(0),
})
export const ProgressSchema = z.strictObject({
  version: z.literal(1),
  scope: SourceConfigSchema,
  folders: z.record(z.string(), CursorSchema),
  last_run: z.strictObject({
    started_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    pages: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    status: z.enum(['running', 'partial', 'complete']),
  }),
})
export type Cursor = z.infer<typeof CursorSchema>
export type Progress = z.infer<typeof ProgressSchema>

export function emptyCursor(): Cursor {
  return {
    next_page: 1,
    head_ids: [],
    boundary_ids: [],
    complete: false,
    rows: 0,
    items: 0,
    unavailable: 0,
    unsupported: 0,
    unresolved: 0,
  }
}

export function scopeKey(config: BilibiliSourceConfig): string {
  return JSON.stringify({ ...config, folder_ids: [...config.folder_ids].sort() })
}

export function startProgress(
  state: Record<string, unknown>,
  config: BilibiliSourceConfig
): Progress {
  const previous = ProgressSchema.safeParse(state.bilibili)
  const sameScope = previous.success && scopeKey(previous.data.scope) === scopeKey(config)
  const resume = sameScope && config.folder_ids.some((id) => !previous.data.folders[id]?.complete)
  const now = new Date().toISOString()
  return {
    version: 1,
    scope: config,
    folders: Object.fromEntries(
      config.folder_ids.map((id) => [
        id,
        resume ? (previous.data.folders[id] ?? emptyCursor()) : emptyCursor(),
      ])
    ),
    last_run: {
      started_at: now,
      updated_at: now,
      pages: 0,
      items: 0,
      unavailable: 0,
      unsupported: 0,
      unresolved: 0,
      status: 'running',
    },
  }
}

export function sameIds(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function canResume(cursor: Cursor, head: FavoritePage, boundary: FavoritePage): boolean {
  return (
    sameIds(cursor.head_ids, head.ids) &&
    cursor.reported_count === head.folder.reported_count &&
    sameIds(cursor.boundary_ids, boundary.ids) &&
    boundary.hasMore
  )
}

export function verifyCompletion(
  cursor: Cursor,
  page: FavoritePage,
  pageNumber: number,
  head: FavoritePage
): void {
  const expectedHead = pageNumber === 1 ? page.ids : cursor.head_ids
  const reportedCount = pageNumber === 1 ? page.folder.reported_count : cursor.reported_count
  if (
    !sameIds(expectedHead, head.ids) ||
    reportedCount !== head.folder.reported_count ||
    reportedCount !== page.folder.reported_count ||
    (pageNumber === 1 && head.hasMore !== page.hasMore)
  ) {
    throw new Error(
      '收藏夹在采集期间发生变化，无法确认本轮分页已遍历；已确认的批次保留，请再次执行以重新核对。'
    )
  }
}

export function advanceProgress(
  progress: Progress,
  folder: string,
  page: FavoritePage,
  pageNumber: number,
  maxPages: number
): Progress {
  const previous = progress.folders[folder] ?? emptyCursor()
  if (pageNumber > 1 && page.hasMore && sameIds(previous.boundary_ids, page.ids))
    throw new Error('B 站分页没有前进，已停止以避免将重复页误记为完整采集。')
  if (pageNumber === 1 && page.totalItems === 0 && (page.folder.reported_count ?? 0) > 0)
    throw new Error('收藏夹声明有条目但未返回内容，无法确认是空收藏夹。')
  const folders = {
    ...progress.folders,
    [folder]: {
      next_page: page.hasMore ? pageNumber + 1 : pageNumber,
      head_ids: pageNumber === 1 ? page.ids : previous.head_ids,
      boundary_ids: page.ids,
      reported_count: pageNumber === 1 ? page.folder.reported_count : previous.reported_count,
      complete: !page.hasMore,
      rows: previous.rows + page.totalItems,
      items: previous.items + page.items.length,
      unavailable:
        previous.unavailable +
        page.items.filter((item) => item.membership.availability === 'unavailable').length,
      unsupported: previous.unsupported + page.unsupported,
      unresolved: previous.unresolved + page.unresolved,
    },
  }
  const pages = progress.last_run.pages + 1
  const complete = progress.scope.folder_ids.every((id) => folders[id]?.complete)
  return {
    ...progress,
    folders,
    last_run: {
      ...progress.last_run,
      updated_at: new Date().toISOString(),
      pages,
      items: progress.last_run.items + page.items.length,
      unavailable:
        progress.last_run.unavailable +
        page.items.filter((item) => item.membership.availability === 'unavailable').length,
      unsupported: progress.last_run.unsupported + page.unsupported,
      unresolved: progress.last_run.unresolved + page.unresolved,
      status: complete ? 'complete' : pages >= maxPages ? 'partial' : 'running',
    },
  }
}
