import type { FavoritePage } from './normalize.ts'
import type { BilibiliSourceConfig, CollectConfig, User } from './schema.ts'
import {
  advanceProgress,
  canResume,
  emptyCursor,
  verifyCompletion,
  type Progress,
} from './progress.ts'

export interface FavoriteSessionPort {
  open(folder: string): Promise<void>
  account(): Promise<User>
  read(folder: string, page: number): Promise<FavoritePage>
}

export async function collectFavorites(
  config: BilibiliSourceConfig,
  initial: Progress,
  options: CollectConfig,
  signal: AbortSignal,
  session: FavoriteSessionPort,
  commit: (account: User, page: FavoritePage, progress: Progress) => Promise<void>
): Promise<Progress> {
  let progress = initial
  for (const folder of config.folder_ids) {
    signal.throwIfAborted()
    let cursor = progress.folders[folder] ?? emptyCursor()
    if (cursor.complete) continue
    await session.open(folder)
    await session.account()
    let cachedHead: FavoritePage | null = null
    if (cursor.next_page > 1) {
      const head = await session.read(folder, 1)
      const boundary =
        cursor.next_page === 2 ? head : await session.read(folder, cursor.next_page - 1)
      if (!canResume(cursor, head, boundary)) {
        cursor = emptyCursor()
        progress = { ...progress, folders: { ...progress.folders, [folder]: cursor } }
        cachedHead = head
      }
    }
    while (!cursor.complete && progress.last_run.pages < options.max_pages) {
      signal.throwIfAborted()
      const account = await session.account()
      const current = cachedHead ?? (await session.read(folder, cursor.next_page))
      cachedHead = null
      signal.throwIfAborted()
      if (!current.hasMore) {
        const finalHead = await session.read(folder, 1)
        signal.throwIfAborted()
        verifyCompletion(cursor, current, cursor.next_page, finalHead)
      }
      const next = advanceProgress(progress, folder, current, cursor.next_page, options.max_pages)
      await commit(account, current, next)
      // Progress is adopted only after the database confirms the graph and cursor together.
      progress = next
      cursor = progress.folders[folder]!
    }
    if (progress.last_run.pages >= options.max_pages) break
  }
  return progress
}
