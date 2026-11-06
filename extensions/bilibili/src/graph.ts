import { resolverTypes, type User } from './schema.ts'
import type { FavoritePage } from './normalize.ts'

export interface GraphRecord {
  key: string
  resolver: string
  content: Record<string, unknown>
}
export interface GraphRelation {
  from_key: string
  to_key: string
  content: string
}
export interface SourceGraphBatch {
  records: GraphRecord[]
  relations: GraphRelation[]
}

function knownFields(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

export function favoriteGraph(account: User, page: FavoritePage): SourceGraphBatch {
  const records = new Map<string, GraphRecord>()
  const relations = new Map<string, GraphRelation>()
  function record(key: string, resolver: string, value: object) {
    const existing = records.get(key)
    records.set(key, { key, resolver, content: { ...existing?.content, ...knownFields(value) } })
  }
  function relate(from_key: string, to_key: string, content: string) {
    relations.set(JSON.stringify([from_key, to_key, content]), { from_key, to_key, content })
  }
  record(`user:${account.mid}`, resolverTypes.user, account)
  record(`user:${page.owner.mid}`, resolverTypes.user, page.owner)
  record(`folder:${page.folder.id}`, resolverTypes.folder, page.folder)
  relate(`user:${account.mid}`, `folder:${page.folder.id}`, 'owns')
  for (const item of page.items) {
    const video = `video:${item.video.aid}`
    const membership = `membership:${page.folder.id}:${item.video.aid}`
    record(video, resolverTypes.video, item.video)
    record(membership, resolverTypes.membership, item.membership)
    relate(`folder:${page.folder.id}`, membership, 'contains')
    relate(membership, video, 'item')
    if (item.uploader) {
      record(`user:${item.uploader.mid}`, resolverTypes.user, item.uploader)
      relate(video, `user:${item.uploader.mid}`, 'author')
    }
  }
  return { records: [...records.values()], relations: [...relations.values()] }
}
