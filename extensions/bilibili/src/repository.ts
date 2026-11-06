import { Block, Relation, Source } from '@inkcre/core'
import { NativeIdSchema, resolverTypes } from './schema.ts'
import type { GraphRecord, SourceGraphBatch } from './graph.ts'
import type { Progress } from './progress.ts'

type StoredBlock = Pick<Block, 'id' | 'content' | 'resolver' | 'storage'>

function objectContent(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function nativeKey(resolver: string, content: Record<string, unknown>): string | null {
  const kind =
    resolver === resolverTypes.user
      ? 'user'
      : resolver === resolverTypes.folder
        ? 'folder'
        : resolver === resolverTypes.video
          ? 'video'
          : null
  if (!kind) return null
  const identity = NativeIdSchema.safeParse(
    content[kind === 'user' ? 'mid' : kind === 'folder' ? 'id' : 'aid']
  )
  return identity.success ? `${kind}:${identity.data}` : null
}

/** Bilibili reconciles its own native objects over the ordinary shared graph. */
export class BilibiliRepository {
  private loaded = false
  private readonly records = new Map<string, StoredBlock>()
  private readonly blocks = new Map<number, StoredBlock>()
  private readonly memberships = new Map<number, Map<number, StoredBlock>>()

  private async load() {
    if (this.loaded) return
    let offset = 0
    while (true) {
      const result = await Block.dbApi
        .from()
        .select('*', { count: 'exact' })
        .in('resolver', Object.values(resolverTypes))
        .is('storage', null)
        .order('id', { ascending: true })
        .range(offset, offset + 999)
        .throwOnError()
      const rows = result.data ?? []
      for (const row of rows) {
        this.blocks.set(row.id, row)
        const content = objectContent(row.content)
        const key = content && nativeKey(row.resolver, content)
        if (key && !this.records.has(key)) this.records.set(key, row)
      }
      offset += rows.length
      if (!rows.length || (result.count !== null ? offset >= result.count : rows.length < 1000))
        break
    }
    this.loaded = true
  }

  private async saveRecord(record: GraphRecord): Promise<StoredBlock> {
    const key = nativeKey(record.resolver, record.content)
    if (!key) throw new Error('B 站对象缺少可确认的原生身份。')
    const previous = this.records.get(key)
    const saved = await this.saveContent(previous, record.resolver, record.content)
    this.records.set(key, saved)
    this.blocks.set(saved.id, saved)
    return saved
  }

  private async saveContent(
    previous: StoredBlock | undefined,
    resolver: string,
    patch: Record<string, unknown>
  ) {
    const original = previous ? objectContent(previous.content) : null
    const value = { ...original, ...patch }
    if (previous && JSON.stringify(original) === JSON.stringify(value)) return previous
    const content = JSON.stringify(value)
    // A lost create response ends this attempt. A later execution reads ordinary Blocks again.
    const query = previous
      ? Block.dbApi.update({ content }).eq('id', previous.id)
      : Block.dbApi.insert({ resolver, storage: null, content })
    const result = await query.select().single().throwOnError()
    return result.data
  }

  private async folderMemberships(folder: number): Promise<Map<number, StoredBlock>> {
    const cached = this.memberships.get(folder)
    if (cached) return cached
    const found = new Map<number, StoredBlock>()
    let offset = 0
    while (true) {
      const result = await Relation.dbApi
        .from()
        .select('*', { count: 'exact' })
        .eq('from_', folder)
        .eq('content', 'contains')
        .order('id', { ascending: true })
        .range(offset, offset + 999)
        .throwOnError()
      const rows = result.data ?? []
      const ids = rows.flatMap((row) => (row.to_ === null ? [] : [row.to_]))
      for (let index = 0; index < ids.length; index += 200) {
        const items = await Relation.dbApi
          .from()
          .select()
          .in('from_', ids.slice(index, index + 200))
          .eq('content', 'item')
          .throwOnError()
        for (const memberId of ids.slice(index, index + 200)) {
          const membership = this.blocks.get(memberId)
          const links = (items.data ?? []).filter((row) => row.from_ === memberId)
          if (membership?.resolver !== resolverTypes.membership || links.length !== 1) continue
          const video = links[0]!.to_ === null ? undefined : this.blocks.get(links[0]!.to_)
          const content = video && objectContent(video.content)
          const key = video && content && nativeKey(video.resolver, content)
          if (!video || !key || this.records.get(key)?.id !== video.id) continue
          if (!found.has(video.id)) found.set(video.id, membership)
        }
      }
      offset += rows.length
      if (!rows.length || (result.count !== null ? offset >= result.count : rows.length < 1000))
        break
    }
    this.memberships.set(folder, found)
    return found
  }

  private async link(from: number, to: number, content: string) {
    const existing = await Relation.dbApi
      .from()
      .select('id')
      .eq('from_', from)
      .eq('to_', to)
      .eq('content', content)
      .limit(1)
      .throwOnError()
    if (existing.data?.length) return
    await Relation.dbApi.insert({ from_: from, to_: to, content }).throwOnError()
  }

  private async anchor(source: Source): Promise<StoredBlock> {
    let anchor: StoredBlock | undefined
    if (source.block !== null) {
      const result = await Block.dbApi
        .from()
        .select()
        .eq('id', source.block)
        .single()
        .throwOnError()
      anchor = result.data
    } else {
      const result = await Block.dbApi
        .from()
        .select()
        .eq('resolver', 'core.source.v1')
        .order('id', { ascending: true })
        .throwOnError()
      anchor = result.data?.find((row) => objectContent(row.content)?.id === source.id)
    }
    if (
      anchor &&
      (anchor.resolver !== 'core.source.v1' || objectContent(anchor.content)?.id !== source.id)
    )
      throw new Error('采集源的来源锚点不匹配，已停止写入。')
    return this.saveContent(anchor, 'core.source.v1', {
      id: source.id,
      type: source.type,
      nickname: source.nickname,
    })
  }

  async reconcilePage(source: Source, graph: SourceGraphBatch, progress: Progress): Promise<void> {
    await this.load()
    const ids = new Map<string, number>()
    for (const record of graph.records) {
      if (record.resolver === resolverTypes.membership) continue
      ids.set(record.key, (await this.saveRecord(record)).id)
    }
    for (const record of graph.records) {
      if (record.resolver !== resolverTypes.membership) continue
      const folderKey = graph.relations.find(
        (edge) => edge.content === 'contains' && edge.to_key === record.key
      )?.from_key
      const videoKey = graph.relations.find(
        (edge) => edge.content === 'item' && edge.from_key === record.key
      )?.to_key
      const folder = folderKey && ids.get(folderKey)
      const video = videoKey && ids.get(videoKey)
      if (!folder || !video) throw new Error('收藏条目缺少明确的收藏夹或视频关联。')
      const memberships = await this.folderMemberships(folder)
      const membership = await this.saveContent(
        memberships.get(video),
        record.resolver,
        record.content
      )
      await this.link(membership.id, video, 'item')
      await this.link(folder, membership.id, 'contains')
      memberships.set(video, membership)
      this.blocks.set(membership.id, membership)
      ids.set(record.key, membership.id)
    }
    for (const edge of graph.relations) {
      if (edge.content === 'contains' || edge.content === 'item') continue
      const from = ids.get(edge.from_key)
      const to = ids.get(edge.to_key)
      if (!from || !to) throw new Error('B 站资料关联端点缺失。')
      await this.link(from, to, edge.content)
    }
    const root = ids.get(`user:${progress.scope.account_mid}`)
    if (!root) throw new Error('本页缺少已确认的 B 站账号。')
    const anchor = await this.anchor(source)
    await this.link(anchor.id, root, 'collects')
    const state = { ...source.state, bilibili: progress }
    await Source.dbApi
      .update({ block: anchor.id, state })
      .eq('id', source.id)
      .select('id')
      .single()
      .throwOnError()
    source.block = anchor.id
    source.state = state
  }
}
